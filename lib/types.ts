export type Category = {
  id: string;
  name: string;
  created_at: string;
};

export type Product = {
  id: string;
  name: string;
  description: string | null;
  description2: string | null; // Optional second description; shown hyphen-joined with description
  category: string;
  gst_rate: number; // Default GST % for this product (editable at billing)
  low_stock_threshold: number;
  tracks_serial: boolean; // true = each unit has an IMEI / serial (phones, laptops); false = accessories
  created_at: string;
};

// One physical unit of a serialized product (IMEI / serial number).
export type ProductUnit = {
  id: string;
  product_id: string;
  batch_id: string;
  serial: string;
  status: 'AVAILABLE' | 'SOLD';
  order_id: string | null;
  sold_at: string | null;
  created_at: string;
};

export type ProductBatch = {
  id: string;
  product_id: string;
  batch_no: string | null;
  manufacturer: string | null; // Brand / supplier
  hsn_code: string | null;
  cost_price: number;
  selling_price: number;
  stock_quantity: number;
  arrived_at: string;
};

export type ProductWithBatches = Product & {
  batches: ProductBatch[];
  total_stock: number;
  active_selling_price: number;
  // For serialized products: the units still available to sell (status = AVAILABLE).
  available_units: ProductUnit[];
};

export type Customer = {
  id: string;
  name: string;
  phone: string;
  address: string | null;
  created_at: string;
};

export type PaymentMode = 'CASH' | 'TVS' | 'BAJAJ' | 'HDP' | 'DMI' | 'GPAY';

export type OrderRow = {
  id: string;
  customer_id: string;
  source: 'ONLINE' | 'OFFLINE';
  status: 'COMPLETED' | 'PENDING';
  is_gst: boolean; // true = GST invoice, false = non-GST bill
  subtotal: number; // GST-inclusive (line price × qty)
  discount_type: 'PERCENT' | 'FIXED';
  discount_value: number;
  discount_amount: number;
  gst_percentage: number;
  gst_amount: number; // GST contained inside subtotal-discount (price is GST-inclusive, so it is never added on top)
  delivery_fee: number;
  grand_total: number; // = subtotal - discount + delivery
  cash_received: number;
  payment_mode: PaymentMode; // primary mode; for a split this is the FIRST mode
  // Split payment: when split_mode_2 is set, the bill was paid across two modes —
  // payment_mode receives split_amount_1 and split_mode_2 receives split_amount_2.
  split_mode_2: PaymentMode | null;
  split_amount_1: number;
  split_amount_2: number;
  bill_date: string;
  created_at: string;
};

export type OrderItemRow = {
  id: string;
  order_id: string;
  product_id: string | null;
  batch_id: string | null;
  unit_id: string | null;
  snapshot_name: string;
  snapshot_price: number;
  snapshot_serial: string | null; // IMEI / serial sold, frozen at time of sale
  snapshot_gst_rate?: number | null; // GST % this line was sold at (price is GST-inclusive); null on old orders
  quantity: number;
  // Populated via JOIN for the invoice (not stored on the row itself).
  batch_no?: string | null; // batch number of the batch this line was sold from
  product_description?: string | null;
  product_description2?: string | null;
};

// Free add-on given with a bill. Price is informational only — never part of
// order totals, GST, revenue or analytics.
export type Gift = {
  id: string;
  name: string;
  price: number;
  created_at: string;
};

export type OrderGiftRow = {
  id: string;
  order_id: string;
  gift_id: string | null;
  snapshot_name: string;
  snapshot_price: number;
  quantity: number;
};

export type OrderWithRelations = OrderRow & {
  customer_name: string;
  customer_phone: string;
  customer_address: string | null;
  items: OrderItemRow[];
  gifts?: OrderGiftRow[];
};

export type ExpenseCategory = {
  id: string;
  name: string;
  sort_order: number;
  created_at: string;
};

export type Expense = {
  id: string;
  title: string;
  category: string;
  amount: number;
  payment_mode: string; // CASH | UPI | CARD | BANK | OTHER
  notes: string | null;
  expense_date: string;
  created_at: string;
};

export type ActionResult<T> = { ok: true; data: T } | { ok: false; error: string };

export type AdvanceOrderStatus = 'PENDING' | 'READY' | 'COMPLETED' | 'CANCELLED';

export type AdvanceOrderRow = {
  id: string;
  customer_id: string;
  status: AdvanceOrderStatus;
  subtotal: number;
  total_amount: number;
  deposit_amount: number;
  deposit_payment_mode: PaymentMode;
  delivery_date: string | null;
  notes: string | null;
  is_gst?: boolean;
  gst_percentage?: number | string;
  // Discount given when the order was booked (already taken off total_amount).
  discount_type?: 'PERCENT' | 'FIXED' | null;
  discount_value?: number | string;
  discount_amount?: number | string;
  finalized_order_id: string | null;
  finalized_at: string | null;
  cancelled_at: string | null;
  created_at: string;
};

export type AdvanceOrderItemRow = {
  id: string;
  advance_order_id: string;
  product_id: string | null;
  snapshot_name: string;
  snapshot_desc: string | null;
  snapshot_price: number;
  quantity: number;
};

export type AdvanceOrderWithRelations = AdvanceOrderRow & {
  customer_name: string;
  customer_phone: string;
  customer_address: string | null;
  items: AdvanceOrderItemRow[];
};

export type CartItem = {
  id: string;
  product_id: string | null;
  batch_id: string | null;
  unit_id?: string | null; // specific serialized unit being sold (if any)
  serial?: string | null; // its IMEI / serial, for snapshotting
  name: string;
  desc: string;
  price: number; // GST-inclusive selling price
  qty: number;
  gst_rate?: number; // GST % of the product (carved out of price on a GST invoice)
};
