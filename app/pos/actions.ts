"use server";

import { dbStore } from "@/lib/dbStore";
import { requireSession, requireAdmin, getSession, startSession, endSession, Session } from "@/lib/auth";
import { Product, ProductBatch, ProductWithBatches, ProductUnit, OrderWithRelations, CartItem, Expense, ExpenseCategory, ActionResult, PaymentMode, Category, Gift, AdvanceOrderWithRelations, AdvanceOrderStatus } from "@/lib/types";

// Helper to serialize Date objects from Postgres to strings
function serialize<T>(data: T): T {
  if (data === null || data === undefined) return data;
  return JSON.parse(JSON.stringify(data));
}

// ── Session / auth ──────────────────────────────────────────────────
// Role and staff name come from a signed httpOnly cookie (lib/auth.ts), never from the client.
export async function verifyPasscode(
  enteredPasscode: string,
): Promise<{ success: boolean; role?: 'staff' | 'admin' }> {
  const adminPasscode = process.env.ADMIN_PASSCODE || "admin123";
  const staffPasscode = process.env.STAFF_PASSCODE || process.env.NEXT_PUBLIC_STAFF_PASSCODE || "staff123";

  const normalizedEntered = enteredPasscode.replace(/\s/g, "");

  if (normalizedEntered === adminPasscode) {
    await startSession({ role: 'admin' });
    return { success: true, role: 'admin' };
  }
  if (normalizedEntered === staffPasscode) {
    await startSession({ role: 'staff' });
    return { success: true, role: 'staff' };
  }

  return { success: false };
}

export async function fetchSession(): Promise<Session | null> {
  return await getSession();
}

export async function logoutSession(): Promise<void> {
  await endSession();
}

// Categories
export async function fetchCategories(): Promise<Category[]> {
  return serialize(await dbStore.listCategories());
}

// Product categories. Staff may pick/add; rename and delete are admin-only (checked on the server).
// Mutations return { ok, data | error } because Next hides thrown error messages in production.
export async function createCategory(name: string): Promise<ActionResult<Category>> {
  return guard(async () => {
    await requireSession();
    const clean = name.trim().slice(0, 60);
    if (!clean) throw new Error('Category name is required.');
    return await dbStore.addCategory(clean);
  });
}

export async function renameCategory(id: string, name: string): Promise<ActionResult<Category>> {
  return guard(async () => {
    await requireAdmin();
    const clean = name.trim().slice(0, 60);
    if (!clean) throw new Error('Category name is required.');
    return await dbStore.renameCategory(id, clean);
  });
}

export async function removeCategory(id: string): Promise<ActionResult<{ reassigned: number }>> {
  return guard(async () => {
    await requireAdmin();
    return await dbStore.deleteCategory(id);
  });
}

// Products
export async function fetchProducts(): Promise<ProductWithBatches[]> {
  return serialize(await dbStore.listProductsWithBatches());
}

export async function createProduct(data: { name: string; description: string | null; description2?: string | null; category: string; gst_rate: number; low_stock_threshold: number; tracks_serial?: boolean }): Promise<Product> {
  return serialize(await dbStore.addProduct(data));
}

export async function editProduct(id: string, data: Partial<Product>): Promise<Product | null> {
  return serialize(await dbStore.updateProduct(id, data));
}

export async function removeProduct(id: string): Promise<void> {
  return await dbStore.deleteProduct(id);
}

// Batches
export async function createBatch(
  productId: string,
  data: Omit<ProductBatch, 'id' | 'product_id' | 'arrived_at'> & { serials?: string[] },
): Promise<ProductBatch> {
  return serialize(await dbStore.addBatch({
    product_id: productId,
    ...data,
  }));
}

export async function editBatch(id: string, data: Partial<ProductBatch>): Promise<ProductBatch | null> {
  return serialize(await dbStore.updateBatch(id, data));
}

export async function removeBatch(id: string): Promise<void> {
  return await dbStore.deleteBatch(id);
}

// Product units (individual IMEI / serial rows)
export async function fetchProductUnits(productId: string): Promise<ProductUnit[]> {
  return serialize(await dbStore.listUnits(productId));
}

export async function editUnitSerial(id: string, serial: string): Promise<ProductUnit | null> {
  return serialize(await dbStore.updateUnitSerial(id, serial.trim()));
}

export async function removeUnit(id: string): Promise<{ deleted: boolean; reason?: string }> {
  return await dbStore.deleteUnit(id);
}

export async function addUnits(batchId: string, productId: string, serials: string[]): Promise<number> {
  return await dbStore.addUnitsToBatch(batchId, productId, serials);
}

// Orders
export async function fetchOrders(): Promise<OrderWithRelations[]> {
  return serialize(await dbStore.listOrdersWithRelations());
}

export async function fetchOrderById(id: string): Promise<OrderWithRelations | null> {
  return serialize(await dbStore.getOrderWithRelations(id));
}

export async function orderIdExists(id: string): Promise<boolean> {
  return await dbStore.orderIdExists(id);
}

export async function submitOrder(payload: {
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
  splitMode2?: PaymentMode | null;
  splitAmount1?: number;
  splitAmount2?: number;
  gifts?: { gift_id: string | null; name: string; price: number; quantity: number }[];
}): Promise<{ orderId: string }> {
  return await dbStore.submitOrder(payload);
}

// Gifts (free add-ons; excluded from all analytics)
export async function fetchGifts(): Promise<Gift[]> {
  return serialize(await dbStore.listGifts());
}

