import { sql } from './db';
import {
  Product,
  ProductBatch,
  ProductWithBatches,
  ProductUnit,
  Category,
  Customer,
  OrderRow,
  OrderItemRow,
  OrderWithRelations,
  OrderGiftRow,
  Gift,
  CartItem,
  Expense,
  ExpenseCategory,
  PaymentMode,
  AdvanceOrderRow,
  AdvanceOrderItemRow,
  AdvanceOrderStatus,
  AdvanceOrderWithRelations,
} from './types';
import { effectiveGstRate, gstInside } from './gst';

// orders.bill_date is a Postgres DATE. The shop runs on India time, so turn whatever the client
// sent (a plain YYYY-MM-DD, or a full ISO timestamp) into the IST calendar day. Casting a UTC ISO
// string straight to DATE would give "yesterday" between 12:00 AM and 5:30 AM IST.
const toShopBillDate = (value: string): string => {
  if (/^\d{4}-\d{2}-\d{2}$/.test(value)) return value;
  const t = new Date(value).getTime();
  if (isNaN(t)) return value;
  return new Date(t + 5.5 * 60 * 60 * 1000).toISOString().slice(0, 10);
};

// Utility to generate a unique ID
const uid = () => {
  if (typeof crypto !== 'undefined' && 'randomUUID' in crypto) {
    return crypto.randomUUID();
  }
  return `id-${Date.now()}-${Math.random().toString(36).slice(2, 10)}`;
};

// Builds a ProductWithBatches, computing stock and active price.
// For serialized products (tracks_serial), available stock = count of AVAILABLE
// units; for accessories it's the sum of batch stock_quantity (legacy behavior).
function enrichProduct(
  product: Product,
  batches: ProductBatch[],
  units: ProductUnit[],
): ProductWithBatches {
  let active_selling_price = 0;
  let foundActiveBatch = false;
  let batchStock = 0;

  for (const batch of batches) {
    batchStock += batch.stock_quantity;
    if (batch.stock_quantity > 0 && !foundActiveBatch) {
      active_selling_price = Number(batch.selling_price);
      foundActiveBatch = true;
    }
  }

  const available_units = units.filter((u) => u.status === 'AVAILABLE');
  const total_stock = product.tracks_serial ? available_units.length : batchStock;

  return {
    ...product,
    batches,
    available_units,
    total_stock,
    active_selling_price,
  };
}

const FALLBACK_EXPENSE_CATEGORY = 'Miscellaneous';
const DEFAULT_EXPENSE_CATEGORIES = [
  'Stock Purchase',
  'Rent',
  'Salaries',
  'Utilities',
  'Electricity',
  'Transport',
  'Marketing',
  'Repairs & Maintenance',
  'Taxes & Fees',
  FALLBACK_EXPENSE_CATEGORY,
];
let expenseCategoriesReady: Promise<void> | null = null;
const FALLBACK_PRODUCT_CATEGORY = 'General';
let productCategoriesReady: Promise<void> | null = null;