export async function createGift(name: string, price: number): Promise<Gift> {
  return serialize(await dbStore.addGift(name.trim(), price));
}

export async function editGift(id: string, name: string, price: number): Promise<Gift | null> {
  return serialize(await dbStore.updateGift(id, name.trim(), price));
}

export async function removeGift(id: string): Promise<void> {
  return await dbStore.deleteGift(id);
}

export async function removeOrder(id: string): Promise<void> {
  return await dbStore.deleteOrder(id);
}

// ── Expense categories ──────────────────────────────────────────────
// Staff may list and ADD categories; renaming/deleting is admin-only.
// Mutations return { ok, data | error } because Next hides thrown error messages in production.
async function guard<T>(fn: () => Promise<T>): Promise<ActionResult<T>> {
  try {
    return { ok: true, data: serialize(await fn()) };
  } catch (err) {
    return { ok: false, error: err instanceof Error ? err.message : 'Something went wrong.' };
  }
}

export async function fetchExpenseCategories(): Promise<ExpenseCategory[]> {
  await requireSession();
  return serialize(await dbStore.listExpenseCategories());
}

export async function createExpenseCategory(name: string): Promise<ActionResult<ExpenseCategory>> {
  return guard(async () => {
    await requireSession();
    const clean = name.trim().slice(0, 60);
    if (!clean) throw new Error('Category name is required.');
    return await dbStore.addExpenseCategory(clean);
  });
}

export async function renameExpenseCategory(id: string, name: string): Promise<ActionResult<ExpenseCategory>> {
  return guard(async () => {
    await requireAdmin();
    const clean = name.trim().slice(0, 60);
    if (!clean) throw new Error('Category name is required.');
    return await dbStore.renameExpenseCategory(id, clean);
  });
}

export async function removeExpenseCategory(id: string): Promise<ActionResult<{ reassigned: number }>> {
  return guard(async () => {
    await requireAdmin();
    return await dbStore.deleteExpenseCategory(id);
  });
}

// ── Expenses ────────────────────────────────────────────────────────
const EXPENSE_PAYMENT_MODES = ['CASH', 'UPI', 'CARD', 'BANK', 'OTHER'];

type ExpenseInput = {
  title: string;
  category: string;
  amount: number;
  payment_mode: string;
  notes: string | null;
  expense_date: string;
};

// Validates user input and resolves the category to its canonical stored name.
async function cleanExpenseInput(data: ExpenseInput): Promise<ExpenseInput> {
  const title = String(data.title ?? '').trim().slice(0, 200);
  if (!title) throw new Error('Please enter what the expense was for.');
  const amount = Number(data.amount);
  if (!isFinite(amount) || amount <= 0 || amount > 100000000) {
    throw new Error('Please enter a valid amount greater than 0.');
  }
  if (!/^\d{4}-\d{2}-\d{2}$/.test(String(data.expense_date))) throw new Error('Please pick a valid date.');
  if (!EXPENSE_PAYMENT_MODES.includes(data.payment_mode)) throw new Error('Invalid payment mode.');
  const cats = await dbStore.listExpenseCategories();
  const cat = cats.find((c) => c.name.toLowerCase() === String(data.category ?? '').trim().toLowerCase());
  if (!cat) throw new Error('Unknown category. Pick one from the list.');
  return {
    title,
    category: cat.name,
    amount,
    payment_mode: data.payment_mode,
    notes: data.notes?.trim().slice(0, 500) || null,
    expense_date: data.expense_date,
  };
}

export async function fetchExpenses(): Promise<Expense[]> {
  await requireSession();
  return serialize(await dbStore.listExpenses());
}

// Staff and admin can add expenses; only admin can edit or delete them (checked on the server).
export async function createExpense(data: ExpenseInput): Promise<ActionResult<Expense>> {
  return guard(async () => {
    await requireSession();
    return await dbStore.addExpense(await cleanExpenseInput(data));
  });
}

export async function editExpense(id: string, data: ExpenseInput): Promise<ActionResult<Expense>> {
  return guard(async () => {
    await requireAdmin();
    const clean = await cleanExpenseInput(data);
    const updated = await dbStore.updateExpense(id, clean);
    if (!updated) throw new Error('Expense not found.');
    return updated;
  });
}

export async function removeExpense(id: string): Promise<ActionResult<null>> {
  return guard(async () => {
    await requireAdmin();
    await dbStore.deleteExpense(id);
    return null;
  });
}

// Advance Orders (partial-payment holds — not revenue until finalized)
export async function fetchAdvanceOrders(): Promise<AdvanceOrderWithRelations[]> {
  return serialize(await dbStore.listAdvanceOrders());
}

export async function fetchAdvanceOrderById(id: string): Promise<AdvanceOrderWithRelations | null> {
  return serialize(await dbStore.getAdvanceOrder(id));
}

export async function advanceOrderIdExists(id: string): Promise<boolean> {
  return await dbStore.advanceOrderIdExists(id);
}

export async function createAdvanceOrder(payload: {
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
  return await dbStore.createAdvanceOrder(payload);
}

export async function setAdvanceOrderStatus(id: string, status: AdvanceOrderStatus): Promise<void> {
  return await dbStore.updateAdvanceOrderStatus(id, status);
}

export async function cancelAdvanceOrder(id: string): Promise<void> {
  return await dbStore.cancelAdvanceOrder(id);
}

export async function removeAdvanceOrder(id: string): Promise<void> {
  return await dbStore.deleteAdvanceOrder(id);
}

export async function finalizeAdvanceOrder(payload: {
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
  return await dbStore.finalizeAdvanceOrder(payload);
}