export const dbStore = {
  // CATEGORIES (product categories; products.category stores the NAME as text)
  // Backfill is idempotent and mirrors db/migrations/003_product_categories_backfill.sql.
  async ensureProductCategories(): Promise<void> {
    if (!productCategoriesReady) {
      productCategoriesReady = (async () => {
        await sql`
          INSERT INTO categories (id, name)
          SELECT ${uid()}, ${FALLBACK_PRODUCT_CATEGORY}
          WHERE NOT EXISTS (SELECT 1 FROM categories WHERE LOWER(name) = LOWER(${FALLBACK_PRODUCT_CATEGORY}))`;
        await sql`
          INSERT INTO categories (id, name)
          SELECT gen_random_uuid()::text, s.c
          FROM (SELECT MIN(TRIM(category)) AS c FROM products
                WHERE category IS NOT NULL AND TRIM(category) <> ''
                GROUP BY LOWER(TRIM(category))) s
          WHERE NOT EXISTS (SELECT 1 FROM categories x WHERE LOWER(x.name) = LOWER(s.c))`;
      })().catch((e) => {
        productCategoriesReady = null;
        throw e;
      });
    }
    await productCategoriesReady;
  },

  async listCategories(): Promise<Category[]> {
    await this.ensureProductCategories();
    const rows = await sql`SELECT * FROM categories ORDER BY name ASC`;
    return rows as Category[];
  },

  async addCategory(name: string): Promise<Category> {
    await this.ensureProductCategories();
    const existing = await sql`SELECT * FROM categories WHERE LOWER(name) = LOWER(${name}) LIMIT 1`;
    if (existing.length > 0) return existing[0] as Category;
    const rows = await sql`
      INSERT INTO categories (id, name)
      VALUES (${uid()}, ${name})
      ON CONFLICT (name) DO UPDATE SET name = EXCLUDED.name
      RETURNING *
    `;
    return rows[0] as Category;
  },

  // Renames the category and every product using the old name, atomically.
  async renameCategory(id: string, newName: string): Promise<Category> {
    await this.ensureProductCategories();
    const existing = await sql`SELECT * FROM categories WHERE id = ${id}`;
    if (existing.length === 0) throw new Error('Category not found.');
    const oldName = (existing[0] as Category).name;
    if (oldName.toLowerCase() === FALLBACK_PRODUCT_CATEGORY.toLowerCase()) {
      throw new Error(`"${FALLBACK_PRODUCT_CATEGORY}" cannot be renamed.`);
    }
    if (newName.toLowerCase() === FALLBACK_PRODUCT_CATEGORY.toLowerCase()) {
      throw new Error(`"${FALLBACK_PRODUCT_CATEGORY}" is reserved.`);
    }
    const clash = await sql`SELECT 1 FROM categories WHERE LOWER(name) = LOWER(${newName}) AND id <> ${id}`;
    if (clash.length > 0) throw new Error(`A category named "${newName}" already exists.`);
    const res = await sql.transaction([
      sql`UPDATE categories SET name = ${newName} WHERE id = ${id} RETURNING *`,
      sql`UPDATE products SET category = ${newName} WHERE category = ${oldName}`,
    ]);
    return (res[0] as unknown as Category[])[0];
  },

  // Deletes the category; its products move to "General" (never deleted itself).
  async deleteCategory(id: string): Promise<{ reassigned: number }> {
    await this.ensureProductCategories();
    const existing = await sql`SELECT * FROM categories WHERE id = ${id}`;
    if (existing.length === 0) return { reassigned: 0 };
    const name = (existing[0] as Category).name;
    if (name.toLowerCase() === FALLBACK_PRODUCT_CATEGORY.toLowerCase()) {
      throw new Error(`"${FALLBACK_PRODUCT_CATEGORY}" cannot be deleted.`);
    }
    const res = await sql.transaction([
      sql`INSERT INTO categories (id, name)
          SELECT ${uid()}, ${FALLBACK_PRODUCT_CATEGORY}
          WHERE NOT EXISTS (SELECT 1 FROM categories WHERE LOWER(name) = LOWER(${FALLBACK_PRODUCT_CATEGORY}))`,
      sql`UPDATE products SET category = ${FALLBACK_PRODUCT_CATEGORY} WHERE category = ${name} RETURNING id`,
      sql`DELETE FROM categories WHERE id = ${id}`,
    ]);
    return { reassigned: (res[1] as unknown[]).length };
  },

  // GIFTS (free add-ons; price is display-only, never in analytics)
  async listGifts(): Promise<Gift[]> {
    const rows = await sql`SELECT * FROM gifts ORDER BY name ASC`;
    return rows as Gift[];
  },

  async addGift(name: string, price: number): Promise<Gift> {
    const rows = await sql`
      INSERT INTO gifts (id, name, price) VALUES (${uid()}, ${name}, ${price})
      RETURNING *
    `;
    return rows[0] as Gift;
  },

  async updateGift(id: string, name: string, price: number): Promise<Gift | null> {
    const rows = await sql`
      UPDATE gifts SET name = ${name}, price = ${price} WHERE id = ${id} RETURNING *
    `;
    return rows.length > 0 ? (rows[0] as Gift) : null;
  },

  async deleteGift(id: string): Promise<void> {
    await sql`DELETE FROM gifts WHERE id = ${id}`;
  },

  // PRODUCTS
  async listProducts(): Promise<Product[]> {
    const rows = await sql`SELECT * FROM products ORDER BY name ASC`;
    return rows as Product[];
  },

  async getProductWithBatches(id: string): Promise<ProductWithBatches | null> {
    const products = await sql`SELECT * FROM products WHERE id = ${id}`;
    if (products.length === 0) return null;

    const [batches, units] = await Promise.all([
      sql`SELECT * FROM product_batches WHERE product_id = ${id} ORDER BY arrived_at ASC`,
      sql`SELECT * FROM product_units WHERE product_id = ${id} ORDER BY created_at ASC`,
    ]);

    return enrichProduct(
      products[0] as Product,
      batches as ProductBatch[],
      units as ProductUnit[],
    );
  },

  async listProductsWithBatches(): Promise<ProductWithBatches[]> {
    const [products, allBatches, allUnits] = await Promise.all([
      sql`SELECT * FROM products ORDER BY name ASC`,
      sql`SELECT * FROM product_batches ORDER BY arrived_at ASC`,
      sql`SELECT * FROM product_units ORDER BY created_at ASC`,
    ]);

    return products.map((p: any) =>
      enrichProduct(
        p as Product,
        (allBatches as ProductBatch[]).filter((b) => b.product_id === p.id),
        (allUnits as ProductUnit[]).filter((u) => u.product_id === p.id),
      ),
    );
  },

  async addProduct(input: { name: string; description: string | null; description2?: string | null; category: string; gst_rate: number; low_stock_threshold: number; tracks_serial?: boolean }): Promise<Product> {
    const id = uid();
    const rows = await sql`
      INSERT INTO products (id, name, description, description2, category, gst_rate, low_stock_threshold, tracks_serial)
      VALUES (${id}, ${input.name}, ${input.description}, ${input.description2 ?? null}, ${input.category}, ${input.gst_rate}, ${input.low_stock_threshold}, ${input.tracks_serial ?? false})
      RETURNING *
    `;
    return rows[0] as Product;
  },

  async updateProduct(id: string, patch: Partial<Product>): Promise<Product | null> {
    if (Object.keys(patch).length === 0) return this.getProductWithBatches(id);

    // We update fields individually since dynamic SET with Neon SQL template tag is tricky
    if (patch.name !== undefined) await sql`UPDATE products SET name = ${patch.name} WHERE id = ${id}`;
    if (patch.description !== undefined) await sql`UPDATE products SET description = ${patch.description} WHERE id = ${id}`;
    if (patch.description2 !== undefined) await sql`UPDATE products SET description2 = ${patch.description2} WHERE id = ${id}`;
    if (patch.category !== undefined) await sql`UPDATE products SET category = ${patch.category} WHERE id = ${id}`;
    if (patch.gst_rate !== undefined) await sql`UPDATE products SET gst_rate = ${patch.gst_rate} WHERE id = ${id}`;
    if (patch.low_stock_threshold !== undefined) await sql`UPDATE products SET low_stock_threshold = ${patch.low_stock_threshold} WHERE id = ${id}`;
    if (patch.tracks_serial !== undefined) await sql`UPDATE products SET tracks_serial = ${patch.tracks_serial} WHERE id = ${id}`;

    const rows = await sql`SELECT * FROM products WHERE id = ${id}`;
    return rows.length > 0 ? (rows[0] as Product) : null;
  },

  async deleteProduct(id: string): Promise<void> {
    await sql`DELETE FROM products WHERE id = ${id}`;
  },

  // BATCHES
  async addBatch(input: {
    product_id: string;
    batch_no: string | null;
    manufacturer: string | null;
    hsn_code: string | null;
    cost_price: number;
    selling_price: number;
    stock_quantity: number;
    // For serialized products: one IMEI/serial per physical unit. When provided,
    // stock_quantity is forced to serials.length and a product_units row is created per serial.
    serials?: string[];
  }): Promise<ProductBatch> {
    const id = uid();
    const serials = (input.serials || [])
      .map((s) => s.trim())
      .filter((s) => s.length > 0);
    const stockQty = serials.length > 0 ? serials.length : input.stock_quantity;

    const rows = await sql`
      INSERT INTO product_batches (
        id, product_id, batch_no, manufacturer, hsn_code, cost_price, selling_price, stock_quantity
      ) VALUES (
        ${id}, ${input.product_id}, ${input.batch_no}, ${input.manufacturer}, ${input.hsn_code},
        ${input.cost_price}, ${input.selling_price}, ${stockQty}
      )
      RETURNING *
    `;

    if (serials.length > 0) {
      await Promise.all(
        serials.map((serial) =>
          sql`
            INSERT INTO product_units (id, product_id, batch_id, serial, status)
            VALUES (${uid()}, ${input.product_id}, ${id}, ${serial}, 'AVAILABLE')
          `,
        ),
      );
    }

    return rows[0] as ProductBatch;
  },

  async updateBatch(id: string, patch: Partial<ProductBatch>): Promise<ProductBatch | null> {
    if (Object.keys(patch).length === 0) return null;

    if (patch.batch_no !== undefined) await sql`UPDATE product_batches SET batch_no = ${patch.batch_no} WHERE id = ${id}`;
    if (patch.manufacturer !== undefined) await sql`UPDATE product_batches SET manufacturer = ${patch.manufacturer} WHERE id = ${id}`;
    if (patch.hsn_code !== undefined) await sql`UPDATE product_batches SET hsn_code = ${patch.hsn_code} WHERE id = ${id}`;
    if (patch.cost_price !== undefined) await sql`UPDATE product_batches SET cost_price = ${patch.cost_price} WHERE id = ${id}`;
    if (patch.selling_price !== undefined) await sql`UPDATE product_batches SET selling_price = ${patch.selling_price} WHERE id = ${id}`;
    if (patch.stock_quantity !== undefined) await sql`UPDATE product_batches SET stock_quantity = ${patch.stock_quantity} WHERE id = ${id}`;

    const rows = await sql`SELECT * FROM product_batches WHERE id = ${id}`;
    return rows.length > 0 ? (rows[0] as ProductBatch) : null;
  },

  async deleteBatch(id: string): Promise<void> {
    await sql`DELETE FROM product_batches WHERE id = ${id}`;
  },

  // PRODUCT UNITS (individual IMEI / serial rows)
  async listUnits(productId: string): Promise<ProductUnit[]> {
    const rows = await sql`
      SELECT * FROM product_units
      WHERE product_id = ${productId}
      ORDER BY status ASC, created_at ASC
    `;
    return rows as ProductUnit[];
  },

  // Rename/correct the serial on an AVAILABLE unit. Sold units are locked (on an invoice).
  async updateUnitSerial(id: string, serial: string): Promise<ProductUnit | null> {
    const rows = await sql`
      UPDATE product_units
      SET serial = ${serial}
      WHERE id = ${id} AND status = 'AVAILABLE'
      RETURNING *
    `;
    return rows.length > 0 ? (rows[0] as ProductUnit) : null;
  },

  // Remove an AVAILABLE unit and drop its batch stock by one. Sold units cannot be deleted.
  async deleteUnit(id: string): Promise<{ deleted: boolean; reason?: string }> {
    const rows = await sql`SELECT status, batch_id FROM product_units WHERE id = ${id}`;
    if (rows.length === 0) return { deleted: false, reason: 'not_found' };
    const unit = rows[0] as { status: string; batch_id: string };
    if (unit.status === 'SOLD') return { deleted: false, reason: 'sold' };

    await sql`UPDATE product_batches SET stock_quantity = GREATEST(0, stock_quantity - 1) WHERE id = ${unit.batch_id}`;
    await sql`DELETE FROM product_units WHERE id = ${id}`;
    return { deleted: true };
  },

  // Add new serials to an existing batch (top-up), skipping any that already exist for the product.
  async addUnitsToBatch(batchId: string, productId: string, serials: string[]): Promise<number> {
    const clean = Array.from(
      new Set(serials.map((s) => s.trim()).filter((s) => s.length > 0)),
    );
    if (clean.length === 0) return 0;

    const existing = await sql`
      SELECT serial FROM product_units WHERE product_id = ${productId} AND serial = ANY(${clean})
    `;
    const taken = new Set((existing as { serial: string }[]).map((r) => r.serial));
    const toAdd = clean.filter((s) => !taken.has(s));
    if (toAdd.length === 0) return 0;

    await Promise.all(
      toAdd.map((serial) =>
        sql`
          INSERT INTO product_units (id, product_id, batch_id, serial, status)
          VALUES (${uid()}, ${productId}, ${batchId}, ${serial}, 'AVAILABLE')
        `,
      ),
    );
    await sql`UPDATE product_batches SET stock_quantity = stock_quantity + ${toAdd.length} WHERE id = ${batchId}`;
    return toAdd.length;
  },

  // CUSTOMERS
  async upsertCustomer(name: string, phone: string, address?: string | null): Promise<Customer> {
    const id = uid();
    const rows = await sql`
      INSERT INTO customers (id, name, phone, address)
      VALUES (${id}, ${name}, ${phone}, ${address || null})
      ON CONFLICT (phone) DO UPDATE SET address = COALESCE(EXCLUDED.address, customers.address)
      RETURNING *
    `;
    return rows[0] as Customer;
  },

  // ORDERS
  async orderIdExists(id: string): Promise<boolean> {
    const rows = await sql`SELECT 1 FROM orders WHERE id = ${id} LIMIT 1`;
    return rows.length > 0;
  },

  async listOrdersWithRelations(): Promise<OrderWithRelations[]> {
    const orders = await sql`
      SELECT o.*, COALESCE(o.customer_name, c.name) as customer_name, c.phone as customer_phone, c.address as customer_address
      FROM orders o
      JOIN customers c ON c.id = o.customer_id
      ORDER BY o.created_at DESC
    `;

    if (orders.length === 0) return [];

    const orderIds = orders.map((o: any) => o.id);
    const [items, gifts] = await Promise.all([
      sql`SELECT * FROM order_items WHERE order_id = ANY(${orderIds})`,
      sql`SELECT * FROM order_gifts WHERE order_id = ANY(${orderIds})`,
    ]);

    return orders.map((o: any) => ({
      ...o,
      items: items.filter((i: any) => i.order_id === o.id) as OrderItemRow[],
      gifts: gifts.filter((g: any) => g.order_id === o.id) as OrderGiftRow[],
    })) as OrderWithRelations[];
  },

  async getOrderWithRelations(id: string): Promise<OrderWithRelations | null> {
    const orders = await sql`
      SELECT o.*, COALESCE(o.customer_name, c.name) as customer_name, c.phone as customer_phone, c.address as customer_address
      FROM orders o
      JOIN customers c ON c.id = o.customer_id
      WHERE o.id = ${id}
    `;
    if (orders.length === 0) return null;

    const [items, gifts] = await Promise.all([
      sql`
        SELECT oi.*,
               b.batch_no AS batch_no,
               p.description AS product_description,
               p.description2 AS product_description2
        FROM order_items oi
        LEFT JOIN product_batches b ON b.id = oi.batch_id
        LEFT JOIN products p ON p.id = oi.product_id
        WHERE oi.order_id = ${id}
      `,
      sql`SELECT * FROM order_gifts WHERE order_id = ${id}`,
    ]);

    return {
      ...(orders[0] as any),
      items: items as OrderItemRow[],
      gifts: gifts as OrderGiftRow[],
    } as OrderWithRelations;
  },

  async deleteOrder(id: string): Promise<void> {
    // Return any serialized units sold on this order back to stock before deleting.
    const soldUnits = await sql`
      SELECT id, batch_id FROM product_units WHERE order_id = ${id}
    `;
    await Promise.all(
      (soldUnits as { id: string; batch_id: string }[]).map((u) =>
        sql`UPDATE product_batches SET stock_quantity = stock_quantity + 1 WHERE id = ${u.batch_id}`,
      ),
    );
    await sql`
      UPDATE product_units
      SET status = 'AVAILABLE', order_id = NULL, sold_at = NULL
      WHERE order_id = ${id}
    `;
    await sql`DELETE FROM orders WHERE id = ${id}`;
  },

  // EXPENSE CATEGORIES
  // Expenses store the category *name* as text, so rename/delete also rewrite expenses.category.
  // Table creation + seeding is idempotent (mirrors db/migrations/001_expense_categories.sql) and
  // runs once per server instance, so deploys work even before the migration is applied by hand.
  async ensureExpenseSchema(): Promise<void> {
    if (!expenseCategoriesReady) {
      expenseCategoriesReady = (async () => {
        await sql`
          CREATE TABLE IF NOT EXISTS expense_categories (
            id TEXT PRIMARY KEY,
            name TEXT NOT NULL,
            sort_order INTEGER NOT NULL DEFAULT 0,
            created_at TIMESTAMPTZ NOT NULL DEFAULT now()
          )`;
        await sql`CREATE UNIQUE INDEX IF NOT EXISTS expense_categories_name_lower_key ON expense_categories (LOWER(name))`;
        const seeded = await sql`SELECT 1 FROM expense_categories LIMIT 1`;
        if (seeded.length === 0) {
          for (let i = 0; i < DEFAULT_EXPENSE_CATEGORIES.length; i++) {
            await sql`
              INSERT INTO expense_categories (id, name, sort_order)
              VALUES (${uid()}, ${DEFAULT_EXPENSE_CATEGORIES[i]}, ${i + 1})
              ON CONFLICT DO NOTHING`;
          }
        }
        await sql`
          INSERT INTO expense_categories (id, name, sort_order)
          SELECT gen_random_uuid()::text, c, 100
          FROM (SELECT DISTINCT TRIM(category) AS c FROM expenses WHERE TRIM(category) <> '') s
          ON CONFLICT DO NOTHING`;
      })().catch((e) => {
        expenseCategoriesReady = null;
        throw e;
      });
    }
    await expenseCategoriesReady;
  },

  async listExpenseCategories(): Promise<ExpenseCategory[]> {
    await this.ensureExpenseSchema();
    const rows = await sql`SELECT * FROM expense_categories ORDER BY sort_order ASC, name ASC`;
    return rows as ExpenseCategory[];
  },

  async addExpenseCategory(name: string): Promise<ExpenseCategory> {
    await this.ensureExpenseSchema();
    const rows = await sql`
      INSERT INTO expense_categories (id, name, sort_order)
      VALUES (${uid()}, ${name}, 100)
      ON CONFLICT (LOWER(name)) DO UPDATE SET name = expense_categories.name
      RETURNING *`;
    return rows[0] as ExpenseCategory;
  },

  // Renames the category and every expense using the old name, atomically.
  async renameExpenseCategory(id: string, newName: string): Promise<ExpenseCategory> {
    await this.ensureExpenseSchema();
    const existing = await sql`SELECT * FROM expense_categories WHERE id = ${id}`;
    if (existing.length === 0) throw new Error('Category not found.');
    const oldName = (existing[0] as ExpenseCategory).name;
    if (oldName === FALLBACK_EXPENSE_CATEGORY) {
      throw new Error(`"${FALLBACK_EXPENSE_CATEGORY}" cannot be renamed.`);
    }
    const clash = await sql`SELECT 1 FROM expense_categories WHERE LOWER(name) = LOWER(${newName}) AND id <> ${id}`;
    if (clash.length > 0) throw new Error(`A category named "${newName}" already exists.`);
    const res = await sql.transaction([
      sql`UPDATE expense_categories SET name = ${newName} WHERE id = ${id} RETURNING *`,
      sql`UPDATE expenses SET category = ${newName} WHERE category = ${oldName}`,
    ]);
    return (res[0] as unknown as ExpenseCategory[])[0];
  },

  // Deletes the category; expenses that used it move to "Miscellaneous" (created if missing).
  async deleteExpenseCategory(id: string): Promise<{ reassigned: number }> {
    await this.ensureExpenseSchema();
    const existing = await sql`SELECT * FROM expense_categories WHERE id = ${id}`;
    if (existing.length === 0) return { reassigned: 0 };
    const name = (existing[0] as ExpenseCategory).name;
    if (name === FALLBACK_EXPENSE_CATEGORY) {
      throw new Error(`"${FALLBACK_EXPENSE_CATEGORY}" cannot be deleted.`);
    }
    const res = await sql.transaction([
      sql`INSERT INTO expense_categories (id, name, sort_order)
          VALUES (${uid()}, ${FALLBACK_EXPENSE_CATEGORY}, 10)
          ON CONFLICT (LOWER(name)) DO NOTHING`,
      sql`UPDATE expenses SET category = ${FALLBACK_EXPENSE_CATEGORY} WHERE category = ${name} RETURNING id`,
      sql`DELETE FROM expense_categories WHERE id = ${id}`,
    ]);
    return { reassigned: (res[1] as unknown[]).length };
  },

  // EXPENSES
  async listExpenses(): Promise<Expense[]> {
    await this.ensureExpenseSchema();
    const rows = await sql`
      SELECT * FROM expenses
      ORDER BY expense_date DESC, created_at DESC
    `;
    return rows as Expense[];
  },

  async getExpense(id: string): Promise<Expense | null> {
    await this.ensureExpenseSchema();
    const rows = await sql`SELECT * FROM expenses WHERE id = ${id}`;
    return rows.length > 0 ? (rows[0] as Expense) : null;
  },

  async addExpense(input: {
    title: string;
    category: string;
    amount: number;
    payment_mode: string;
    notes: string | null;
    expense_date: string;
  }): Promise<Expense> {
    await this.ensureExpenseSchema();
    const id = uid();
    const rows = await sql`
      INSERT INTO expenses (id, title, category, amount, payment_mode, notes, expense_date)
      VALUES (
        ${id}, ${input.title}, ${input.category}, ${input.amount},
        ${input.payment_mode}, ${input.notes}, ${input.expense_date}
      )
      RETURNING *
    `;
    return rows[0] as Expense;
  },

  async updateExpense(id: string, patch: Partial<Expense>): Promise<Expense | null> {
    if (Object.keys(patch).length === 0) {
      const rows = await sql`SELECT * FROM expenses WHERE id = ${id}`;
      return rows.length > 0 ? (rows[0] as Expense) : null;
    }

    if (patch.title !== undefined) await sql`UPDATE expenses SET title = ${patch.title} WHERE id = ${id}`;
    if (patch.category !== undefined) await sql`UPDATE expenses SET category = ${patch.category} WHERE id = ${id}`;
    if (patch.amount !== undefined) await sql`UPDATE expenses SET amount = ${patch.amount} WHERE id = ${id}`;
    if (patch.payment_mode !== undefined) await sql`UPDATE expenses SET payment_mode = ${patch.payment_mode} WHERE id = ${id}`;
    if (patch.notes !== undefined) await sql`UPDATE expenses SET notes = ${patch.notes} WHERE id = ${id}`;
    if (patch.expense_date !== undefined) await sql`UPDATE expenses SET expense_date = ${patch.expense_date} WHERE id = ${id}`;

    const rows = await sql`SELECT * FROM expenses WHERE id = ${id}`;
    return rows.length > 0 ? (rows[0] as Expense) : null;
  },

  async deleteExpense(id: string): Promise<void> {
    await sql`DELETE FROM expenses WHERE id = ${id}`;
  },

  // FIFO DEDUCTION & ORDER SUBMISSION
  async submitOrder(payload: {
    orderId: string;
    customerName: string;
    customerPhone: string;
    customerAddress?: string | null;
    source: 'ONLINE' | 'OFFLINE';
    isGst: boolean;
    billDate: string;
    items: CartItem[];
    discountType: 'PERCENT' | 'FIXED';
    discountValue: number;
    discountAmount: number;
    gstPercentage: number;
    gstAmount: number;
    deliveryFee: number;
    grandTotal: number;
    cashReceived: number;
    paymentMode: PaymentMode;
    // Split payment (optional): when splitMode2 is set the bill is paid across two
    // modes — paymentMode takes splitAmount1 and splitMode2 takes splitAmount2.
    splitMode2?: PaymentMode | null;
    splitAmount1?: number;
    splitAmount2?: number;
    gifts?: { gift_id: string | null; name: string; price: number; quantity: number }[];
  }): Promise<{ orderId: string }> {
    // Neon HTTP doesn't natively support full interactive transactions in the simple API,
    // but we can execute them sequentially or use multiple statements.
    // For simplicity, we'll do sequential awaits which is fine for this scale,
    // or batch them if possible. Let's do sequential for clarity.

    const productIds = Array.from(
      new Set(
        payload.items
          .filter((i) => i.product_id)
          .map((i) => i.product_id as string)
      )
    );

    // Concurrently upsert customer and fetch batches for all products in 1 roundtrip
    const [customer, allBatches] = await Promise.all([
      this.upsertCustomer(payload.customerName, payload.customerPhone, payload.customerAddress),
      productIds.length > 0
        ? sql`
            SELECT * FROM product_batches
            WHERE product_id = ANY(${productIds}) AND stock_quantity > 0
            ORDER BY arrived_at ASC
          `
        : Promise.resolve([]),
    ]);

    // FIFO Stock Deduction and split items in memory
    const batchList = [...(allBatches as ProductBatch[])];
    const finalOrderItems: Omit<OrderItemRow, 'id'>[] = [];
    const batchUpdates: { id: string; deduction: number }[] = [];
    const unitsToSell: string[] = []; // product_units ids to mark SOLD

    for (const item of payload.items) {
      // Serialized unit sale: the cart line already points at one specific unit.
      if (item.unit_id) {
        unitsToSell.push(item.unit_id);
        if (item.batch_id) batchUpdates.push({ id: item.batch_id, deduction: 1 });
        finalOrderItems.push({
          order_id: payload.orderId,
          product_id: item.product_id,
          batch_id: item.batch_id ?? null,
          unit_id: item.unit_id,
          snapshot_name: item.name,
          snapshot_price: item.price,
          snapshot_serial: item.serial ?? null,
          snapshot_gst_rate: item.gst_rate ?? null,
          quantity: 1,
        });
        continue;
      }

      if (!item.product_id) {
        finalOrderItems.push({
          order_id: payload.orderId,
          product_id: null,
          batch_id: null,
          unit_id: null,
          snapshot_name: item.name,
          snapshot_price: item.price,
          snapshot_serial: null,
          snapshot_gst_rate: item.gst_rate ?? null,
          quantity: item.qty,
        });
        continue;
      }

      let remaining = item.qty;
      const matchingBatches = batchList.filter(
        (b) => b.product_id === item.product_id && b.stock_quantity > 0
      );

      for (const batch of matchingBatches) {
        if (remaining <= 0) break;
        const take = Math.min(remaining, batch.stock_quantity);
        batch.stock_quantity -= take;
        batchUpdates.push({ id: batch.id, deduction: take });

        finalOrderItems.push({
          order_id: payload.orderId,
          product_id: item.product_id,
          batch_id: batch.id,
          unit_id: null,
          snapshot_name: item.name,
          snapshot_price: Number(batch.selling_price),
          snapshot_serial: null,
          snapshot_gst_rate: item.gst_rate ?? null,
          quantity: take,
        });

        remaining -= take;
      }

      if (remaining > 0) {
        finalOrderItems.push({
          order_id: payload.orderId,
          product_id: item.product_id,
          batch_id: null,
          unit_id: null,
          snapshot_name: item.name,
          snapshot_price: item.price,
          snapshot_serial: null,
          snapshot_gst_rate: item.gst_rate ?? null,
          quantity: remaining,
        });
      }
    }

    // Prices are GST-inclusive, so subtotal is simply the sum of line prices × qty and
    // grand_total = subtotal - discount + delivery. gst_amount is the GST already contained in
    // that total (shown as CGST + SGST on the invoice) — it is never added on top.
    const subtotalInclusive = payload.grandTotal + payload.discountAmount - payload.deliveryFee;

    // Insert order & execute all batch stock deductions concurrently
    await Promise.all([
      sql`
        INSERT INTO orders (
          id, customer_id, customer_name, source, status, is_gst, subtotal, discount_type, discount_value,
          discount_amount, gst_percentage, gst_amount, delivery_fee, grand_total,
          cash_received, payment_mode, split_mode_2, split_amount_1, split_amount_2, bill_date, created_at
        ) VALUES (
          ${payload.orderId}, ${customer.id}, ${payload.customerName}, ${payload.source}, 'COMPLETED', ${payload.isGst},
          ${subtotalInclusive},
          ${payload.discountType}, ${payload.discountValue}, ${payload.discountAmount},
          ${payload.gstPercentage}, ${payload.gstAmount}, ${payload.deliveryFee},
          ${payload.grandTotal}, ${payload.cashReceived}, ${payload.paymentMode},
          ${payload.splitMode2 ?? null}, ${payload.splitAmount1 ?? 0}, ${payload.splitAmount2 ?? 0},
          ${toShopBillDate(payload.billDate)}, now()
        )
      `,
      ...batchUpdates.map((u) =>
        sql`UPDATE product_batches SET stock_quantity = stock_quantity - ${u.deduction} WHERE id = ${u.id}`
      ),
    ]);

    // Insert order items and mark sold serialized units concurrently.
    // Both reference the order row, which the previous await has already inserted.
    await Promise.all([
      ...finalOrderItems.map((oi) =>
        sql`
          INSERT INTO order_items (
            id, order_id, product_id, batch_id, unit_id, snapshot_name, snapshot_price, snapshot_serial,
            snapshot_gst_rate, quantity
          ) VALUES (
            ${uid()}, ${oi.order_id}, ${oi.product_id}, ${oi.batch_id}, ${oi.unit_id},
            ${oi.snapshot_name}, ${oi.snapshot_price}, ${oi.snapshot_serial},
            ${oi.snapshot_gst_rate ?? null}, ${oi.quantity}
          )
        `
      ),
      ...unitsToSell.map((unitId) =>
        sql`
          UPDATE product_units
          SET status = 'SOLD', order_id = ${payload.orderId}, sold_at = now()
          WHERE id = ${unitId} AND status = 'AVAILABLE'
        `
      ),
      // Gifts are free add-ons: stored for the invoice only, outside all totals.
      ...(payload.gifts ?? []).map((g) =>
        sql`
          INSERT INTO order_gifts (id, order_id, gift_id, snapshot_name, snapshot_price, quantity)
          VALUES (${uid()}, ${payload.orderId}, ${g.gift_id}, ${g.name}, ${g.price}, ${g.quantity})
        `
      ),
    ]);

    return { orderId: payload.orderId };
  },

  // ADVANCE ORDERS — partial-payment holds. Stock is NOT deducted here; that
  // happens only when the balance is collected and finalizeAdvanceOrder runs.
  async listAdvanceOrders(): Promise<AdvanceOrderWithRelations[]> {
    const rows = await sql`
      SELECT a.*, COALESCE(a.customer_name, c.name) AS customer_name, c.phone AS customer_phone, c.address AS customer_address
      FROM advance_orders a
      JOIN customers c ON c.id = a.customer_id
      ORDER BY a.created_at DESC
    `;
    if (rows.length === 0) return [];

    const ids = rows.map((r: any) => r.id);
    const items = await sql`
      SELECT * FROM advance_order_items WHERE advance_order_id = ANY(${ids})
    `;

    return rows.map((r: any) => ({
      ...r,
      items: (items as AdvanceOrderItemRow[]).filter((i) => i.advance_order_id === r.id),
    })) as AdvanceOrderWithRelations[];
  },

  async getAdvanceOrder(id: string): Promise<AdvanceOrderWithRelations | null> {
    const rows = await sql`
      SELECT a.*, COALESCE(a.customer_name, c.name) AS customer_name, c.phone AS customer_phone, c.address AS customer_address
      FROM advance_orders a
      JOIN customers c ON c.id = a.customer_id
      WHERE a.id = ${id}
    `;
    if (rows.length === 0) return null;
    const items = await sql`SELECT * FROM advance_order_items WHERE advance_order_id = ${id}`;
    return { ...(rows[0] as any), items: items as AdvanceOrderItemRow[] } as AdvanceOrderWithRelations;
  },

  async advanceOrderIdExists(id: string): Promise<boolean> {
    const rows = await sql`SELECT 1 FROM advance_orders WHERE id = ${id} LIMIT 1`;
    return rows.length > 0;
  },

  async createAdvanceOrder(payload: {
    advanceOrderId: string;
    customerName: string;
    customerPhone: string;
    customerAddress?: string | null;
    subtotal: number;
    totalAmount: number;
    depositAmount: number;
    depositPaymentMode: PaymentMode;
    deliveryDate: string | null;
    notes: string | null;
    isGst?: boolean;
    gstPercentage?: number;
    discountType?: 'PERCENT' | 'FIXED';
    discountValue?: number;
    discountAmount?: number;
    items: {
      product_id: string | null;
      snapshot_name: string;
      snapshot_desc: string | null;
      snapshot_price: number;
      quantity: number;
    }[];
  }): Promise<{ advanceOrderId: string }> {
    const customer = await this.upsertCustomer(
      payload.customerName,
      payload.customerPhone,
      payload.customerAddress,
    );

    await sql`
      INSERT INTO advance_orders (
        id, customer_id, customer_name, status, subtotal, total_amount, deposit_amount,
        deposit_payment_mode, delivery_date, notes, is_gst, gst_percentage,
        discount_type, discount_value, discount_amount
      ) VALUES (
        ${payload.advanceOrderId}, ${customer.id}, ${payload.customerName}, 'PENDING',
        ${payload.subtotal}, ${payload.totalAmount}, ${payload.depositAmount},
        ${payload.depositPaymentMode}, ${payload.deliveryDate}, ${payload.notes},
        ${Boolean(payload.isGst)}, ${payload.isGst ? payload.gstPercentage ?? 0 : 0},
        ${(payload.discountAmount ?? 0) > 0 ? payload.discountType ?? 'FIXED' : null},
        ${payload.discountValue ?? 0}, ${payload.discountAmount ?? 0}
      )
    `;

    await Promise.all(
      payload.items.map((it) =>
        sql`
          INSERT INTO advance_order_items (
            id, advance_order_id, product_id, snapshot_name, snapshot_desc, snapshot_price, quantity
          ) VALUES (
            ${uid()}, ${payload.advanceOrderId}, ${it.product_id},
            ${it.snapshot_name}, ${it.snapshot_desc}, ${it.snapshot_price}, ${it.quantity}
          )
        `,
      ),
    );

    return { advanceOrderId: payload.advanceOrderId };
  },

  async updateAdvanceOrderStatus(id: string, status: AdvanceOrderStatus): Promise<void> {
    await sql`UPDATE advance_orders SET status = ${status} WHERE id = ${id}`;
  },

  async cancelAdvanceOrder(id: string): Promise<void> {
    await sql`
      UPDATE advance_orders
      SET status = 'CANCELLED', cancelled_at = now()
      WHERE id = ${id}
    `;
  },

  async deleteAdvanceOrder(id: string): Promise<void> {
    await sql`DELETE FROM advance_orders WHERE id = ${id}`;
  },

  // Collect the remaining balance and turn the hold into a real invoice.
  // Reuses submitOrder for FIFO stock deduction and revenue recognition.
  async finalizeAdvanceOrder(payload: {
    advanceOrderId: string;
    invoiceId: string;
    isGst: boolean;
    gstPercentage: number;
    discountType: 'PERCENT' | 'FIXED';
    discountValue: number;
    discountAmount: number;
    deliveryFee: number;
    paymentMode: PaymentMode;
    billDate: string;
  }): Promise<{ orderId: string }> {
    const advance = await this.getAdvanceOrder(payload.advanceOrderId);
    if (!advance) throw new Error('Advance order not found');
    if (advance.status === 'COMPLETED') throw new Error('Advance order already finalized');
    if (advance.status === 'CANCELLED') throw new Error('Advance order was cancelled');

    // Each product's own GST rate (saved with the product), so the invoice can split GST per rate.
    // Custom lines with no product fall back to the rate chosen at collection.
    const pct = payload.isGst ? payload.gstPercentage : 0;
    const advProductIds = Array.from(
      new Set(advance.items.filter((it) => it.product_id).map((it) => it.product_id as string)),
    );
    const rateRows = advProductIds.length
      ? ((await sql`SELECT id, gst_rate FROM products WHERE id = ANY(${advProductIds})`) as { id: string; gst_rate: number | string }[])
      : [];
    const rateByProduct = new Map(rateRows.map((r) => [r.id, Number(r.gst_rate) || 0]));

    // Rebuild cart from the stored snapshot items.
    const cart: CartItem[] = advance.items.map((it) => ({
      id: it.id,
      product_id: it.product_id,
      batch_id: null,
      unit_id: null,
      serial: null,
      name: it.snapshot_name,
      desc: it.snapshot_desc || '',
      price: Number(it.snapshot_price),
      qty: it.quantity,
      gst_rate: payload.isGst ? (it.product_id ? rateByProduct.get(it.product_id) ?? pct : pct) : 0,
    }));

    // Start from the total agreed when the order was booked (booking discount/delivery included),
    // then apply the discount given at collection. Prices are GST-inclusive: GST is never added
    // on top, it is only the portion already contained in the agreed total.
    const agreedTotal = Number(advance.total_amount) || 0;
    const net = Math.max(0, agreedTotal - payload.discountAmount);

    // The discount given when the order was booked is already inside agreedTotal; carry it onto the
    // invoice so the "Discount Applied" line shows (plus any discount given at collection).
    const bookingDiscount = Number(advance.discount_amount) || 0;
    const totalDiscount = bookingDiscount + payload.discountAmount;
    let invoiceDiscountType: 'PERCENT' | 'FIXED' = payload.discountType;
    let invoiceDiscountValue = payload.discountValue;
    if (bookingDiscount > 0 && payload.discountAmount > 0) {
      invoiceDiscountType = 'FIXED';
      invoiceDiscountValue = totalDiscount;
    } else if (bookingDiscount > 0) {
      invoiceDiscountType = advance.discount_type === 'PERCENT' ? 'PERCENT' : 'FIXED';
      invoiceDiscountValue = Number(advance.discount_value) || bookingDiscount;
    }
    // GST on the actual (pre-discount) line prices, summed per line at each product's own rate.
    const linesTotal = cart.reduce((acc, c) => acc + c.price * c.qty, 0);
    const gstAmount = payload.isGst
      ? cart.reduce((acc, c) => acc + gstInside(c.price * c.qty, c.gst_rate ?? 0), 0)
      : 0;
    const grandTotal = net + payload.deliveryFee;

    const { orderId } = await this.submitOrder({
      orderId: payload.invoiceId,
      customerName: advance.customer_name,
      customerPhone: advance.customer_phone,
      customerAddress: advance.customer_address,
      source: 'OFFLINE',
      isGst: payload.isGst,
      billDate: payload.billDate,
      items: cart,
      discountType: invoiceDiscountType,
      discountValue: invoiceDiscountValue,
      discountAmount: totalDiscount,
      gstPercentage: effectiveGstRate(linesTotal, gstAmount),
      gstAmount,
      deliveryFee: payload.deliveryFee,
      grandTotal,
      cashReceived: grandTotal,
      paymentMode: payload.paymentMode,
    });

    await sql`
      UPDATE advance_orders
      SET status = 'COMPLETED', finalized_order_id = ${orderId}, finalized_at = now()
      WHERE id = ${payload.advanceOrderId}
    `;

    return { orderId };
  },
};
