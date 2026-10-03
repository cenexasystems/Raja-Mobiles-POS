"use client";

import React, { useState, useRef, useEffect, useCallback } from "react";
import {
  User,
  Receipt,
  Search,
  ChevronDown,
  X,
  PackagePlus,
  ShoppingBag,
  Trash2,
  Plus,
  TrendingUp,
  Trophy,
  IndianRupee,
  BarChart2,
  Package,
  List,
  Globe,
  Zap,
  Menu,
  Printer,
  History,
  ChevronLeft,
  ChevronRight,
  Percent,
  Calendar,
  Download,
  LogOut,
  Eye,
  EyeOff,
  ShieldCheck,
  Shield,
  Lock,
  Pencil,
  Boxes,
  AlertTriangle,
  Smartphone,
  Check,
  PackageX,
  Wallet,
  TrendingDown,
  Coins,
  Tag,
  Banknote,
  PiggyBank,
  ArrowUpDown,
  ArrowUp,
  ArrowDown,
  Loader2,
  Clock,
  MessageSquare,
} from "lucide-react";
import {
  verifyPasscode,
  fetchProducts,
  fetchOrders,
  submitOrder,
  removeOrder,
  createProduct,
  editProduct,
  removeProduct,
  createBatch,
  removeBatch,
  editBatch,
  fetchExpenses,
  createExpense,
  removeExpense,
  fetchCategories,
  createCategory,
  fetchExpenseCategories,
  editExpense,
  fetchSession,
  logoutSession,
  fetchProductUnits,
  editUnitSerial,
  removeUnit,
  fetchAdvanceOrders,
  createAdvanceOrder,
  cancelAdvanceOrder,
  removeAdvanceOrder,
  finalizeAdvanceOrder,
  setAdvanceOrderStatus,
} from "@/app/pos/actions";
import { ProductWithBatches, ProductBatch, ProductUnit, CartItem, Expense, ExpenseCategory, Category, AdvanceOrderWithRelations, AdvanceOrderStatus } from "@/lib/types";
import { effectiveGstRate, gstInside, isLegacyAddedGst } from "@/lib/gst";
import ProductCategoryInput from "./ProductCategoryInput";
import ExpenseCategoryPicker, { FALLBACK_EXPENSE_CATEGORY } from "./ExpenseCategoryPicker";

const EXPENSE_PAYMENT_MODES = ["CASH", "UPI", "CARD", "BANK", "OTHER"] as const;

// Payment / financing options available at the point of sale.
// Kept in sync with the CHECK constraint on orders.payment_mode in schema.sql.
const ORDER_PAYMENT_MODES = ["CASH", "TVS", "BAJAJ", "HDP", "DMI", "GPAY"] as const;
type OrderPaymentMode = (typeof ORDER_PAYMENT_MODES)[number];

// Shared date-window test reused by the Expenses tab and the analytics dashboard.
type PeriodKey = "all" | "today" | "week" | "month" | "year" | "custom";
const isDateInPeriod = (
  dateStr: string,
  period: PeriodKey,
  startStr: string,
  endStr: string,
): boolean => {
  const now = new Date();
  const d = new Date(dateStr);
  if (isNaN(d.getTime())) return false;
  if (period === "all") return true;
  if (period === "today")
    return (
      d.getDate() === now.getDate() &&
      d.getMonth() === now.getMonth() &&
      d.getFullYear() === now.getFullYear()
    );
  if (period === "week") {
    const start = new Date(now);
    const dow = start.getDay();
    start.setDate(start.getDate() + (dow === 0 ? -6 : 1 - dow)); // Monday start
    start.setHours(0, 0, 0, 0);
    return d >= start;
  }
  if (period === "month")
    return d.getMonth() === now.getMonth() && d.getFullYear() === now.getFullYear();
  if (period === "year") return d.getFullYear() === now.getFullYear();
  // custom range
  const t = d.getTime();
  const s = startStr ? new Date(startStr) : null;
  if (s) s.setHours(0, 0, 0, 0);
  const e = endStr ? new Date(endStr) : null;
  if (e) e.setHours(23, 59, 59, 999);
  if (s && e) return t >= s.getTime() && t <= e.getTime();
  if (s) return t >= s.getTime();
  if (e) return t <= e.getTime();
  return true;
};

// Join two descriptions for display as "desc1 - desc2" (either may be empty).
const combineDesc = (d1?: string | null, d2?: string | null): string =>
  [d1, d2].map((d) => (d || "").trim()).filter(Boolean).join(" - ");

// Today's date (YYYY-MM-DD) in the device's LOCAL timezone. toISOString() is UTC, which is
// still "yesterday" in India before 5:30 AM and would mis-date bills / break "Today" filters.
const localDateStr = (d: Date = new Date()): string =>
  `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}-${String(d.getDate()).padStart(2, "0")}`;

const money = (n: number) =>
  `₹${(Number(n) || 0).toLocaleString(undefined, { minimumFractionDigits: 2 })}`;

// Human-readable payment summary — shows the split breakdown when the order was split.
const paymentSummary = (o: {
  paymentMode: string;
  splitMode2?: string | null;
  splitAmount1?: number;
  splitAmount2?: number;
}): string =>
  o.splitMode2
    ? `${o.paymentMode} ${money(o.splitAmount1 || 0)} + ${o.splitMode2} ${money(o.splitAmount2 || 0)}`
    : o.paymentMode;

type CatalogItem = {
  id: string;
  name: string;
  desc?: string; // raw first description
  desc2?: string; // raw second description (shown hyphen-joined with desc)
  category?: string;
  price?: number;
  gstRate?: number;
  stockQuantity?: number;
  lowStockThreshold?: number;
  batchNo?: string;
  manufacturer?: string;
  hsnCode?: string;
  batches?: ProductBatch[];
  productId?: string;
  tracksSerial?: boolean;
  availableUnits?: ProductUnit[];
};

type OrderItem = {
  id: string;
  name: string;
  desc: string;
  price: number;
  qty: number;
  product_id?: string | null;
  batch_id?: string | null;
  unit_id?: string | null;
  serial?: string | null;
};

type CompletedOrder = {
  id: string;
  customerName: string;
  customerPhone: string;
  customerAddress?: string | null;
  source: "ONLINE" | "OFFLINE";
  isGst: boolean;
  items: OrderItem[];
  subtotal: number;
  discount: number;
  discountType?: "PERCENT" | "FIXED";
  discountValue?: number;
  gstPercentage?: number;
  gstAmount?: number;
  deliveryFee: number;
  grandTotal: number;
  cashReceived: number;
  paymentMode: OrderPaymentMode;
  splitMode2?: OrderPaymentMode | null;
  splitAmount1?: number;
  splitAmount2?: number;
  date: string;
  createdAt: string;
  status: "Completed" | "Pending";
  gifts?: { name: string; price: number }[];
};

const SearchableItemInput = ({
  item,
  catalog,
  updateItem,
  activeCategory = "ALL",
}: {
  item: OrderItem;
  catalog: CatalogItem[];
  updateItem: (id: string, field: keyof OrderItem, value: any) => void;
  activeCategory?: string;
}) => {
  const [isOpen, setIsOpen] = useState(false);
  const [internalSearch, setInternalSearch] = useState("");
  const [selectedIndex, setSelectedIndex] = useState(0);
  const wrapperRef = useRef<HTMLDivElement>(null);
  const listRef = useRef<HTMLUListElement>(null);

  useEffect(() => {
    function handleClickOutside(event: MouseEvent) {
      if (
        wrapperRef.current &&
        !wrapperRef.current.contains(event.target as Node)
      ) {
        setIsOpen(false);
      }
    }
    document.addEventListener("mousedown", handleClickOutside);
    return () => document.removeEventListener("mousedown", handleClickOutside);
  }, []);

  const filteredCatalog = catalog.filter(
    (c) =>
      (activeCategory === "ALL" || (c.category || "General") === activeCategory) &&
      (c.name.toLowerCase().includes(internalSearch.toLowerCase()) ||
        combineDesc(c.desc, c.desc2).toLowerCase().includes(internalSearch.toLowerCase()) ||
        (c.batchNo && c.batchNo.toLowerCase().includes(internalSearch.toLowerCase()))),
  );

  // Apply a catalog pick to this cart row. For serialized products, leave the
  // unit unset so the row can prompt for a specific IMEI/serial next.
  const selectItem = (catItem: CatalogItem) => {
    updateItem(item.id, "name", catItem.name);
    updateItem(item.id, "desc", combineDesc(catItem.desc, catItem.desc2));
    updateItem(item.id, "product_id", catItem.productId || null);
    updateItem(item.id, "unit_id", null);
    updateItem(item.id, "serial", null);
    updateItem(item.id, "batch_id", null);
    if (catItem.price !== undefined) {
      updateItem(item.id, "price", catItem.price);
    }
    if (catItem.tracksSerial) {
      updateItem(item.id, "qty", 1);
    }
    setIsOpen(false);
    // Serialized products need an IMEI chosen next, so don't jump to price.
    if (!catItem.tracksSerial) {
      setTimeout(() => {
        const priceInput = document.getElementById(`price-${item.id}`);
        if (priceInput) priceInput.focus();
      }, 50);
    }
  };

  useEffect(() => {
    setSelectedIndex(0);
  }, [internalSearch, isOpen]);

  useEffect(() => {
    if (listRef.current && listRef.current.children[selectedIndex]) {
      const activeItem = listRef.current.children[selectedIndex] as HTMLElement;
      activeItem.scrollIntoView({ block: "nearest" });
    }
  }, [selectedIndex, isOpen]);

  const handleKeyDown = (e: React.KeyboardEvent) => {
    if (!isOpen && e.key !== "Escape") {
      setIsOpen(true);
    }
    if (e.key === "ArrowDown") {
      e.preventDefault();
      setSelectedIndex((prev) =>
        prev < filteredCatalog.length - 1 ? prev + 1 : prev,
      );
    } else if (e.key === "ArrowUp") {
      e.preventDefault();
      setSelectedIndex((prev) => (prev > 0 ? prev - 1 : prev));
    } else if (e.key === "Enter") {
      e.preventDefault();
      if (filteredCatalog[selectedIndex]) {
        selectItem(filteredCatalog[selectedIndex]);
      } else if (internalSearch.trim()) {
        updateItem(item.id, "name", internalSearch.trim());
        updateItem(item.id, "desc", "");
        setIsOpen(false);
        setTimeout(() => {
          const priceInput = document.getElementById(`price-${item.id}`);
          if (priceInput) priceInput.focus();
        }, 50);
      }
    } else if (e.key === "Escape") {
      setIsOpen(false);
    }
  };

  return (
    <div className="relative w-full" ref={wrapperRef}>
      <div
        className={`relative cursor-pointer bg-[#FFFFFF] border ${isOpen ? "border-black/10 bg-white" : "border-black/10"} hover:border-black/10 rounded-lg px-4 py-2.5 transition-colors flex justify-between items-center group`}
        onClick={() => {
          setIsOpen(!isOpen);
          setInternalSearch("");
        }}
      >
        <div className="flex-1">
          <div className="font-semibold text-[#000000] text-sm">
            {item.name || (
              <span className="text-[#000000] font-normal">
                Select an item...
              </span>
            )}
          </div>
          {item.desc && !isOpen && (
            <div className="text-[10px] text-[#000000] mt-0.5">{item.desc}</div>
          )}
        </div>
        <ChevronDown
          className={`w-4 h-4 text-[#000000] group-hover:text-tertiary transition-transform ${isOpen ? "rotate-180" : ""}`}
        />
      </div>

      {isOpen && (
        <div className="absolute z-50 w-full mt-2 bg-[#FFFFFF] border border-black/10 rounded-lg shadow-[0_10px_40px_rgba(0,0,0,0.12)] overflow-hidden ring-1 ring-black/5 animate-in fade-in zoom-in-95 duration-200">
          <div className="p-2 border-b border-black/10 bg-[#FFFFFF]">
            <div className="bg-[#FFFFFF] flex items-center px-3 py-2 rounded-md">
              <Search className="w-4 h-4 text-[#000000] mr-2" />
              <input
                type="text"
                placeholder="Search catalog..."
                className="w-full bg-transparent text-[#000000] text-sm focus:outline-none placeholder:text-[#000000]"
                value={internalSearch}
                onChange={(e) => setInternalSearch(e.target.value)}
                onKeyDown={handleKeyDown}
                autoFocus
              />
            </div>
          </div>
          <div className="max-h-48 overflow-y-auto">
            {filteredCatalog.length > 0 ? (
              <ul className="py-1" ref={listRef}>
                {filteredCatalog.map((catItem, idx) => {
                  const isOutOfStock = catItem.stockQuantity === 0;
                  return (
                    <li
                      key={catItem.id}
                      className={`px-5 py-3 border-b border-transparent last:border-0 transition-colors ${
                        isOutOfStock
                          ? "opacity-50 cursor-not-allowed"
                          : "cursor-pointer"
                      } ${idx === selectedIndex && !isOutOfStock ? "bg-[#FFFFFF] border-l-4 border-l-[#3F3F46]" : !isOutOfStock ? "hover:bg-[#FFFFFF] border-l-4 border-l-transparent" : "border-l-4 border-l-transparent"}`}
                      onMouseDown={(e) => {
                        e.preventDefault();
                        if (isOutOfStock) return;
                        selectItem(catItem);
                      }}
                      onTouchStart={(e) => {
                        e.preventDefault();
                        if (isOutOfStock) return;
                        selectItem(catItem);
                      }}
                      onClick={() => {
                        if (isOutOfStock) return;
                        selectItem(catItem);
                      }}
                      onMouseEnter={() =>
                        !isOutOfStock && setSelectedIndex(idx)
                      }
                    >
                      <div className="flex justify-between items-center">
                        <div className="text-sm font-bold text-[#000000]">
                          {catItem.name}
                        </div>
                        <div
                          className={`text-[10px] font-bold ${isOutOfStock ? "text-[#27272A]" : "text-green-600"}`}
                        >
                          {isOutOfStock
                            ? "Out of Stock"
                            : `Stock: ${catItem.stockQuantity}`}
                        </div>
                      </div>
                      {combineDesc(catItem.desc, catItem.desc2) && (
                        <div className="text-[11px] font-semibold uppercase tracking-wider text-[#000000] mt-1">
                          {combineDesc(catItem.desc, catItem.desc2)}
                        </div>
                      )}
                      {catItem.batchNo && (
                        <div className="text-[10px] font-bold text-[#3F3F46] mt-0.5">
                          Batch: {catItem.batchNo}
                        </div>
                      )}
                    </li>
                  );
                })}
              </ul>
            ) : (
              <div className="px-5 py-6 text-sm text-[#000000] text-center font-semibold">
                Press Enter to use "{internalSearch}"
              </div>
            )}
          </div>
        </div>
      )}
    </div>
  );
};

export default function POSBilling() {
  const [isAuthorized, setIsAuthorized] = useState<boolean>(false);
  const [role, setRole] = useState<"staff" | "admin" | null>(null);
  const [passcode, setPasscode] = useState<string>("");
  const [passcodeError, setPasscodeError] = useState<string>("");
  const [showPasscode, setShowPasscode] = useState<boolean>(false);
  const [isCheckingAuth, setIsCheckingAuth] = useState<boolean>(true);

  const [activeCategory, setActiveCategory] = useState<string>("ALL");
  const [activeTab, setActiveTab] = useState<
    "billing" | "orders" | "analytics" | "inventory" | "alerts" | "expenses" | "advance"
  >("billing");
  const [isOnline, setIsOnline] = useState(false);
  const [customerName, setCustomerName] = useState("");
  const [customerPhone, setCustomerPhone] = useState("");
  const [customerAddress, setCustomerAddress] = useState("");
  const [customOrderDate, setCustomOrderDate] = useState<string>(
    localDateStr(),
  );
  const [items, setItems] = useState<OrderItem[]>([
    { id: "1", name: "", desc: "", price: 0, qty: 1 },
  ]);
  const [orders, setOrders] = useState<CompletedOrder[]>([]);

  // Advance orders (partial-payment holds) — separate from real revenue.
  const [advanceOrders, setAdvanceOrders] = useState<AdvanceOrderWithRelations[]>([]);
  const [showAdvanceSaveModal, setShowAdvanceSaveModal] = useState(false);
  const [advDeposit, setAdvDeposit] = useState<number | "">("");
  const [advDeliveryDate, setAdvDeliveryDate] = useState<string>("");
  const [advNotes, setAdvNotes] = useState<string>("");
  const [advDepositPaymentMode, setAdvDepositPaymentMode] = useState<OrderPaymentMode>("CASH");
  const [isSavingAdvance, setIsSavingAdvance] = useState(false);
  const [advPeriod, setAdvPeriod] = useState<"all" | "today" | "week" | "month" | "year" | "custom">("all");
  const [advStartDate, setAdvStartDate] = useState<string>(localDateStr());
  const [advEndDate, setAdvEndDate] = useState<string>(localDateStr());

  const [selectedAdvance, setSelectedAdvance] = useState<AdvanceOrderWithRelations | null>(null);
  const [advanceViewMode, setAdvanceViewMode] = useState<"view" | "receive" | null>(null);
  const [receivePaymentMode, setReceivePaymentMode] = useState<OrderPaymentMode>("CASH");
  const [receiveIsGst, setReceiveIsGst] = useState(false);
  const [receiveGstPct, setReceiveGstPct] = useState<number>(18);
  const [isFinalizing, setIsFinalizing] = useState(false);

  const [advSearchQuery, setAdvSearchQuery] = useState("");
  const [advStatusFilter, setAdvStatusFilter] = useState<"ALL" | AdvanceOrderStatus>("ALL");
  const [discountValue, setDiscountValue] = useState<number>(0);
  const [discountType, setDiscountType] = useState<"fixed" | "percent">(
    "fixed",
  );
  const [deliveryFee, setDeliveryFee] = useState<number>(0);
  const [cashReceived, setCashReceived] = useState<number>(0);
  const [paymentMode, setPaymentMode] = useState<OrderPaymentMode>("CASH");
  // Split payment: when on, the bill is paid across two modes with manually-entered amounts.
  const [isSplitPayment, setIsSplitPayment] = useState<boolean>(false);
  const [splitMode1, setSplitMode1] = useState<OrderPaymentMode>("CASH");
  const [splitMode2, setSplitMode2] = useState<OrderPaymentMode>("GPAY");
  const [splitAmount1, setSplitAmount1] = useState<number | "">("");
  const [splitAmount2, setSplitAmount2] = useState<number | "">("");
  const [applyGST, setApplyGST] = useState<boolean>(false);
  const [gstPercentage, setGstPercentage] = useState<number>(18);
  // Changes when the calendar day rolls over so "Today" analytics refresh without a reload.
  const [todayKey, setTodayKey] = useState<string>(() => localDateStr());
  const todayKeyRef = useRef<string>(todayKey);
  // True only when the user picked a bill date by hand; otherwise bills use the real "today".
  const customDateEditedRef = useRef<boolean>(false);
  useEffect(() => {
    const t = setInterval(() => {
      const now = localDateStr();
      const prev = todayKeyRef.current;
      if (prev === now) return;
      todayKeyRef.current = now;
      setTodayKey(now);
      // New day: move the bill-date field forward if it was still on the previous day.
      setCustomOrderDate((d) => (d === prev ? now : d));
    }, 60000);
    return () => clearInterval(t);
  }, []);
  const [activeInvoiceId, setActiveInvoiceId] = useState<string | null>(null);
  const [completedBillData, setCompletedBillData] =
    useState<CompletedOrder | null>(null);
  // "Advance Order Saved" confirmation receipt shown after saving a deposit hold.
  const [savedAdvanceData, setSavedAdvanceData] = useState<{
    id: string;
    customerName: string;
    customerPhone: string;
    orderTotal: number;
    depositPaid: number;
    balanceDue: number;
    depositMode: OrderPaymentMode;
    deliveryDate: string | null;
    items: { name: string; desc: string; price: number; qty: number }[];
  } | null>(null);
  const [isSubmittingOrder, setIsSubmittingOrder] = useState<boolean>(false);

  const [catalog, setCatalog] = useState<CatalogItem[]>([]);
  const [categories, setCategories] = useState<Category[]>([]);
  // Free gifts for the CURRENT bill only (cleared after each sale). Never counted in totals/analytics.
  const [freeGifts, setFreeGifts] = useState<{ name: string; price: number }[]>([]);
  const [isRefreshing, setIsRefreshing] = useState(false);

  // Modal States
  const [showLowStockAlertModal, setShowLowStockAlertModal] = useState<boolean>(false);
  const [lowStockAlertProducts, setLowStockAlertProducts] = useState<CatalogItem[]>([]);


  // Analytics filter/navigation states
  const [analyticsPeriod, setAnalyticsPeriod] = useState<
    "all" | "today" | "week" | "month" | "year" | "custom"
  >("all");
  const [analyticsStartDate, setAnalyticsStartDate] = useState<string>(
    localDateStr(),
  );
  const [analyticsEndDate, setAnalyticsEndDate] = useState<string>(
    localDateStr(),
  );
  const [analyticsSubTab, setAnalyticsSubTab] = useState<
    "revenue" | "today" | "products" | "coupons"
  >("revenue");
  // Which revenue dashboard is shown: all bills, GST invoices only, or non-GST bills only
  const [analyticsGstFilter, setAnalyticsGstFilter] = useState<
    "all" | "gst" | "nongst"
  >("all");
  const [analyticsSearchPhone, setAnalyticsSearchPhone] = useState("");
  const [productSearchQuery, setProductSearchQuery] = useState("");
  const [couponSearchQuery, setCouponSearchQuery] = useState("");

  // Expense tracker state
  const [expenses, setExpenses] = useState<Expense[]>([]);
  const [expTitle, setExpTitle] = useState("");
  const [expenseCategories, setExpenseCategories] = useState<ExpenseCategory[]>([]);
  const [expCategory, setExpCategory] = useState<string>("");
  const [expAmount, setExpAmount] = useState<number | "">("");
  const [expPaymentMode, setExpPaymentMode] = useState<string>("CASH");
  const [expNotes, setExpNotes] = useState("");
  const [expDate, setExpDate] = useState<string>(
    localDateStr(),
  );
  const [isSavingExpense, setIsSavingExpense] = useState(false);
  const [editingExpenseId, setEditingExpenseId] = useState<string | null>(null);
  const [expensePeriod, setExpensePeriod] = useState<
    "all" | "today" | "week" | "month" | "year" | "custom"
  >("month");
  const [expenseStartDate, setExpenseStartDate] = useState<string>(
    localDateStr(),
  );
  const [expenseEndDate, setExpenseEndDate] = useState<string>(
    localDateStr(),
  );
  const [expenseCategoryFilter, setExpenseCategoryFilter] = useState<string>("ALL");
  const [expenseSearch, setExpenseSearch] = useState("");

  // Sorting states
  const [expenseSortField, setExpenseSortField] = useState<
    "date" | "title" | "category" | "payment_mode" | "amount"
  >("date");
  const [expenseSortOrder, setExpenseSortOrder] = useState<"asc" | "desc">("desc");

  const [inventorySortField, setInventorySortField] = useState<
    "name" | "price" | "gst" | "stock" | "brand"
  >("name");
  const [inventorySortOrder, setInventorySortOrder] = useState<"asc" | "desc">("asc");

  const [orderSortField, setOrderSortField] = useState<
    "date" | "id" | "name" | "total" | "status"
  >("date");
  const [orderSortOrder, setOrderSortOrder] = useState<"asc" | "desc">("desc");

  // Main scroll container ref for resetting scroll to top
  const mainScrollRef = useRef<HTMLElement | null>(null);

  // Whenever activeTab, analyticsSubTab, or analyticsGstFilter changes, reset scroll to top
  useEffect(() => {
    if (mainScrollRef.current) {
      mainScrollRef.current.scrollTop = 0;
    }
    window.scrollTo({ top: 0, behavior: "instant" });
  }, [activeTab, analyticsSubTab, analyticsGstFilter]);

  useEffect(() => {
    // The signed server session is the source of truth. sessionStorage only remembers that this
    // browser logged in; the role (and who is logged in) always comes back from the server.
    const auth =
      sessionStorage.getItem("pos_authorized") ||
      localStorage.getItem("pos_authorized");
    if (auth !== "true") {
      setIsCheckingAuth(false);
      return;
    }
    let cancelled = false;
    fetchSession()
      .then((session) => {
        if (cancelled) return;
        if (session) {
          sessionStorage.setItem("pos_authorized", "true");
          sessionStorage.setItem("pos_role", session.role);
          setRole(session.role);
          if (session.role === "staff") setActiveTab("billing");
          setIsAuthorized(true);
        } else {
          // Logged in before server sessions existed, or the session expired: log in again.
          sessionStorage.removeItem("pos_authorized");
          localStorage.removeItem("pos_authorized");
          sessionStorage.removeItem("pos_role");
          localStorage.removeItem("pos_role");
        }
      })
      .catch(() => {})
      .finally(() => {
        if (!cancelled) setIsCheckingAuth(false);
      });
    return () => {
      cancelled = true;
    };
  }, []);

  const handleVerifyPasscode = async (e?: React.FormEvent) => {
    if (e) e.preventDefault();
    const result = await verifyPasscode(passcode);
    if (result && result.success) {
      sessionStorage.setItem("pos_authorized", "true");
      sessionStorage.setItem("pos_role", result.role || "admin");
      setRole(result.role as "staff" | "admin");
      if (result.role === "staff") {
        setActiveTab("billing");
      }
      setIsAuthorized(true);
      setPasscode("");
      setPasscodeError("");
    } else {
      setPasscodeError("Incorrect passcode. Please try again.");
    }
  };

  const handleLogout = () => {
    logoutSession().catch(() => {});
    sessionStorage.removeItem("pos_authorized");
    localStorage.removeItem("pos_authorized");
    sessionStorage.removeItem("pos_role");
    localStorage.removeItem("pos_role");
    setRole(null);
    setPasscode("");
    setPasscodeError("");
    setIsAuthorized(false);
  };

  const productToCatalogItem = (p: ProductWithBatches): CatalogItem => {
    const activeBatch =
      p.batches?.find((b: any) => b.stock_quantity > 0) ||
      (p.batches && p.batches.length > 0 ? p.batches[0] : null);

    return {
      id: p.id,
      productId: p.id,
      name: p.name,
      desc: p.description || undefined,
      desc2: p.description2 || undefined,
      category: p.category || undefined,
      price: Number(p.active_selling_price) || 0,
      gstRate: Number(p.gst_rate) || 0,
      stockQuantity: Number(p.total_stock) || 0,
      lowStockThreshold: Number(p.low_stock_threshold) || 0,
      batches: p.batches,
      batchNo: activeBatch?.batch_no || undefined,
      manufacturer: activeBatch?.manufacturer || undefined,
      hsnCode: activeBatch?.hsn_code || undefined,
      tracksSerial: Boolean(p.tracks_serial),
      availableUnits: p.available_units || [],
    };
  };

  const fetchData = async () => {
    setIsRefreshing(true);
    try {
      const [productsData, ordersData, expensesData, categoriesData, advanceData, expenseCategoriesData] = await Promise.all([
        fetchProducts(),
        fetchOrders(),
        fetchExpenses(),
        fetchCategories(),
        fetchAdvanceOrders(),
        fetchExpenseCategories().catch((err) => {
          console.error("Error loading expense categories:", err);
          return [] as ExpenseCategory[];
        }),
      ]);
      setExpenseCategories(expenseCategoriesData);
      setExpCategory((prev) =>
        prev && expenseCategoriesData.some((c) => c.name === prev)
          ? prev
          : expenseCategoriesData[0]?.name || FALLBACK_EXPENSE_CATEGORY,
      );
      setAdvanceOrders(
        advanceData.map((a) => ({
          ...a,
          subtotal: Number(a.subtotal) || 0,
          total_amount: Number(a.total_amount) || 0,
          deposit_amount: Number(a.deposit_amount) || 0,
          items: a.items.map((i) => ({
            ...i,
            snapshot_price: Number(i.snapshot_price) || 0,
            quantity: Number(i.quantity) || 0,
          })),
        })),
      );
      setCatalog(productsData.map(productToCatalogItem));
      setCategories(categoriesData);
      setExpenses(
        expensesData.map((e) => ({ ...e, amount: Number(e.amount) || 0 })),
      );

      setOrders(
        ordersData.map((o) => {
          return {
            id: o.id,
            customerName: o.customer_name || "Guest",
            customerPhone: o.customer_phone,
            customerAddress: o.customer_address || null,
            source: o.source,
            isGst: Boolean(o.is_gst),
            items: o.items.map((i) => ({
              id: i.id,
              name: i.snapshot_name,
              desc: i.snapshot_name === "Custom Item" ? "Custom" : "",
              price: Number(i.snapshot_price) || 0,
              qty: Number(i.quantity) || 0,
              serial: i.snapshot_serial || null,
            })),
            subtotal: Number(o.subtotal) || 0,
            discount: Number(o.discount_amount) || 0,
            discountType: o.discount_type,
            discountValue: o.discount_value
              ? Number(o.discount_value)
              : undefined,
            gstPercentage: Number(o.gst_percentage) || 0,
            gstAmount: Number(o.gst_amount) || 0,
            deliveryFee: Number(o.delivery_fee) || 0,
            grandTotal: Number(o.grand_total) || 0,
            cashReceived: Number(o.cash_received) || 0,
            paymentMode: (ORDER_PAYMENT_MODES as readonly string[]).includes(
              String(o.payment_mode),
            )
              ? (o.payment_mode as OrderPaymentMode)
              : "CASH",
            splitMode2: o.split_mode_2
              ? (o.split_mode_2 as OrderPaymentMode)
              : null,
            splitAmount1: Number(o.split_amount_1) || 0,
            splitAmount2: Number(o.split_amount_2) || 0,
            date: o.bill_date,
            createdAt: o.created_at,
            status: o.status === "COMPLETED" ? "Completed" : "Pending",
          };
        }),
      );
    } catch (err) {
      console.error("Error refreshing data:", err);
    } finally {
      setIsRefreshing(false);
    }
  };

  useEffect(() => {
    fetchData();
    if (typeof window !== "undefined" && window.innerWidth < 1280) {
      setIsSidebarOpen(false);
    }
  }, []);

  // Modal State
  const [isSidebarOpen, setIsSidebarOpen] = useState(true);
  const [showCatalogModal, setShowCatalogModal] = useState(false);
  const [editingCatalogId, setEditingCatalogId] = useState<string | null>(null);
  const [editingBatchId, setEditingBatchId] = useState<string | null>(null);
  const [selectedOrder, setSelectedOrder] = useState<CompletedOrder | null>(
    null,
  );
  const [newCatName, setNewCatName] = useState("");
  const [newCatDesc, setNewCatDesc] = useState("");
  const [newCatDesc2, setNewCatDesc2] = useState("");
  const [newCatPrice, setNewCatPrice] = useState<number | "">("");
  const [newCatCostPrice, setNewCatCostPrice] = useState<number | "">("");
  const [newCatGst, setNewCatGst] = useState<number | "">(18);
  const [newCatStock, setNewCatStock] = useState<number | "">("");
  const [newCatThreshold, setNewCatThreshold] = useState<number | "">(5);
  const [newCatBatch, setNewCatBatch] = useState<string>("");
  const [newCatManufacturer, setNewCatManufacturer] = useState<string>("");
  const [newCatHsn, setNewCatHsn] = useState<string>("");
  const [newCatCategory, setNewCatCategory] = useState<string>("");
  const [newCatTracksSerial, setNewCatTracksSerial] = useState<boolean>(false);
  // One editable row per unit: serialInputs.length is the unit count.
  const [serialInputs, setSerialInputs] = useState<string[]>([]);

  // Manage-IMEIs modal state
  const [showUnitsModal, setShowUnitsModal] = useState<boolean>(false);
  const [unitsTargetProductId, setUnitsTargetProductId] = useState<string | null>(null);
  const [unitsTargetName, setUnitsTargetName] = useState<string>("");
  const [unitRows, setUnitRows] = useState<ProductUnit[]>([]);
  const [isLoadingUnits, setIsLoadingUnits] = useState<boolean>(false);
  const [isSavingCatalog, setIsSavingCatalog] = useState<boolean>(false); // guards Save Product / Save Batch against double-clicks
  const [inventorySearch, setInventorySearch] = useState<string>("");
  const [alertedIds, setAlertedIds] = useState<Set<string>>(new Set());
  const [expandedProductId, setExpandedProductId] = useState<string | null>(
    null,
  );
  const [showBatchModal, setShowBatchModal] = useState<boolean>(false);
  const [batchTargetProductId, setBatchTargetProductId] = useState<
    string | null
  >(null);

  const [activeCatalogRowId, setActiveCatalogRowId] = useState<string | null>(
    null,
  );
  const [catalogSearch, setCatalogSearch] = useState("");
  const [catalogTargetRowId, setCatalogTargetRowId] = useState<string | null>(
    null,
  );

  // Order search/filters state
  const [orderSearchId, setOrderSearchId] = useState("");
  const [orderSearchName, setOrderSearchName] = useState("");
  const [orderSearchPhone, setOrderSearchPhone] = useState("");
  const [orderFilterSource, setOrderFilterSource] = useState("ALL");
  const [orderFilterStatus, setOrderFilterStatus] = useState("ALL");
  const [historyPeriod, setHistoryPeriod] = useState<
    "all" | "today" | "week" | "month" | "year" | "custom"
  >("all");
  const [historyStartDate, setHistoryStartDate] = useState<string>(
    localDateStr(),
  );
  const [historyEndDate, setHistoryEndDate] = useState<string>(
    localDateStr(),
  );

  const [selectedCoupon, setSelectedCoupon] = useState<string>("none");
  const coupons = [
    { code: "none", label: "No Coupon", type: "fixed", value: 0 },
    {
      code: "WELCOME10",
      label: "WELCOME10 (10% Off)",
      type: "percent",
      value: 10,
    },
    {
      code: "SUPERPOS",
      label: "SUPERPOS (₹100 Off)",
      type: "fixed",
      value: 100,
    },
    {
      code: "FESTIVE15",
      label: "FESTIVE15 (15% Off)",
      type: "percent",
      value: 15,
    },
  ];

  const handleCouponChange = (code: string) => {
    setSelectedCoupon(code);
    const coupon = coupons.find((c) => c.code === code);
    if (coupon) {
      setDiscountType(coupon.type as "fixed" | "percent");
      setDiscountValue(coupon.value);
    }
  };

  const getCouponCodeForOrder = (order: CompletedOrder) => {
    if (order.discount === 0) return "NONE";
    const matched = coupons.find((c) => {
      if (c.code === "none") return false;
      if (order.discountType && order.discountValue) {
        const typeMatches =
          c.type === (order.discountType === "PERCENT" ? "percent" : "fixed");
        const valMatches = c.value === order.discountValue;
        return typeMatches && valMatches;
      }
      if (c.type === "fixed") {
        return c.value === order.discount;
      } else {
        const calculated = order.subtotal * (c.value / 100);
        return Math.abs(calculated - order.discount) < 2;
      }
    });
    return matched ? matched.code.toUpperCase() : "PROMO";
  };

  const addItem = () => {
    setItems([
      ...items,
      { id: Math.random().toString(), name: "", desc: "", price: 0, qty: 1 },
    ]);
  };

  const removeItem = (id: string) => {
    setItems(items.filter((item) => item.id !== id));
  };

  const updateItem = (id: string, field: keyof OrderItem, value: any) => {
    setItems((prev) =>
      prev.map((item) => (item.id === id ? { ...item, [field]: value } : item)),
    );
  };

  const handleQtyChange = (id: string, newQty: number) => {
    setItems((prev) =>
      prev.map((item) => {
        if (item.id !== id) return item;
        let finalQty = Math.max(1, newQty);
        // Find catalog item by product_id OR by exact/case-insensitive name
        const catItem = catalog.find(
          (c) =>
            (item.product_id &&
              (c.id === item.product_id || c.productId === item.product_id)) ||
            (item.name &&
              c.name.trim().toLowerCase() === item.name.trim().toLowerCase()),
        );
        if (catItem && typeof catItem.stockQuantity === "number") {
          if (newQty > catItem.stockQuantity) {
            alert(
              `Cannot add more than available stock (${catItem.stockQuantity}) for "${catItem.name}"`,
            );
            finalQty = catItem.stockQuantity;
          } else {
            finalQty = newQty;
          }
        }
        return { ...item, qty: finalQty };
      }),
    );
  };

  const clearOrder = () => {
    setItems([
      { id: Math.random().toString(), name: "", desc: "", price: 0, qty: 1 },
    ]);
  };

  const resetCatalogForm = () => {
    setEditingBatchId(null);
    setNewCatName("");
    setNewCatDesc("");
    setNewCatDesc2("");
    setNewCatPrice("");
    setNewCatCostPrice("");
    setNewCatGst(18);
    setNewCatStock("");
    setNewCatThreshold(5);
    setNewCatBatch("");
    setNewCatManufacturer("");
    setNewCatHsn("");
    setNewCatCategory("");
    setNewCatTracksSerial(false);
    setSerialInputs([]);
  };

  // Grow/shrink the per-unit serial rows to `n`, preserving already-typed values.
  const setSerialCount = (n: number) => {
    const count = Math.max(0, Math.min(1000, Number.isFinite(n) ? n : 0));
    setSerialInputs((prev) => {
      const next = prev.slice(0, count);
      while (next.length < count) next.push("");
      return next;
    });
  };

  const updateSerialAt = (idx: number, value: string) => {
    setSerialInputs((prev) => prev.map((s, i) => (i === idx ? value : s)));
  };

  // Clean + de-duplicate the typed serial rows into a final list.
  const cleanSerials = (rows: string[]): string[] => {
    const seen = new Set<string>();
    const out: string[] = [];
    for (const r of rows) {
      const s = r.trim();
      if (s && !seen.has(s)) {
        seen.add(s);
        out.push(s);
      }
    }
    return out;
  };

  // Shared UI: a "number of units" box that generates one IMEI/serial input per unit.
  const renderSerialEntry = () => (
    <div className="space-y-2">
      <div>
        <label className="block text-[10px] font-bold text-gray-600 uppercase tracking-widest mb-1.5">
          Number of Units <span className="text-[#3F3F46]">*</span>
        </label>
        <input
          type="number"
          min={0}
          placeholder="e.g., 5"
          className="w-full bg-white border border-gray-200 hover:border-gray-300 focus:border-[#3F3F46] rounded-lg px-3.5 py-2.5 text-sm font-bold text-black focus:outline-none transition-colors shadow-xs"
          value={serialInputs.length || ""}
          onWheel={(e) => e.currentTarget.blur()}
          onChange={(e) =>
            setSerialCount(e.target.value === "" ? 0 : parseInt(e.target.value, 10))
          }
        />
      </div>
      {serialInputs.length > 0 && (
        <>
          <div className="space-y-1.5 max-h-52 overflow-y-auto pr-1">
            {serialInputs.map((s, idx) => (
              <div key={idx} className="flex items-center gap-2">
                <span className="w-5 text-[10px] font-bold text-gray-400 text-right shrink-0">
                  {idx + 1}
                </span>
                <input
                  type="text"
                  placeholder={`IMEI / Serial #${idx + 1}`}
                  className="w-full bg-white border border-gray-200 hover:border-gray-300 focus:border-[#3F3F46] rounded-lg px-3 py-2 text-sm font-mono text-black focus:outline-none transition-colors shadow-xs"
                  value={s}
                  onChange={(e) => updateSerialAt(idx, e.target.value)}
                />
              </div>
            ))}
          </div>
          <p className="text-[9px] text-gray-500 font-semibold">
            {cleanSerials(serialInputs).length} of {serialInputs.length} filled — stock is set by the number of units.
          </p>
        </>
      )}
    </div>
  );

  const openEditCatalog = (catItem: CatalogItem, targetRowId?: string) => {
    setEditingCatalogId(catItem.id);
    setNewCatName(catItem.name || "");
    setNewCatDesc(catItem.desc || "");
    setNewCatDesc2(catItem.desc2 || "");
    setNewCatPrice(catItem.price ?? "");
    setNewCatGst(typeof catItem.gstRate === "number" ? catItem.gstRate : 18);
    setNewCatStock(
      typeof catItem.stockQuantity === "number" ? catItem.stockQuantity : "",
    );
    setNewCatThreshold(
      typeof catItem.lowStockThreshold === "number"
        ? catItem.lowStockThreshold
        : 5,
    );
    setNewCatBatch(catItem.batchNo || "");
    setNewCatManufacturer(catItem.manufacturer || "");
    setNewCatHsn(catItem.hsnCode || "");
    setNewCatCategory(catItem.category || "");
    setNewCatTracksSerial(Boolean(catItem.tracksSerial));
    setSerialInputs([]);

    // Set active batch details
    const activeBatch =
      catItem.batches?.find((b) => b.stock_quantity > 0) ||
      (catItem.batches && catItem.batches.length > 0
        ? catItem.batches[0]
        : null);
    setEditingBatchId(activeBatch ? activeBatch.id : null);
    setNewCatCostPrice(activeBatch ? activeBatch.cost_price || "" : "");

    setCatalogTargetRowId(targetRowId || null);
    setShowCatalogModal(true);
  };

  // ── Product categories: toast + rename/delete callbacks ────────────
  const [toast, setToast] = useState<{ type: "success" | "error"; message: string } | null>(null);
  const toastTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const notify = (type: "success" | "error", message: string) => {
    setToast({ type, message });
    if (toastTimerRef.current) clearTimeout(toastTimerRef.current);
    toastTimerRef.current = setTimeout(() => setToast(null), 4000);
  };

  const productCountByCategory = React.useMemo(() => {
    const counts: Record<string, number> = {};
    for (const c of catalog) {
      const k = c.category || "General";
      counts[k] = (counts[k] || 0) + 1;
    }
    return counts;
  }, [catalog]);

  // The server already rewrote products.category; mirror it in local state so the billing filter,
  // inventory and the product form update without a refetch.
  const handleProductCategoryRenamed = (cat: Category, oldName: string) => {
    setCategories((prev) =>
      prev.map((c) => (c.id === cat.id ? cat : c)).sort((a, b) => a.name.localeCompare(b.name)),
    );
    setCatalog((prev) =>
      prev.map((c) => (c.category === oldName ? { ...c, category: cat.name } : c)),
    );
    setNewCatCategory((prev) => (prev === oldName ? cat.name : prev));
    setActiveCategory((prev) => (prev === oldName ? cat.name : prev));
  };

  const handleProductCategoryDeleted = (cat: Category) => {
    setCategories((prev) => prev.filter((c) => c.id !== cat.id));
    setCatalog((prev) =>
      prev.map((c) => (c.category === cat.name ? { ...c, category: "General" } : c)),
    );
    setNewCatCategory((prev) => (prev === cat.name ? "General" : prev));
    setActiveCategory((prev) => (prev === cat.name ? "ALL" : prev));
  };

  const addToCatalog = async () => {
    if (!newCatName.trim()) {
      alert("Product name is required.");
      return;
    }

    const priceNum = Number(newCatPrice);
    if (priceNum > 99999999.99) {
      alert(
        "The price exceeds the maximum allowable system limit of ₹99,999,999.99.",
      );
      return;
    }

    const productPayload = {
      name: newCatName.trim(),
      description: newCatDesc.trim() || null,
      description2: newCatDesc2.trim() || null,
      category: newCatCategory.trim() || "General",
      gst_rate: newCatGst === "" ? 0 : Number(newCatGst),
      low_stock_threshold: newCatThreshold === "" ? 5 : Number(newCatThreshold),
      tracks_serial: newCatTracksSerial,
    };

    const serials = cleanSerials(serialInputs);
    if (newCatTracksSerial && !editingCatalogId) {
      if (serialInputs.length === 0) {
        alert("Set the number of units, then fill in each IMEI/serial.");
        return;
      }
      if (serials.length !== serialInputs.length) {
        alert("Please fill in every IMEI/serial row (no blanks or duplicates).");
        return;
      }
    }

    // Persist a newly-typed category so it appears in the managed list next time.
    const catName = newCatCategory.trim();
    if (
      catName &&
      !categories.some((c) => c.name.toLowerCase() === catName.toLowerCase())
    ) {
      try {
        const res = await createCategory(catName);
        if (res.ok) {
          const created = res.data;
          setCategories((prev) =>
            prev.some((c) => c.id === created.id) ? prev : [...prev, created],
          );
        }
      } catch {
        /* non-fatal: product still saves with the category text */
      }
    }

    if (isSavingCatalog) return; // ignore double-clicks
    setIsSavingCatalog(true);
    try {
    if (editingCatalogId) {
      const data = await editProduct(editingCatalogId, productPayload);
      if (!data) {
        alert(
          "Product not found — it may have been removed. Refresh and try again.",
        );
        return;
      }

      if (editingBatchId) {
        await editBatch(editingBatchId, {
          batch_no: newCatBatch || null,
          manufacturer: newCatManufacturer || null,
          hsn_code: newCatHsn || null,
          cost_price: newCatCostPrice === "" ? 0 : Number(newCatCostPrice),
          selling_price: newCatPrice === "" ? 0 : Number(newCatPrice),
          // For serialized products the stock is derived from unit rows — don't overwrite it here.
          ...(newCatTracksSerial
            ? {}
            : { stock_quantity: newCatStock === "" ? 0 : Number(newCatStock) }),
        });

        // Refresh catalog to reflect batch changes
        const updatedProducts = await fetchProducts();
        setCatalog(updatedProducts.map(productToCatalogItem));
      } else {
        setCatalog((prev) =>
          prev.map((c) =>
            c.id === editingCatalogId
              ? {
                  ...c,
                  name: data.name,
                  desc: data.description || undefined,
                  desc2: data.description2 || undefined,
                  category: data.category,
                  lowStockThreshold: data.low_stock_threshold,
                  gstRate: Number(data.gst_rate) || 0,
                }
              : c,
          ),
        );
      }

      if (catalogTargetRowId) {
        updateItem(catalogTargetRowId, "name", data.name);
        setCatalogTargetRowId(null);
      }

      resetCatalogForm();
      setEditingCatalogId(null);
      setShowCatalogModal(false);
    } else {
      const product = await createProduct(productPayload);

      const batchPayload = {
        batch_no: newCatBatch || null,
        manufacturer: newCatManufacturer || null,
        hsn_code: newCatHsn || null,
        cost_price: newCatCostPrice === "" ? 0 : Number(newCatCostPrice),
        selling_price: newCatPrice === "" ? 0 : Number(newCatPrice),
        // Serialized: stock is set from the serial count on the server.
        stock_quantity: newCatTracksSerial
          ? serials.length
          : newCatStock === "" ? 0 : Number(newCatStock),
        ...(newCatTracksSerial ? { serials } : {}),
      };

      await createBatch(product.id, batchPayload);

      const data = (await fetchProducts()).find((p) => p.id === product.id) || {
        ...product,
        batches: [],
        total_stock: batchPayload.stock_quantity,
        active_selling_price: batchPayload.selling_price,
      };
      const newItem = productToCatalogItem(data as any);
      setCatalog([...catalog, newItem]);

      if (catalogTargetRowId) {
        updateItem(catalogTargetRowId, "name", data.name);
        if (data.active_selling_price !== undefined) {
          updateItem(
            catalogTargetRowId,
            "price",
            data.active_selling_price || 0,
          );
        }
        setCatalogTargetRowId(null);
      }

      resetCatalogForm();
      setShowCatalogModal(false);
    }
    } finally {
      setIsSavingCatalog(false);
    }
  };

  const handleAddBatchSubmit = async () => {
    if (!batchTargetProductId) return;
    const targetProduct = catalog.find((c) => c.id === batchTargetProductId);
    const tracksSerial = Boolean(targetProduct?.tracksSerial);
    const serials = cleanSerials(serialInputs);
    if (tracksSerial) {
      if (serialInputs.length === 0) {
        alert("Set the number of units, then fill in each IMEI/serial.");
        return;
      }
      if (serials.length !== serialInputs.length) {
        alert("Please fill in every IMEI/serial row (no blanks or duplicates).");
        return;
      }
    }
    if (isSavingCatalog) return; // ignore double-clicks
    setIsSavingCatalog(true);
    try {
      const batchPayload = {
        batch_no: newCatBatch || null,
        manufacturer: newCatManufacturer || null,
        hsn_code: newCatHsn || null,
        cost_price: newCatCostPrice === "" ? 0 : Number(newCatCostPrice),
        selling_price: newCatPrice === "" ? 0 : Number(newCatPrice),
        stock_quantity: tracksSerial
          ? serials.length
          : newCatStock === "" ? 0 : Number(newCatStock),
        ...(tracksSerial ? { serials } : {}),
      };
      await createBatch(batchTargetProductId, batchPayload);

      const data = await fetchProducts();
      setCatalog(data.map(productToCatalogItem));

      setShowBatchModal(false);
      resetCatalogForm();
      setBatchTargetProductId(null);
    } catch (err) {
      console.error(err);
      alert("Failed to add batch.");
    } finally {
      setIsSavingCatalog(false);
    }
  };


  // Open the "Manage IMEIs" modal for a serialized product and load its units.
  const openUnitsModal = async (productId: string, name: string) => {
    setUnitsTargetProductId(productId);
    setUnitsTargetName(name);
    setUnitRows([]);
    setShowUnitsModal(true);
    setIsLoadingUnits(true);
    try {
      setUnitRows(await fetchProductUnits(productId));
    } catch (err) {
      console.error(err);
      alert("Failed to load units.");
    } finally {
      setIsLoadingUnits(false);
    }
  };

  const refreshCatalog = async () => {
    const data = await fetchProducts();
    setCatalog(data.map(productToCatalogItem));
  };

  const updateUnitRow = (id: string, serial: string) => {
    setUnitRows((prev) =>
      prev.map((u) => (u.id === id ? { ...u, serial } : u)),
    );
  };

  // Persist a corrected serial (available units only) — called on blur.
  const saveUnitSerial = async (u: ProductUnit) => {
    const serial = u.serial.trim();
    if (!serial) return;
    const res = await editUnitSerial(u.id, serial);
    if (!res) {
      alert("Couldn't update this serial (the unit may already be sold).");
      return;
    }
    await refreshCatalog();
  };

  const deleteUnitRow = async (u: ProductUnit) => {
    if (
      !window.confirm(
        `Remove unit "${u.serial}"? This permanently deletes it and lowers stock by 1.`,
      )
    )
      return;
    const res = await removeUnit(u.id);
    if (!res.deleted) {
      alert(
        res.reason === "sold"
          ? "This unit was already sold on an invoice and can't be removed."
          : "Couldn't remove this unit.",
      );
      return;
    }
    setUnitRows((prev) => prev.filter((x) => x.id !== u.id));
    await refreshCatalog();
  };

  const deleteFromCatalog = async (id: string) => {
    await removeProduct(id);
    setCatalog((prev) => prev.filter((c) => c.id !== id));
  };

  // Orders saved before GST became inclusive have the GST added on top of the item prices.
  const selectedOrderLegacyGst = selectedOrder
    ? isLegacyAddedGst({
        isGst: selectedOrder.isGst,
        subtotal: selectedOrder.subtotal,
        gstAmount: selectedOrder.gstAmount ?? 0,
        itemsTotal: selectedOrder.items.reduce((acc, i) => acc + (Number(i.price) || 0) * (Number(i.qty) || 0), 0),
      })
    : false;

  // Product prices are GST-inclusive. Subtotal already contains GST; we back-derive
  // the GST portion for display (CGST + SGST on the invoice) and never add it on top of the total.
  const subtotal = items.reduce((acc, item) => acc + item.price * item.qty, 0);
  const calculatedDiscount =
    discountType === "percent"
      ? subtotal * (discountValue / 100)
      : discountValue;
  const netInclusive = Math.max(0, subtotal - calculatedDiscount);
  // GST is per product and INCLUDED in the price: GST = line − line ÷ (1 + rate/100). Each product
  // uses its own saved GST rate (custom items fall back to the default rate). GST is worked out on the
  // ACTUAL (pre-discount) price — a discount lowers what the customer pays, not the GST shown.
  const itemGstRate = (item: OrderItem, fallbackRate: number = gstPercentage): number => {
    const cat = catalog.find(
      (c) =>
        (item.product_id && (c.id === item.product_id || c.productId === item.product_id)) ||
        (item.name && c.name.trim().toLowerCase() === item.name.trim().toLowerCase()),
    );
    return typeof cat?.gstRate === "number" ? cat.gstRate : fallbackRate;
  };
  const itemGstAmount = (item: OrderItem): number => {
    if (!applyGST) return 0;
    return gstInside(item.price * item.qty, itemGstRate(item));
  };
  const gstAmount = applyGST ? items.reduce((acc, i) => acc + itemGstAmount(i), 0) : 0;
  // GST is already inside the prices, so the payable total never changes with the GST toggle.
  const grandTotal = netInclusive + deliveryFee;

  // Suggest a GST % from the products currently in the cart (their per-product
  // default rate). Used to pre-fill the changeable GST field when a GST invoice
  // is switched on. Falls back to the current value or 18%.
  const suggestGstRate = (): number => {
    for (const item of items) {
      if (!item.name) continue;
      const catItem = catalog.find(
        (c) =>
          (item.product_id &&
            (c.id === item.product_id || c.productId === item.product_id)) ||
          c.name.trim().toLowerCase() === item.name.trim().toLowerCase(),
      );
      if (catItem && typeof catItem.gstRate === "number" && catItem.gstRate > 0) {
        return catItem.gstRate;
      }
    }
    return gstPercentage || 18;
  };

  // Toggle between a GST invoice and a non-GST bill. When switching a GST
  // invoice on, pre-fill the (still editable) rate from the cart's products.
  const setGstBill = (on: boolean) => {
    setApplyGST(on);
  };

  // ─────────────────────────────────────────
  // ADVANCE ORDERS — deposit-only holds
  // ─────────────────────────────────────────

  // Format: DEP-YYYYMMDD-NNNN. Sequential-looking, unique enough for one shop.
  const generateAdvanceOrderId = () => {
    const d = new Date();
    const ymd = `${d.getFullYear()}${String(d.getMonth() + 1).padStart(2, "0")}${String(d.getDate()).padStart(2, "0")}`;
    const rand = Math.floor(1000 + Math.random() * 9000);
    return `DEP-${ymd}-${rand}`;
  };

  const openAdvanceSaveModal = () => {
    if (!customerPhone || customerPhone.length !== 10) {
      alert("Please enter a valid 10-digit mobile contact number before saving an advance order.");
      return;
    }
    const hasInvalidItem = items.some(
      (i) => !i.name || i.name.trim() === "" || i.price === undefined || i.price <= 0,
    );
    if (hasInvalidItem || items.length === 0) {
      alert("Please ensure all items have a valid name and price greater than 0 before saving an advance order.");
      return;
    }
    setAdvDeposit("");
    setAdvDeliveryDate("");
    setAdvNotes("");
    setAdvDepositPaymentMode(paymentMode);
    setShowAdvanceSaveModal(true);
  };

  const saveAdvanceOrder = async () => {
    if (isSavingAdvance) return;
    const deposit = Number(advDeposit) || 0;
    if (deposit <= 0) {
      alert("Deposit amount must be greater than 0.");
      return;
    }
    if (deposit > grandTotal) {
      alert("Deposit cannot exceed the grand total. Use 'Complete Sale' for full payment.");
      return;
    }

    const advId = generateAdvanceOrderId();
    // Snapshot the order details for the confirmation receipt BEFORE the form is reset.
    const receiptCustomerName = customerName.trim() || "Guest";
    const receiptCustomerPhone = customerPhone;
    const receiptOrderTotal = grandTotal;
    const receiptDepositMode = advDepositPaymentMode;
    const receiptDeliveryDate = advDeliveryDate || null;
    const receiptItems = items.map((i) => ({
      name: i.name,
      desc: i.desc || "",
      price: Number(i.price) || 0,
      qty: Number(i.qty) || 0,
    }));
    setIsSavingAdvance(true);
    try {
      await createAdvanceOrder({
        advanceOrderId: advId,
        customerName: customerName || "Guest",
        customerPhone,
        customerAddress: customerAddress || null,
        subtotal,
        totalAmount: grandTotal,
        depositAmount: deposit,
        depositPaymentMode: advDepositPaymentMode,
        deliveryDate: advDeliveryDate || null,
        notes: advNotes.trim() || null,
        // Remember the GST choice so collecting the balance later produces a GST invoice too.
        // Blended GST rate of the cart; the products' own rates are looked up again when the balance is collected.
        isGst: applyGST,
        gstPercentage: applyGST ? effectiveGstRate(subtotal, gstAmount) : 0,
        discountType: discountType === "percent" ? "PERCENT" : "FIXED",
        discountValue: discountValue,
        discountAmount: calculatedDiscount,
        items: items.map((i) => ({
          product_id: i.product_id || null,
          snapshot_name: i.name,
          snapshot_desc: i.desc || null,
          snapshot_price: i.price,
          quantity: i.qty,
        })),
      });

      // Reset billing form.
      setItems([{ id: "1", name: "", desc: "", price: 0, qty: 1 }]);
      setCustomerName("");
      setCustomerPhone("");
      setCustomerAddress("");
      setDiscountValue(0);
      setDeliveryFee(0);
      setCashReceived(0);
      setShowAdvanceSaveModal(false);
      // Show the "Advance Order Saved" confirmation instantly; refresh lists in the background.
      setSavedAdvanceData({
        id: advId,
        customerName: receiptCustomerName,
        customerPhone: receiptCustomerPhone,
        orderTotal: receiptOrderTotal,
        depositPaid: deposit,
        balanceDue: Math.max(0, receiptOrderTotal - deposit),
        depositMode: receiptDepositMode,
        deliveryDate: receiptDeliveryDate,
        items: receiptItems,
      });
      fetchData().catch((e) => console.error("Background refresh error:", e));
    } catch (err) {
      console.error("Failed to save advance order:", err);
      alert("Could not save the advance order. Please try again.");
    } finally {
      setIsSavingAdvance(false);
    }
  };

  const openReceiveBalance = (adv: AdvanceOrderWithRelations) => {
    setSelectedAdvance(adv);
    setAdvanceViewMode("receive");
    setReceivePaymentMode("CASH");
    // Default to however the advance order was booked (GST or Non-GST).
    setReceiveIsGst(Boolean(adv.is_gst));
    setReceiveGstPct(Number(adv.gst_percentage) || 18);
  };

  const openAdvanceView = (adv: AdvanceOrderWithRelations) => {
    setSelectedAdvance(adv);
    setAdvanceViewMode("view");
  };

  const closeAdvanceDialog = () => {
    setSelectedAdvance(null);
    setAdvanceViewMode(null);
  };

  const inAdvPeriod = (dateStr: string): boolean => {
    if (advPeriod === "all") return true;
    const t = new Date(dateStr).getTime();
    const now = new Date();
    if (advPeriod === "today") return new Date(dateStr).toDateString() === now.toDateString();
    if (advPeriod === "week") {
      const dow = now.getDay();
      const start = new Date(now.getFullYear(), now.getMonth(), now.getDate() + (dow === 0 ? -6 : 1 - dow));
      return t >= start.getTime();
    }
    if (advPeriod === "month") return t >= new Date(now.getFullYear(), now.getMonth(), 1).getTime();
    if (advPeriod === "year") return t >= new Date(now.getFullYear(), 0, 1).getTime();
    const start = advStartDate ? new Date(advStartDate) : null;
    if (start) start.setHours(0, 0, 0, 0);
    const end = advEndDate ? new Date(advEndDate) : null;
    if (end) end.setHours(23, 59, 59, 999);
    if (start && t < start.getTime()) return false;
    if (end && t > end.getTime()) return false;
    return true;
  };

  const balanceRemaining = (adv: AdvanceOrderWithRelations) =>
    Math.max(0, Number(adv.total_amount) - Number(adv.deposit_amount));

  // Advance orders have no discount at collection time — the only discount is the one given when the
  // order was booked, which is already taken off total_amount and carried onto the invoice.

  // Prices are GST-inclusive: choosing a GST invoice never changes the amount to collect.
  const receiveBalanceFinalAmount = (() => {
    if (!selectedAdvance) return 0;
    return balanceRemaining(selectedAdvance);
  })();

  const confirmReceiveBalance = async () => {
    if (!selectedAdvance || isFinalizing) return;
    setIsFinalizing(true);
    try {
      const invoiceId = `INV-${new Date().getFullYear()}-${Math.random().toString(36).substr(2, 5).toUpperCase()}`;
      await finalizeAdvanceOrder({
        advanceOrderId: selectedAdvance.id,
        invoiceId,
        isGst: receiveIsGst,
        gstPercentage: receiveIsGst ? receiveGstPct : 0,
        discountType: "FIXED",
        discountValue: 0,
        discountAmount: 0,
        deliveryFee: 0,
        paymentMode: receivePaymentMode,
        billDate: localDateStr(),
      });
      const adv = selectedAdvance;
      // total_amount is already net of the booking discount; subtotal is the pre-discount amount.
      const netInclusive = Number(adv.total_amount) || 0;
      const bookingDiscount = Number(adv.discount_amount) || 0;
      const rawSubtotal = netInclusive + bookingDiscount;
      // GST on the actual (pre-discount) line prices, per line at each product's own rate.
      const gstAmt = receiveIsGst
        ? adv.items.reduce(
            (acc, i) =>
              acc +
              gstInside(
                (Number(i.snapshot_price) || 0) * (Number(i.quantity) || 0),
                itemGstRate({ product_id: i.product_id, name: i.snapshot_name } as OrderItem, receiveGstPct),
              ),
            0,
          )
        : 0;
      const finalGrandTotal = netInclusive;
      const nowIso = new Date().toISOString();
      const finalOrder: CompletedOrder = {
        id: invoiceId,
        customerName: adv.customer_name || "Guest",
        customerPhone: adv.customer_phone,
        customerAddress: adv.customer_address || null,
        source: "OFFLINE",
        isGst: receiveIsGst,
        items: adv.items.map((i, idx) => ({
          id: `oi-${invoiceId}-${idx}`,
          name: i.snapshot_name,
          desc: i.snapshot_desc || "",
          price: Number(i.snapshot_price) || 0,
          qty: Number(i.quantity) || 0,
        })),
        subtotal: rawSubtotal,
        discount: bookingDiscount,
        discountType: adv.discount_type === "PERCENT" ? "PERCENT" : "FIXED",
        discountValue: Number(adv.discount_value) || undefined,
        gstPercentage: receiveIsGst ? effectiveGstRate(rawSubtotal, gstAmt) : 0,
        gstAmount: gstAmt,
        deliveryFee: 0,
        grandTotal: finalGrandTotal,
        cashReceived: finalGrandTotal,
        paymentMode: receivePaymentMode,
        date: nowIso,
        createdAt: nowIso,
        status: "Completed",
      };
      closeAdvanceDialog();
      setCompletedBillData(finalOrder);
      fetchData().catch((e) => console.error("Background refresh error:", e));
    } catch (err) {
      console.error("Failed to finalize advance order:", err);
      alert("Could not finalize the advance order. Please try again.");
    } finally {
      setIsFinalizing(false);
    }
  };

  const doCancelAdvance = async (adv: AdvanceOrderWithRelations) => {
    if (!confirm(`Cancel advance order ${adv.id}? The deposit is treated as forfeit/refunded outside the system.`)) return;
    try {
      await cancelAdvanceOrder(adv.id);
      await fetchData();
    } catch (err) {
      console.error("Cancel failed:", err);
      alert("Could not cancel the advance order.");
    }
  };

  const doDeleteAdvance = async (adv: AdvanceOrderWithRelations) => {
    if (!confirm(`Permanently delete advance order ${adv.id}? This cannot be undone.`)) return;
    try {
      await removeAdvanceOrder(adv.id);
      await fetchData();
    } catch (err) {
      console.error("Delete failed:", err);
      alert("Could not delete the advance order.");
    }
  };

  const toggleAdvanceReady = async (adv: AdvanceOrderWithRelations) => {
    const next: AdvanceOrderStatus = adv.status === "READY" ? "PENDING" : "READY";
    try {
      await setAdvanceOrderStatus(adv.id, next);
      await fetchData();
    } catch (err) {
      console.error("Status update failed:", err);
    }
  };

  // Completes and saves the sale to the database. Returns the created order
  // (or null if validation/creation failed). WhatsApp sharing is a separate,
  // Completes and saves the sale to the database with instant optimistic updates.
  const completeSale = async (): Promise<CompletedOrder | null> => {
    if (isSubmittingOrder) return null;

    if (!customerPhone || customerPhone.length !== 10) {
      alert(
        "Please enter a valid 10-digit mobile contact number to complete the sale.",
      );
      return null;
    }

    // Strict validation: every single row must have a name and a price > 0
    const hasInvalidItem = items.some(
      (i) =>
        !i.name ||
        i.name.trim() === "" ||
        i.price === undefined ||
        i.price <= 0,
    );

    if (hasInvalidItem || items.length === 0) {
      alert(
        "Please ensure all items have a valid name and a price greater than 0. Remove any empty rows before proceeding.",
      );
      return null;
    }
    const itemsToSave = items;

    // Serialized products must have a specific IMEI/serial unit chosen.
    const missingUnit = itemsToSave.find((i) => {
      const cat = catalog.find(
        (c) => c.productId === i.product_id || c.id === i.product_id,
      );
      return cat?.tracksSerial && !i.unit_id;
    });
    if (missingUnit) {
      alert(
        `Please select an IMEI/serial for "${missingUnit.name}" before completing the sale.`,
      );
      return null;
    }

    // Recalculate values locally to avoid React state lag issues
    const localSubtotal = itemsToSave.reduce(
      (acc, item) => acc + item.price * item.qty,
      0,
    );
    const localCalculatedDiscount =
      discountType === "percent"
        ? localSubtotal * (discountValue / 100)
        : discountValue;
    // Per-product GST is INCLUDED in the price — it is carved out of the ACTUAL (pre-discount) price for
    // the invoice, never added on top, so the grand total is the same with or without GST.
    const localNetInclusive = Math.max(0, localSubtotal - localCalculatedDiscount);
    const localGstAmount = applyGST
      ? itemsToSave.reduce(
          (acc, i) => acc + gstInside(i.price * i.qty, itemGstRate(i)),
          0,
        )
      : 0;
    const localEffectiveGstPct = applyGST
      ? effectiveGstRate(localSubtotal, localGstAmount)
      : 0;
    const localGrandTotal = localNetInclusive + deliveryFee;

    // Validate totals against PostgreSQL numeric(10,2) overflow limit (99,999,999.99)
    const MAX_LIMIT = 99999999.99;
    if (
      localSubtotal > MAX_LIMIT ||
      localGrandTotal > MAX_LIMIT ||
      cashReceived > MAX_LIMIT ||
      deliveryFee > MAX_LIMIT
    ) {
      alert(
        "The order totals exceed the maximum allowable system limit of ₹99,999,999.99. Please adjust the item prices, delivery fee, or cash received.",
      );
      return null;
    }

    // Validate individual item prices
    const hasTooExpensiveItem = itemsToSave.some(
      (i) => i.price > MAX_LIMIT || i.price * i.qty > MAX_LIMIT,
    );
    if (hasTooExpensiveItem) {
      alert(
        "One or more item prices exceed the maximum system limit of ₹99,999,999.99. Please correct the item prices.",
      );
      return null;
    }

    // Split payment: validate the two amounts add up to the grand total.
    let effectivePaymentMode: OrderPaymentMode = paymentMode;
    let splitMode2ToSave: OrderPaymentMode | null = null;
    let splitAmt1 = 0;
    let splitAmt2 = 0;
    let effectiveCashReceived = cashReceived;
    if (isSplitPayment) {
      splitAmt1 = Number(splitAmount1) || 0;
      splitAmt2 = Number(splitAmount2) || 0;
      if (splitMode1 === splitMode2) {
        alert("Please choose two different payment modes for a split payment.");
        return null;
      }
      if (splitAmt1 <= 0 || splitAmt2 <= 0) {
        alert("Please enter both split amounts (each greater than 0).");
        return null;
      }
      if (Math.abs(splitAmt1 + splitAmt2 - localGrandTotal) > 0.01) {
        alert(
          `Split amounts must add up to the grand total of ₹${localGrandTotal.toLocaleString(undefined, { minimumFractionDigits: 2 })}. Currently they total ₹${(splitAmt1 + splitAmt2).toLocaleString(undefined, { minimumFractionDigits: 2 })}.`,
        );
        return null;
      }
      effectivePaymentMode = splitMode1;
      splitMode2ToSave = splitMode2;
      effectiveCashReceived = splitAmt1 + splitAmt2;
    }

    const currentTimeStr = new Date().toTimeString().split(" ")[0];
    let orderTimestamp = new Date().toISOString();
    const billDay = customDateEditedRef.current ? customOrderDate : localDateStr();
    if (billDay) {
      const parsedDate = new Date(`${billDay}T${currentTimeStr}`);
      if (!isNaN(parsedDate.getTime())) {
        orderTimestamp = parsedDate.toISOString();
      }
    }

    setIsSubmittingOrder(true);

    try {
      const { orderId: newOrderId } = await submitOrder({
        orderId: `INV-${new Date().getFullYear()}-${Math.random().toString(36).substr(2, 5).toUpperCase()}`,
        customerName: customerName || "Guest",
        customerPhone: customerPhone,
        customerAddress: customerAddress || null,
        source: isOnline ? "ONLINE" : "OFFLINE",
        isGst: applyGST,
        // bill_date is a Postgres DATE: send the local calendar day. A UTC ISO string gets cut
        // to the UTC date, which is "yesterday" before 5:30 AM IST.
        billDate: localDateStr(new Date(orderTimestamp)),
        items: itemsToSave.map((i) => ({
          id: i.id,
          product_id: i.product_id || null,
          batch_id: i.batch_id || null,
          unit_id: i.unit_id || null,
          serial: i.serial || null,
          name: i.name,
          desc: i.desc,
          price: i.price,
          qty: i.qty,
          gst_rate: itemGstRate(i),
        })),
        discountType: discountType === "percent" ? "PERCENT" : "FIXED",
        discountValue: discountValue,
        discountAmount: localCalculatedDiscount,
        gstPercentage: localEffectiveGstPct,
        gstAmount: localGstAmount,
        deliveryFee: deliveryFee,
        grandTotal: localGrandTotal,
        cashReceived: effectiveCashReceived,
        paymentMode: effectivePaymentMode,
        splitMode2: splitMode2ToSave,
        splitAmount1: splitAmt1,
        splitAmount2: splitAmt2,
        gifts: freeGifts
          .filter((g) => g.name.trim())
          .map((g) => ({ gift_id: null, name: g.name.trim(), price: Number(g.price) || 0, quantity: 1 })),
      });

      // Construct mappedOrder directly in memory to respond with ZERO blocking delay
      const mappedOrder: CompletedOrder = {
        id: newOrderId,
        customerName: customerName.trim() || "Guest",
        customerPhone: customerPhone,
        customerAddress: customerAddress.trim() || null,
        source: isOnline ? "ONLINE" : "OFFLINE",
        isGst: Boolean(applyGST),
        items: itemsToSave.map((i, idx) => ({
          id: `oi-${newOrderId}-${idx}`,
          name: i.name,
          desc: i.name === "Custom Item" ? "Custom" : (i.desc || ""),
          price: Number(i.price) || 0,
          qty: Number(i.qty) || 0,
        })),
        subtotal: Number(localSubtotal) || 0,
        discount: Number(localCalculatedDiscount) || 0,
        discountType: discountType === "percent" ? "PERCENT" : "FIXED",
        discountValue: discountValue ? Number(discountValue) : undefined,
        gstPercentage: localEffectiveGstPct,
        gstAmount: Number(localGstAmount) || 0,
        deliveryFee: Number(deliveryFee) || 0,
        grandTotal: Number(localGrandTotal) || 0,
        cashReceived: Number(effectiveCashReceived) || 0,
        paymentMode: effectivePaymentMode,
        splitMode2: splitMode2ToSave,
        splitAmount1: splitAmt1,
        splitAmount2: splitAmt2,
        date: orderTimestamp,
        createdAt: new Date().toISOString(),
        status: "Completed",
        gifts: freeGifts.filter((g) => g.name.trim()),
      };

      // Instantly update orders history and open the completed receipt banner
      setOrders((prev) => [mappedOrder, ...prev]);
      setCompletedBillData(mappedOrder as any);

      // Optimistically deduct inventory quantities locally for immediate UI response
      setCatalog((prev) =>
        prev.map((catItem) => {
          const soldItem = itemsToSave.find((i) => i.product_id === catItem.id);
          if (soldItem) {
            return {
              ...catItem,
              stockQuantity: Math.max(
                0,
                (catItem.stockQuantity ?? 0) - soldItem.qty,
              ),
            };
          }
          return catItem;
        }),
      );

      // Non-blocking sync with backend database in the background
      fetchProducts()
        .then((data) => setCatalog(data.map(productToCatalogItem)))
        .catch((err) => console.error("Background sync error:", err));

      // Reset Form immediately
      setCustomerName("");
      setCustomerPhone("");
      setCustomerAddress("");
      setCustomOrderDate(localDateStr());
      customDateEditedRef.current = false;
      setItems([{ id: "1", name: "", desc: "", price: 0, qty: 1 }]);
      setDiscountValue(0);
      setDeliveryFee(0);
      setCashReceived(0);
      setPaymentMode("CASH");
      setIsSplitPayment(false);
      setSplitMode1("CASH");
      setSplitMode2("GPAY");
      setSplitAmount1("");
      setSplitAmount2("");
      setFreeGifts([]);
      setApplyGST(false);
      setGstPercentage(18);

      return mappedOrder;
    } catch (err: any) {
      console.error("Failed to complete sale:", err);
      alert("An error occurred while saving the sale. Please try again.");
      return null;
    } finally {
      setIsSubmittingOrder(false);
    }
  };

  // Completes the sale first, then shares the saved bill over WhatsApp.
  const handleCompleteAndSendWhatsApp = async () => {
    if (!customerPhone || customerPhone.length !== 10) {
      alert(
        "Please enter a valid 10-digit mobile contact number to send bill via WhatsApp.",
      );
      return;
    }

    // Pre-open blank tab on desktop to prevent popup blocker from blocking WhatsApp after async await
    const isMobile = /iPhone|iPad|iPod|Android/i.test(navigator.userAgent);
    let popupWindow: Window | null = null;
    if (!isMobile) {
      popupWindow = window.open("about:blank", "_blank");
    }

    try {
      const order = await completeSale();
      if (order) {
        resendWhatsApp(order, popupWindow);
      } else if (popupWindow) {
        popupWindow.close();
      }
    } catch (err) {
      if (popupWindow) popupWindow.close();
      console.error(err);
    }
  };

  const resendWhatsApp = (
    order: CompletedOrder,
    existingWindow?: Window | null,
  ) => {
    if (!order.customerPhone || order.customerPhone.length < 10) {
      alert("Invalid customer phone number for this order.");
      if (existingWindow) existingWindow.close();
      return;
    }
    const domain = window.location.origin;
    const invoiceUrl = `${domain}/invoice/${order.id}`;
    const shopEmoji = String.fromCodePoint(0x2728);
    const checkEmoji = String.fromCodePoint(0x2705);
    const moneyEmoji = String.fromCodePoint(0x1f4b0);
    const receiptEmoji = String.fromCodePoint(0x1f4e6);
    let message = `${shopEmoji} *RAJA MOBILES* ${shopEmoji}\n\n`;
    message += `${checkEmoji} Here are your ${order.isGst ? "GST invoice" : "bill"} details!\n\n`;

    // Prices are GST-inclusive: the item prices already contain the GST, which is only listed as
    // CGST + SGST. Orders saved before that change stored the GST added on top — keep their layout.
    const gstInsideBill = Number(order.gstAmount) || 0;
    const showGst = order.isGst && gstInsideBill > 0.1;
    const legacyAdded = isLegacyAddedGst({
      isGst: order.isGst,
      subtotal: order.subtotal,
      gstAmount: gstInsideBill,
      itemsTotal: order.items.reduce((acc, i) => acc + (Number(i.price) || 0) * (Number(i.qty) || 0), 0),
    });
    message += `Subtotal${legacyAdded ? " (before GST)" : ""}: ₹${(order.subtotal - (legacyAdded ? gstInsideBill : 0)).toLocaleString(undefined, { minimumFractionDigits: 2 })}\n`;
    if (order.discount > 0) {
      message += `Discount Applied: -₹${order.discount.toLocaleString(undefined, { minimumFractionDigits: 2 })}\n`;
    }
    if (showGst && legacyAdded) {
      const gstLabel = order.gstPercentage ? `GST (${order.gstPercentage}%)` : "GST";
      message += `${gstLabel}: +₹${gstInsideBill.toLocaleString(undefined, { minimumFractionDigits: 2 })}\n`;
    } else if (showGst) {
      const half = (order.gstPercentage || 0) / 2;
      const halfAmt = (gstInsideBill / 2).toLocaleString(undefined, { minimumFractionDigits: 2 });
      message += `CGST (${half}%) included: ₹${halfAmt}\n`;
      message += `SGST (${half}%) included: ₹${halfAmt}\n`;
    }

    if (order.deliveryFee > 0) {
      message += `Delivery Fee: ₹${order.deliveryFee.toLocaleString(undefined, { minimumFractionDigits: 2 })}\n`;
    }

    message += `\n${moneyEmoji} *Total Amount: ₹${order.grandTotal.toLocaleString(undefined, { minimumFractionDigits: 2 })}*\n`;
    message += `Payment: ${paymentSummary(order)}\n\n`;
    message += `${receiptEmoji} View and download your detailed digital receipt here:\n${invoiceUrl}`;
    const encodedMessage = encodeURIComponent(message);
    const cleanPhone = order.customerPhone.replace(/\D/g, "").slice(-10);
    const whatsappUrl = `https://api.whatsapp.com/send?phone=91${cleanPhone}&text=${encodedMessage}`;
    const isMobile = /iPhone|iPad|iPod|Android/i.test(navigator.userAgent);
    if (existingWindow && !isMobile) {
      existingWindow.location.href = whatsappUrl;
    } else if (isMobile) {
      window.location.href = whatsappUrl;
    } else {
      window.open(whatsappUrl, "_blank");
    }
  };

  // Share the advance-deposit summary with the customer on WhatsApp.
  const advanceReceiptWhatsApp = (d: NonNullable<typeof savedAdvanceData>) => {
    if (!d.customerPhone || d.customerPhone.replace(/\D/g, "").length < 10) {
      alert("Invalid customer phone number for this advance order.");
      return;
    }
    const shopEmoji = String.fromCodePoint(0x2728);
    const checkEmoji = String.fromCodePoint(0x2705);
    const moneyEmoji = String.fromCodePoint(0x1f4b0);
    let message = `${shopEmoji} *RAJA MOBILES* ${shopEmoji}\n\n`;
    message += `${checkEmoji} Your advance order has been booked!\n\n`;
    message += `Order ID: ${d.id}\n`;
    const itemLine = d.items
      .filter((i) => i.name.trim())
      .map((i) => `${i.qty}× ${i.name}`)
      .join(", ");
    if (itemLine) message += `Items: ${itemLine}\n`;
    message += `\nOrder Total: ${money(d.orderTotal)}\n`;
    message += `${moneyEmoji} Deposit Paid (${d.depositMode}): ${money(d.depositPaid)}\n`;
    message += `*Balance Due: ${money(d.balanceDue)}*\n`;
    if (d.deliveryDate) {
      message += `\nExpected Delivery: ${new Date(d.deliveryDate).toLocaleDateString("en-IN", { day: "2-digit", month: "short", year: "numeric" })}\n`;
    }
    message += `\nPlease keep this message for collection. Thank you!`;
    const encodedMessage = encodeURIComponent(message);
    const cleanPhone = d.customerPhone.replace(/\D/g, "").slice(-10);
    const whatsappUrl = `https://api.whatsapp.com/send?phone=91${cleanPhone}&text=${encodedMessage}`;
    const isMobile = /iPhone|iPad|iPod|Android/i.test(navigator.userAgent);
    if (isMobile) {
      window.location.href = whatsappUrl;
    } else {
      window.open(whatsappUrl, "_blank");
    }
  };

  // Open a clean, printable advance-deposit receipt in a new window.
  const printAdvanceReceipt = (d: NonNullable<typeof savedAdvanceData>) => {
    const fmt = (n: number) =>
      `₹${(Number(n) || 0).toLocaleString("en-IN", { minimumFractionDigits: 2 })}`;
    const esc = (s: string) =>
      String(s).replace(/[&<>"]/g, (c) =>
        ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;" }[c] as string),
      );
    const rows = d.items
      .filter((i) => i.name.trim())
      .map(
        (i) =>
          `<tr><td>${esc(i.name)}${i.desc ? `<div class="d">${esc(i.desc)}</div>` : ""}</td><td class="c">${i.qty}</td><td class="r">${fmt(i.price)}</td><td class="r">${fmt(i.price * i.qty)}</td></tr>`,
      )
      .join("");
    const deliveryLine = d.deliveryDate
      ? `<div class="meta">Expected Delivery: <b>${esc(new Date(d.deliveryDate).toLocaleDateString("en-IN", { day: "2-digit", month: "short", year: "numeric" }))}</b></div>`
      : "";
    const html = `<!doctype html><html><head><meta charset="utf-8"><title>Advance Receipt ${esc(d.id)}</title>
      <style>
        *{box-sizing:border-box} body{font-family:ui-sans-serif,system-ui,Arial,sans-serif;color:#18181b;margin:0;padding:24px;max-width:480px}
        h1{font-size:20px;margin:0}
        .badge{display:inline-block;background:#FEF3C7;color:#92400e;font-size:10px;font-weight:800;letter-spacing:.08em;padding:3px 8px;border-radius:6px;text-transform:uppercase;margin-top:6px}
        .sub{color:#71717a;font-size:12px;font-family:ui-monospace,monospace;margin-top:4px}
        table{width:100%;border-collapse:collapse;margin:16px 0;font-size:13px}
        th{text-align:left;border-bottom:2px solid #e4e4e7;padding:6px 4px;font-size:10px;text-transform:uppercase;letter-spacing:.06em;color:#a1a1aa}
        td{padding:8px 4px;border-bottom:1px solid #f4f4f5;vertical-align:top}
        .c{text-align:center} .r{text-align:right;font-variant-numeric:tabular-nums}
        .d{font-size:11px;color:#71717a;margin-top:2px}
        .tot{margin-top:12px;border-top:2px solid #18181b;padding-top:10px}
        .row{display:flex;justify-content:space-between;padding:4px 0;font-size:14px}
        .row.big{font-size:16px;font-weight:800}
        .due{background:#FEE2E2;color:#991b1b;border-radius:8px;padding:10px 12px;margin-top:8px;display:flex;justify-content:space-between;font-weight:800}
        .paid{color:#16a34a;font-weight:700}
        .meta{font-size:12px;color:#52525b;margin-top:4px}
        .ft{margin-top:24px;font-size:11px;color:#a1a1aa;text-align:center}
        @page{size:A4 portrait;margin:12mm 10mm}
        @media print{body{padding:0;max-width:none}}
      </style></head><body>
      <h1>RAJA MOBILES</h1>
      <div class="badge">Advance Receipt — Deposit</div>
      <div class="sub">#${esc(d.id)}</div>
      <div class="meta" style="margin-top:10px">Customer: <b>${esc(d.customerName)}</b>${d.customerPhone ? ` · ${esc(d.customerPhone)}` : ""}</div>
      ${deliveryLine}
      <table><thead><tr><th>Item</th><th class="c">Qty</th><th class="r">Rate</th><th class="r">Amount</th></tr></thead><tbody>${rows}</tbody></table>
      <div class="tot">
        <div class="row big"><span>Order Total</span><span>${fmt(d.orderTotal)}</span></div>
        <div class="row"><span>Deposit Paid (${esc(d.depositMode)})</span><span class="paid">${fmt(d.depositPaid)}</span></div>
      </div>
      <div class="due"><span>Balance Due</span><span>${fmt(d.balanceDue)}</span></div>
      <div class="ft">Balance payable on collection. Not a tax invoice. Thank you!</div>
      <script>window.onload=function(){setTimeout(function(){window.print()},150)}<\/script>
      </body></html>`;
    const w = window.open("", "_blank", "width=480,height=700");
    if (!w) {
      alert("Please allow pop-ups to print the advance receipt.");
      return;
    }
    w.document.open();
    w.document.write(html);
    w.document.close();
  };

  const handleDeleteOrder = async (orderId: string) => {
    if (
      !window.confirm(
        "Are you sure you want to delete this invoice? This action cannot be undone.",
      )
    )
      return;
    await removeOrder(orderId);
    setOrders((prev) => prev.filter((o) => o.id !== orderId));
    if (selectedOrder?.id === orderId) setSelectedOrder(null);
    if (completedBillData?.id === orderId) setCompletedBillData(null);
    if (activeInvoiceId === orderId) setActiveInvoiceId(null);
  };

  // ── Expense tracker: handlers ──────────────────────────────────────
  const handleAddExpense = async () => {
    const amountNum =
      typeof expAmount === "number" ? expAmount : parseFloat(String(expAmount));
    const category = expCategory.trim() || FALLBACK_EXPENSE_CATEGORY;
    if (!expTitle.trim()) {
      alert("Please enter what the expense was for.");
      return;
    }
    if (!amountNum || amountNum <= 0) {
      alert("Please enter a valid amount greater than 0.");
      return;
    }
    setIsSavingExpense(true);
    try {
      const payload = {
        title: expTitle.trim(),
        category,
        amount: amountNum,
        payment_mode: expPaymentMode,
        notes: expNotes.trim() || null,
        expense_date: expDate,
      };
      // The same form adds a new expense or saves changes to the one being edited.
      const res = editingExpenseId
        ? await editExpense(editingExpenseId, payload)
        : await createExpense(payload);
      if (!res.ok) {
        alert(res.error);
        return;
      }
      const saved = { ...res.data, amount: Number(res.data.amount) || 0 };
      setExpenses((prev) =>
        editingExpenseId
          ? prev.map((e) => (e.id === saved.id ? saved : e))
          : [saved, ...prev],
      );
      // Keep category / payment mode / date for fast repeat entry
      setEditingExpenseId(null);
      setExpTitle("");
      setExpAmount("");
      setExpNotes("");
    } catch (err) {
      console.error("Error saving expense:", err);
      alert("Could not save the expense. Please try again.");
    } finally {
      setIsSavingExpense(false);
    }
  };

  const handleStartEditExpense = (e: Expense) => {
    setEditingExpenseId(e.id);
    setExpTitle(e.title);
    setExpAmount(e.amount);
    setExpCategory(e.category);
    setExpPaymentMode(e.payment_mode);
    setExpNotes(e.notes || "");
    setExpDate(String(e.expense_date).slice(0, 10));
    window.scrollTo({ top: 0, behavior: "smooth" });
    mainScrollRef.current?.scrollTo({ top: 0, behavior: "smooth" });
  };

  const handleCancelEditExpense = () => {
    setEditingExpenseId(null);
    setExpTitle("");
    setExpAmount("");
    setExpNotes("");
  };

  // Category manager callbacks. The server already rewrote expenses.category; mirror that in
  // local state so the filter, "Spend by Category" and the log update without a refetch.
  const handleExpenseCategoryCreated = (cat: ExpenseCategory) =>
    setExpenseCategories((prev) =>
      prev.some((c) => c.id === cat.id) ? prev : [...prev, cat],
    );

  const handleExpenseCategoryRenamed = (cat: ExpenseCategory, oldName: string) => {
    setExpenseCategories((prev) => prev.map((c) => (c.id === cat.id ? cat : c)));
    setExpenses((prev) =>
      prev.map((e) => (e.category === oldName ? { ...e, category: cat.name } : e)),
    );
    setExpCategory((prev) => (prev === oldName ? cat.name : prev));
    setExpenseCategoryFilter((prev) => (prev === oldName ? cat.name : prev));
  };

  const handleExpenseCategoryDeleted = (cat: ExpenseCategory) => {
    setExpenseCategories((prev) => {
      const rest = prev.filter((c) => c.id !== cat.id);
      return rest.some((c) => c.name === FALLBACK_EXPENSE_CATEGORY)
        ? rest
        : [...rest, { ...cat, id: `local-${FALLBACK_EXPENSE_CATEGORY}`, name: FALLBACK_EXPENSE_CATEGORY }];
    });
    setExpenses((prev) =>
      prev.map((e) =>
        e.category === cat.name ? { ...e, category: FALLBACK_EXPENSE_CATEGORY } : e,
      ),
    );
    setExpCategory((prev) => (prev === cat.name ? FALLBACK_EXPENSE_CATEGORY : prev));
    setExpenseCategoryFilter((prev) => (prev === cat.name ? "ALL" : prev));
  };

  const expenseCountByCategory = React.useMemo(() => {
    const counts: Record<string, number> = {};
    for (const e of expenses) counts[e.category] = (counts[e.category] || 0) + 1;
    return counts;
  }, [expenses]);

  const handleDeleteExpense = async (id: string) => {
    if (!window.confirm("Delete this expense? This cannot be undone.")) return;
    try {
      const res = await removeExpense(id);
      if (!res.ok) {
        alert(res.error);
        return;
      }
      setExpenses((prev) => prev.filter((e) => e.id !== id));
      if (editingExpenseId === id) handleCancelEditExpense();
    } catch (err) {
      console.error("Error deleting expense:", err);
      alert("Could not delete the expense.");
    }
  };

  // Expenses filtered for the Expenses tab (period + category + search)
  const expenseStats = React.useMemo(() => {
    const filtered = expenses.filter((e) => {
      if (
        !isDateInPeriod(
          e.expense_date,
          expensePeriod,
          expenseStartDate,
          expenseEndDate,
        )
      )
        return false;
      if (expenseCategoryFilter !== "ALL" && e.category !== expenseCategoryFilter)
        return false;
      if (expenseSearch) {
        const q = expenseSearch.toLowerCase();
        if (
          !e.title.toLowerCase().includes(q) &&
          !e.category.toLowerCase().includes(q) &&
          !(e.notes || "").toLowerCase().includes(q)
        )
          return false;
      }
      return true;
    });
    const sortedFiltered = [...filtered].sort((a, b) => {
      let comparison = 0;
      if (expenseSortField === "date") {
        comparison =
          new Date(a.expense_date).getTime() - new Date(b.expense_date).getTime();
      } else if (expenseSortField === "title") {
        comparison = (a.title || "").localeCompare(b.title || "");
      } else if (expenseSortField === "category") {
        comparison = (a.category || "").localeCompare(b.category || "");
      } else if (expenseSortField === "payment_mode") {
        comparison = (a.payment_mode || "").localeCompare(b.payment_mode || "");
      } else if (expenseSortField === "amount") {
        comparison = a.amount - b.amount;
      }
      return expenseSortOrder === "asc" ? comparison : -comparison;
    });

    const total = filtered.reduce((acc, e) => acc + e.amount, 0);
    const byCategory: Record<string, number> = {};
    filtered.forEach((e) => {
      byCategory[e.category] = (byCategory[e.category] || 0) + e.amount;
    });
    const categoryBreakdown = Object.entries(byCategory)
      .map(([category, amount]) => ({ category, amount }))
      .sort((a, b) => b.amount - a.amount);
    const topCategory = categoryBreakdown[0]?.category || "None";
    const allCategories = Array.from(
      new Set([
        ...expenseCategories.map((c) => c.name),
        ...expenses.map((e) => e.category),
      ]),
    ).sort();
    return {
      filtered: sortedFiltered,
      total,
      categoryBreakdown,
      topCategory,
      count: filtered.length,
      allCategories,
    };
  }, [
    expenses,
    expenseCategories,
    expensePeriod,
    expenseStartDate,
    expenseEndDate,
    expenseCategoryFilter,
    expenseSearch,
    expenseSortField,
    expenseSortOrder,
  ]);

  // Total expenses within the CURRENT analytics window (drives Net Profit on the dashboard)
  const analyticsExpensesTotal = React.useMemo(() => {
    return expenses
      .filter((e) =>
        isDateInPeriod(
          e.expense_date,
          analyticsPeriod,
          analyticsStartDate,
          analyticsEndDate,
        ),
      )
      .reduce((acc, e) => acc + e.amount, 0);
  }, [expenses, analyticsPeriod, analyticsStartDate, analyticsEndDate]);

  // Real-time analytics derived from orders with period filtering
  const {
    analyticsFilteredOrders,
    totalOrdersCount,
    totalRevenueAmount,
    gstRevenue,
    nonGstRevenue,
    gstOrdersCount,
    nonGstOrdersCount,
    avgOrderValue,
    onlineOrders,
    offlineOrders,
    onlineRevenue,
    offlineRevenue,
    topItems,
    currentWeekNumber,
    weekRevenue,
    maxWeekRevenue,
    monthRevenue,
    maxMonthRevenue,
    totalYearRevenue,
    avgMonthRevenue,
    todayOrders,
    todayRevenue,
    todayOrdersCount,
    todayOnlineOrdersCount,
    todayOfflineOrdersCount,
    todayOnlineRevenue,
    todayOfflineRevenue,
    todayItemsSold,
    todayTopItems,
    monthlyRevenue,
    totalItemsSold,
    topCategory,
    topProduct,
    dayNames,
    monthNames,
    itemSales,
    productSalesExGst,
    now,
  } = React.useMemo(() => {
    const now = new Date();

    // GST dashboard scope: "all" bills, GST invoices only, or non-GST bills only.
    // Analytics figures use product value only (price x qty); GST rows, discount
    // and delivery fee are excluded.
    const productValue = (o: CompletedOrder) =>
      o.items.reduce(
        (sum, i) =>
          i.name && i.name.startsWith("GST (") ? sum : sum + i.price * i.qty,
        0,
      );

    const passesGst = (o: CompletedOrder) =>
      analyticsGstFilter === "all" ||
      (analyticsGstFilter === "gst" ? o.isGst : !o.isGst);

    const analyticsFilteredOrders = orders.filter((o) => {
      if (!passesGst(o)) return false;
      if (
        analyticsSearchPhone &&
        !o.customerPhone.includes(analyticsSearchPhone)
      ) {
        return false;
      }
      const orderDate = new Date(o.date);
      if (analyticsPeriod === "today") {
        return (
          orderDate.getDate() === now.getDate() &&
          orderDate.getMonth() === now.getMonth() &&
          orderDate.getFullYear() === now.getFullYear()
        );
      }
      if (analyticsPeriod === "week") {
        const startOfWeek = new Date(now);
        const dayOfWeek = startOfWeek.getDay();
        const distToMonday = dayOfWeek === 0 ? -6 : 1 - dayOfWeek;
        startOfWeek.setDate(startOfWeek.getDate() + distToMonday); // Monday start of week
        startOfWeek.setHours(0, 0, 0, 0);
        return orderDate >= startOfWeek;
      }
      if (analyticsPeriod === "month") {
        return (
          orderDate.getMonth() === now.getMonth() &&
          orderDate.getFullYear() === now.getFullYear()
        );
      }
      if (analyticsPeriod === "year") {
        return orderDate.getFullYear() === now.getFullYear();
      }
      if (analyticsPeriod === "custom") {
        const orderTime = orderDate.getTime();
        const start = analyticsStartDate ? new Date(analyticsStartDate) : null;
        if (start) start.setHours(0, 0, 0, 0);
        const end = analyticsEndDate ? new Date(analyticsEndDate) : null;
        if (end) end.setHours(23, 59, 59, 999);

        if (start && end) {
          return orderTime >= start.getTime() && orderTime <= end.getTime();
        } else if (start) {
          return orderTime >= start.getTime();
        } else if (end) {
          return orderTime <= end.getTime();
        }
        return true;
      }
      return true; // "all"
    });

    const totalOrdersCount = analyticsFilteredOrders.length;
    const totalRevenueAmount = analyticsFilteredOrders.reduce(
      (acc, o) => acc + productValue(o),
      0,
    );
    const avgOrderValue =
      totalOrdersCount > 0 ? totalRevenueAmount / totalOrdersCount : 0;

    const gstOrders = analyticsFilteredOrders.filter((o) => o.isGst);
    const nonGstOrders = analyticsFilteredOrders.filter((o) => !o.isGst);
    const gstRevenue = gstOrders.reduce((acc, o) => acc + productValue(o), 0);
    const nonGstRevenue = nonGstOrders.reduce(
      (acc, o) => acc + productValue(o),
      0,
    );
    const gstOrdersCount = gstOrders.length;
    const nonGstOrdersCount = nonGstOrders.length;

    // Split channels
    const onlineOrders = analyticsFilteredOrders.filter(
      (o) => o.source === "ONLINE",
    ).length;
    const offlineOrders = analyticsFilteredOrders.filter(
      (o) => o.source === "OFFLINE",
    ).length;

    // Split revenues
    const onlineRevenue = analyticsFilteredOrders
      .filter((o) => o.source === "ONLINE")
      .reduce((acc, o) => acc + productValue(o), 0);
    const offlineRevenue = analyticsFilteredOrders
      .filter((o) => o.source === "OFFLINE")
      .reduce((acc, o) => acc + productValue(o), 0);

    // Top items by revenue in analyticsFilteredOrders
    const itemSales: Record<
      string,
      { name: string; revenue: number; qty: number }
    > = {};
    analyticsFilteredOrders.forEach((order) => {
      order.items.forEach((item) => {
        if (!item.name || item.name.startsWith("GST (")) return;
        if (!itemSales[item.name])
          itemSales[item.name] = { name: item.name, revenue: 0, qty: 0 };
        itemSales[item.name].revenue += item.price * item.qty;
        itemSales[item.name].qty += item.qty;
      });
    });

    // Analytics → Products tab ONLY: product value = price × qty exactly as billed. The bill's GST
    // (a separate amount on the bill) and its discount/delivery are never mixed into these figures,
    // whichever of All / GST / Non-GST bills is selected.
    const productSalesExGst: Record<
      string,
      { name: string; revenue: number; qty: number }
    > = {};
    analyticsFilteredOrders.forEach((order) => {
      order.items.forEach((item) => {
        if (!item.name || item.name.startsWith("GST (")) return;
        if (!productSalesExGst[item.name])
          productSalesExGst[item.name] = { name: item.name, revenue: 0, qty: 0 };
        productSalesExGst[item.name].revenue += item.price * item.qty;
        productSalesExGst[item.name].qty += item.qty;
      });
    });
    const topItems = Object.values(itemSales)
      .sort((a, b) => b.revenue - a.revenue)
      .slice(0, 5);

    // Helper to get ISO week number of the year
    const getWeekOfYear = (d: Date) => {
      const target = new Date(d.valueOf());
      const dayNr = (d.getDay() + 6) % 7; // Monday = 0, Sunday = 6
      target.setDate(target.getDate() - dayNr + 3); // Nearest Thursday
      const firstThursday = target.valueOf();
      target.setMonth(0, 1);
      if (target.getDay() !== 4) {
        target.setMonth(0, 1 + ((4 - target.getDay() + 7) % 7));
      }
      return 1 + Math.ceil((firstThursday - target.valueOf()) / 604800000);
    };
    const currentWeekNumber = getWeekOfYear(now);

    // Revenue per day of current week (Mon–Sun) - CONSTANT (independent of analyticsPeriod filters)
    const dayNames = ["Mon", "Tue", "Wed", "Thu", "Fri", "Sat", "Sun"];
    const weekRevenue = [0, 0, 0, 0, 0, 0, 0];

    // Find Monday to Sunday of current calendar week
    const currentDayOfWeek = now.getDay();
    const distToMon = currentDayOfWeek === 0 ? -6 : 1 - currentDayOfWeek;
    const mondayOfThisWeek = new Date(
      now.getFullYear(),
      now.getMonth(),
      now.getDate() + distToMon,
    );
    mondayOfThisWeek.setHours(0, 0, 0, 0);

    const sundayOfThisWeek = new Date(mondayOfThisWeek);
    sundayOfThisWeek.setDate(mondayOfThisWeek.getDate() + 6);
    sundayOfThisWeek.setHours(23, 59, 59, 999);

    orders.forEach((order) => {
      if (!passesGst(order)) return;
      if (analyticsSearchPhone) {
        const q = analyticsSearchPhone.toLowerCase();
        const matchPhone = order.customerPhone.includes(q);
        const matchInvoice = order.id.toLowerCase().includes(q);
        if (!matchPhone && !matchInvoice) {
          return;
        }
      }
      const orderDate = new Date(order.date);
      const orderTime = orderDate.getTime();
      if (
        orderTime >= mondayOfThisWeek.getTime() &&
        orderTime <= sundayOfThisWeek.getTime()
      ) {
        const day = (orderDate.getDay() + 6) % 7;
        weekRevenue[day] += productValue(order);
      }
    });
    const maxWeekRevenue = Math.max(...weekRevenue, 1);

    // Revenue per month of current year - CONSTANT (independent of analyticsPeriod filters)
    const monthNames = [
      "Jan",
      "Feb",
      "Mar",
      "Apr",
      "May",
      "Jun",
      "Jul",
      "Aug",
      "Sep",
      "Oct",
      "Nov",
      "Dec",
    ];
    const monthRevenue = Array(12).fill(0);
    orders.forEach((order) => {
      if (!passesGst(order)) return;
      if (analyticsSearchPhone) {
        const q = analyticsSearchPhone.toLowerCase();
        const matchPhone = order.customerPhone.includes(q);
        const matchInvoice = order.id.toLowerCase().includes(q);
        if (!matchPhone && !matchInvoice) {
          return;
        }
      }
      const d = new Date(order.date);
      if (d.getFullYear() === now.getFullYear()) {
        monthRevenue[d.getMonth()] += productValue(order);
      }
    });
    const maxMonthRevenue = Math.max(...monthRevenue, 1);
    const totalYearRevenue = monthRevenue.reduce((a, b) => a + b, 0);
    const avgMonthRevenue = totalYearRevenue / 12;

    // New Detailed KPI Computations based on analyticsFilteredOrders
    const todayOrders = orders.filter((o) => {
      if (!passesGst(o)) return false;
      if (analyticsSearchPhone) {
        const q = analyticsSearchPhone.toLowerCase();
        const matchPhone = o.customerPhone.includes(q);
        const matchInvoice = o.id.toLowerCase().includes(q);
        if (!matchPhone && !matchInvoice) {
          return false;
        }
      }
      const d = new Date(o.date);
      return (
        d.getDate() === now.getDate() &&
        d.getMonth() === now.getMonth() &&
        d.getFullYear() === now.getFullYear()
      );
    });

    const todayRevenue = todayOrders.reduce((acc, o) => acc + productValue(o), 0);

    const todayOrdersCount = todayOrders.length;
    const todayOnlineOrdersCount = todayOrders.filter(
      (o) => o.source === "ONLINE",
    ).length;
    const todayOfflineOrdersCount = todayOrders.filter(
      (o) => o.source === "OFFLINE",
    ).length;

    const todayOnlineRevenue = todayOrders
      .filter((o) => o.source === "ONLINE")
      .reduce((acc, o) => acc + productValue(o), 0);
    const todayOfflineRevenue = todayOrders
      .filter((o) => o.source === "OFFLINE")
      .reduce((acc, o) => acc + productValue(o), 0);

    const todayItemsSold = todayOrders.reduce(
      (acc, o) =>
        acc +
        o.items.reduce((sum, item) => {
          const isGST = item.name && item.name.startsWith("GST (");
          return sum + (isGST ? 0 : item.qty);
        }, 0),
      0,
    );

    // Today's top items
    const todayItemSales: Record<
      string,
      { name: string; revenue: number; qty: number }
    > = {};
    todayOrders.forEach((order) => {
      order.items.forEach((item) => {
        if (!item.name || item.name.startsWith("GST (")) return;
        if (!todayItemSales[item.name])
          todayItemSales[item.name] = { name: item.name, revenue: 0, qty: 0 };
        todayItemSales[item.name].revenue += item.price * item.qty;
        todayItemSales[item.name].qty += item.qty;
      });
    });
    const todayTopItems = Object.values(todayItemSales)
      .sort((a, b) => b.revenue - a.revenue)
      .slice(0, 5);

    const monthlyRevenue = orders
      .filter((o) => {
        if (!passesGst(o)) return false;
        const d = new Date(o.date);
        return (
          d.getMonth() === now.getMonth() &&
          d.getFullYear() === now.getFullYear()
        );
      })
      .reduce((acc, o) => acc + productValue(o), 0);

    const totalItemsSold = analyticsFilteredOrders.reduce(
      (acc, o) =>
        acc +
        o.items.reduce((sum, item) => {
          const isGST = item.name && item.name.startsWith("GST (");
          return sum + (isGST ? 0 : item.qty);
        }, 0),
      0,
    );

    const categorySales: Record<string, number> = {};
    analyticsFilteredOrders.forEach((order) => {
      order.items.forEach((item) => {
        if (item.name && item.name.startsWith("GST (")) return;
        const cat = item.desc || "Uncategorized";
        if (!categorySales[cat]) categorySales[cat] = 0;
        categorySales[cat] += item.price * item.qty;
      });
    });
    const topCategory =
      Object.keys(categorySales).length > 0
        ? Object.entries(categorySales).sort((a, b) => b[1] - a[1])[0][0]
        : "None";
    const topProduct = topItems[0]?.name || "None";
    return {
      analyticsFilteredOrders,
      totalOrdersCount,
      totalRevenueAmount,
      gstRevenue,
      nonGstRevenue,
      gstOrdersCount,
      nonGstOrdersCount,
      avgOrderValue,
      onlineOrders,
      offlineOrders,
      onlineRevenue,
      offlineRevenue,
      topItems,
      currentWeekNumber,
      weekRevenue,
      maxWeekRevenue,
      monthRevenue,
      maxMonthRevenue,
      totalYearRevenue,
      avgMonthRevenue,
      todayOrders,
      todayRevenue,
      todayOrdersCount,
      todayOnlineOrdersCount,
      todayOfflineOrdersCount,
      todayOnlineRevenue,
      todayOfflineRevenue,
      todayItemsSold,
      todayTopItems,
      monthlyRevenue,
      totalItemsSold,
      topCategory,
      topProduct,
      dayNames,
      monthNames,
      itemSales,
      productSalesExGst,
      now,
    };
  }, [
    orders,
    analyticsSearchPhone,
    analyticsPeriod,
    analyticsStartDate,
    analyticsEndDate,
    analyticsGstFilter,
    todayKey,
  ]);

  // Inventory-derived data: low stock alerts
  const inventoryProducts = catalog.filter((c) => !c.id.startsWith("default-"));

  const lowStockItems = inventoryProducts.filter((c) => {
    const threshold =
      typeof c.lowStockThreshold === "number" ? c.lowStockThreshold : 5;
    const stock = typeof c.stockQuantity === "number" ? c.stockQuantity : 0;
    return stock <= threshold;
  });

  const filteredInventory = inventoryProducts
    .filter((p) => {
      if (!inventorySearch.trim()) return true;
      const q = inventorySearch.toLowerCase();
      return (
        p.name.toLowerCase().includes(q) ||
        combineDesc(p.desc, p.desc2).toLowerCase().includes(q) ||
        (p.batchNo || "").toLowerCase().includes(q) ||
        (p.manufacturer || "").toLowerCase().includes(q) ||
        (p.hsnCode || "").toLowerCase().includes(q)
      );
    })
    .sort((a, b) => {
      let comparison = 0;
      if (inventorySortField === "name") {
        comparison = (a.name || "").localeCompare(b.name || "");
      } else if (inventorySortField === "price") {
        comparison = (a.price ?? 0) - (b.price ?? 0);
      } else if (inventorySortField === "gst") {
        comparison = (a.gstRate ?? 0) - (b.gstRate ?? 0);
      } else if (inventorySortField === "stock") {
        comparison = (a.stockQuantity ?? 0) - (b.stockQuantity ?? 0);
      } else if (inventorySortField === "brand") {
        comparison = (a.manufacturer || a.batchNo || "").localeCompare(
          b.manufacturer || b.batchNo || "",
        );
      }
      return inventorySortOrder === "asc" ? comparison : -comparison;
    });

  // Products with a stock problem (out of stock or at/below threshold) — used to
  // raise the stock alarm proactively.
  const stockProblemItems = inventoryProducts.filter((c) => {
    const threshold =
      typeof c.lowStockThreshold === "number" ? c.lowStockThreshold : 5;
    const stock = typeof c.stockQuantity === "number" ? c.stockQuantity : 0;
    return stock <= threshold;
  });
  const outOfStockCount = stockProblemItems.filter(
    (c) => (typeof c.stockQuantity === "number" ? c.stockQuantity : 0) <= 0,
  ).length;

  const lowStockKey = lowStockItems
    .map((c) => c.id)
    .sort()
    .join("|");

  // One shared AudioContext for the whole session. Browsers block audio until
  // the user interacts with the page and start the context "suspended", so we
  // keep a single context around and resume it — otherwise the modal that
  // auto-pops on the billing/home tab would stay silent (no fresh click before
  // it fires), while the Alerts tab worked only because clicking the tab is
  // itself the unlocking gesture.
  const audioCtxRef = useRef<AudioContext | null>(null);
  const getAudioContext = useCallback((): AudioContext | null => {
    if (typeof window === "undefined") return null;
    const AudioCtx =
      (window as unknown as { AudioContext?: typeof AudioContext })
        .AudioContext ||
      (window as unknown as { webkitAudioContext?: typeof AudioContext })
        .webkitAudioContext;
    if (!AudioCtx) return null;
    if (!audioCtxRef.current) {
      audioCtxRef.current = new AudioCtx();
    }
    return audioCtxRef.current;
  }, []);

  // Plays the three-tone stock-alarm chime. Extracted so both the initial
  // "new low-stock item" beep and the repeating alarm-clock loop can reuse it.
  const playStockAlertBeep = useCallback(() => {
    try {
      const ctx = getAudioContext();
      if (!ctx) return;
      // If the browser left it suspended (autoplay policy), try to resume; once
      // a user gesture has happened this succeeds and stays running.
      if (ctx.state === "suspended") void ctx.resume();
      const now = ctx.currentTime;
      [0, 0.18, 0.36].forEach((offset) => {
        const osc = ctx.createOscillator();
        const gain = ctx.createGain();
        osc.type = "square";
        osc.frequency.setValueAtTime(880, now + offset);
        gain.gain.setValueAtTime(0.001, now + offset);
        gain.gain.exponentialRampToValueAtTime(0.15, now + offset + 0.01);
        gain.gain.exponentialRampToValueAtTime(0.001, now + offset + 0.14);
        osc.connect(gain).connect(ctx.destination);
        osc.start(now + offset);
        osc.stop(now + offset + 0.16);
      });
    } catch (err) {
      console.warn("Alert beep failed:", err);
    }
  }, [getAudioContext]);

  // Unlock audio on the very first user interaction anywhere on the page, so
  // alarms triggered automatically afterwards (the stock modal on load) are
  // actually audible. Listeners stay attached so audio re-unlocks if the
  // context is ever re-suspended (e.g. after the tab is backgrounded).
  useEffect(() => {
    const unlock = () => {
      const ctx = getAudioContext();
      if (ctx && ctx.state === "suspended") void ctx.resume();
    };
    window.addEventListener("pointerdown", unlock);
    window.addEventListener("keydown", unlock);
    window.addEventListener("touchstart", unlock);
    return () => {
      window.removeEventListener("pointerdown", unlock);
      window.removeEventListener("keydown", unlock);
      window.removeEventListener("touchstart", unlock);
    };
  }, [getAudioContext]);

  // Surface the stock alarm automatically once, right after inventory loads,
  // so out-of-stock / low-stock items are never missed even if the operator
  // never opens the Alerts tab.
  const initialStockAlertShownRef = useRef(false);
  useEffect(() => {
    if (initialStockAlertShownRef.current) return;
    if (!isAuthorized || catalog.length === 0) return;
    initialStockAlertShownRef.current = true;
    if (stockProblemItems.length > 0) {
      setLowStockAlertProducts(lowStockItems);
      setShowLowStockAlertModal(true);
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [isAuthorized, catalog.length]);

  useEffect(() => {
    if (!isAuthorized || lowStockItems.length === 0) return;
    const currentIds = lowStockItems.map((c) => c.id);
    const hasNew = currentIds.some((id) => !alertedIds.has(id));
    if (!hasNew) return;

    playStockAlertBeep();

    setAlertedIds(new Set(currentIds));
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [isAuthorized, lowStockKey]);

  // Alarm-clock style: while the stock-alert modal is open, keep replaying the
  // three-tone chime on a tight loop (like an alarm going off) until the
  // operator dismisses the modal. Driven purely by the modal being open, so it
  // rings on every tab — including the home / billing page.
  useEffect(() => {
    if (!showLowStockAlertModal) return;
    playStockAlertBeep(); // ring immediately when the modal appears
    const id = window.setInterval(() => {
      playStockAlertBeep();
    }, 1000); // re-ring every second until dismissed
    return () => window.clearInterval(id);
  }, [showLowStockAlertModal, playStockAlertBeep]);

  useEffect(() => {
    if (activeTab === "alerts") {
      try {
        const AudioCtx = (window as any).AudioContext || (window as any).webkitAudioContext;
        if (AudioCtx) {
          const ctx = new AudioCtx();
          const osc = ctx.createOscillator();
          const gain = ctx.createGain();
          osc.type = "sine";
          osc.frequency.setValueAtTime(523.25, ctx.currentTime);
          gain.gain.setValueAtTime(0.1, ctx.currentTime);
          gain.gain.exponentialRampToValueAtTime(0.001, ctx.currentTime + 0.5);
          osc.connect(gain).connect(ctx.destination);
          osc.start();
          osc.stop(ctx.currentTime + 0.5);
          setTimeout(() => ctx.close().catch(() => {}), 600);
        }
      } catch (err) {}
      
      if (lowStockItems.length > 0) {
        setLowStockAlertProducts(lowStockItems);
        setShowLowStockAlertModal(true);
      }
    }
  }, [activeTab]);

  if (isCheckingAuth) {
    return (
      <div className="min-h-screen bg-[#FFFFFF] flex items-center justify-center font-sans">
        <div className="flex flex-col items-center gap-3">
          <div className="animate-spin rounded-full h-8 w-8 border-b-2 border-[#3F3F46]"></div>
          <div className="animate-spin rounded-full h-8 w-8 border-b-2 border-[#3F3F46]"></div>
          <span className="text-xs text-[#000000] font-bold uppercase tracking-wider">
            Verifying Session...
          </span>
        </div>
      </div>
    );
  }

  if (!isAuthorized) {
    return (
      <div className="min-h-screen bg-[#FFFFFF] flex flex-col items-center justify-center p-4 relative overflow-hidden font-sans">
        {/* Custom luxury grid pattern overlay */}
        <div className="absolute inset-0 bg-[linear-gradient(to_right,#3F3F46/0.03_1px,transparent_1px),linear-gradient(to_bottom,#3F3F46/0.03_1px,transparent_1px)] bg-[size:4rem_4rem]" />

        {/* Abstract Background Orbs */}
        <div className="absolute top-[-20%] left-[-20%] w-[600px] h-[600px] bg-[#3F3F46]/10 rounded-full blur-[150px] animate-pulse" />
        <div
          className="absolute bottom-[-20%] right-[-20%] w-[600px] h-[600px] bg-[#3F3F46]/10 rounded-full blur-[150px] animate-pulse"
          style={{ animationDelay: "2s" }}
        />

        {/* Main Card Container */}
        <div className="relative z-10 w-full max-w-md bg-white border border-[#3F3F46]/30 rounded-[2.5rem] p-8 md:p-10 shadow-[0_30px_70px_rgba(63,63,70,0.1)] overflow-hidden group flex flex-col items-center text-center">
          {/* Card top border gradient accent */}
          <div className="absolute top-0 left-0 right-0 h-1.5 bg-gradient-to-r from-[#3F3F46] via-[#3F3F46] to-[#3F3F46]" />

          {/* Logo with Gradient Hover Glow */}
          <div className="relative group mb-6">
            <div className="absolute -inset-1.5 bg-gradient-to-r from-[#3F3F46] to-[#3F3F46] rounded-2xl blur opacity-30 group-hover:opacity-50 transition duration-1000 group-hover:duration-200"></div>
            <div className="relative w-20 h-20 bg-white rounded-2xl p-3.5 border border-[#3F3F46]/30 shadow-lg flex items-center justify-center">
              <img
                src="/logo.jpeg"
                alt="RAJA MOBILES Logo"
                className="w-full h-full object-contain group-hover:scale-105 transition-transform duration-500"
              />
            </div>
          </div>

          {/* Title */}
          <h1 className="text-3xl font-serif text-[#3F3F46] tracking-tight leading-tight mb-2">
            RAJA MOBILES
          </h1>
          <p className="text-[#1C1917]/50 text-xs font-bold uppercase tracking-[0.2em] mb-8">
            Mobile Shop POS Terminal • Naidumangalam
          </p>

          {/* Form */}
          <form
            onSubmit={handleVerifyPasscode}
            className="w-full space-y-6 text-left"
          >
            <div className="space-y-3">
              <label className="text-[9px] font-bold text-[#3F3F46] uppercase tracking-[0.25em] ml-1">
                Security Passcode
              </label>
              <div className="relative group/input">
                <div className="absolute left-5 top-1/2 -translate-y-1/2 text-[#3F3F46] group-focus-within/input:text-[#3F3F46] transition-colors">
                  <Lock className="w-4 h-4" />
                </div>
                <input
                  type={showPasscode ? "text" : "password"}
                  name="update-pos-passcode"
                  autoComplete="new-password"
                  placeholder="••••••••"
                  className="w-full bg-[#FAFAFA] border border-black/10 hover:border-[#3F3F46]/50 focus:border-[#3F3F46] focus:bg-white rounded-2xl pl-13 pr-13 py-3.5 text-[#3F3F46] font-mono tracking-widest text-lg focus:outline-none transition-all placeholder:text-black/20"
                  value={passcode}
                  onChange={(e) => {
                    setPasscode(e.target.value);
                    if (passcodeError) setPasscodeError("");
                  }}
                  autoFocus
                />
                <button
                  type="button"
                  onClick={() => setShowPasscode(!showPasscode)}
                  className="absolute right-5 top-1/2 -translate-y-1/2 text-black/30 hover:text-[#3F3F46] transition-colors cursor-pointer"
                >
                  {showPasscode ? (
                    <EyeOff className="w-4 h-4" />
                  ) : (
                    <Eye className="w-4 h-4" />
                  )}
                </button>
              </div>
              {passcodeError && (
                <p className="text-xs text-[#27272A] font-bold mt-2 ml-1 animate-in fade-in slide-in-from-top-1">
                  {passcodeError}
                </p>
              )}
            </div>

            <button
              type="submit"
              className="w-full py-4 bg-gradient-to-r from-[#3F3F46] via-[#3F3F46] to-[#3F3F46] hover:brightness-105 active:scale-[0.98] text-white rounded-2xl font-bold text-xs uppercase tracking-[0.2em] transition-all shadow-[0_10px_30px_rgba(63,63,70,0.2)] flex items-center justify-center gap-3 mt-4 group cursor-pointer border border-[#3F3F46]/30"
            >
              Authenticate
              <ChevronRight className="w-4 h-4 group-hover:translate-x-1 transition-transform text-white" />
            </button>
          </form>

          {/* Status Badge */}
          <div className="mt-8 inline-flex items-center gap-2 px-3 py-1 bg-[#3F3F46]/10 border border-[#3F3F46]/30 rounded-full shadow-sm">
            <span className="w-1.5 h-1.5 rounded-full bg-[#3F3F46] animate-pulse" />
            <span className="text-[8px] font-bold text-[#3F3F46] tracking-[0.15em] uppercase">
              SYSTEM ONLINE • ENCRYPTED
            </span>
          </div>
        </div>

        {/* Footnote */}
        <div className="mt-6 text-[#1C1917]/30 text-[9px] font-bold tracking-widest uppercase">
          RAJA MOBILES Terminal v1.0
        </div>
      </div>
    );
  }

  // Filtered orders for Order History tab
  const historyFilteredOrders = orders.filter((order) => {
    const matchId = order.id
      .toLowerCase()
      .includes(orderSearchId.toLowerCase());
    const matchName = order.customerName
      .toLowerCase()
      .includes(orderSearchName.toLowerCase());
    const matchPhone = (order.customerPhone || "").includes(orderSearchPhone);
    const matchSource =
      orderFilterSource === "ALL" || order.source === orderFilterSource;
    const matchStatus =
      orderFilterStatus === "ALL" ||
      order.status.toUpperCase() === orderFilterStatus.toUpperCase();

    // Period match
    let matchPeriod = true;
    if (historyPeriod !== "all") {
      const orderDate = new Date(order.date);
      const orderTime = orderDate.getTime();
      const now = new Date();

      if (historyPeriod === "today") {
        matchPeriod = orderDate.toDateString() === now.toDateString();
      } else if (historyPeriod === "week") {
        const currentDay = now.getDay();
        const distanceToMon = currentDay === 0 ? -6 : 1 - currentDay;
        const startOfWeek = new Date(
          now.getFullYear(),
          now.getMonth(),
          now.getDate() + distanceToMon,
        );
        startOfWeek.setHours(0, 0, 0, 0);
        matchPeriod = orderTime >= startOfWeek.getTime();
      } else if (historyPeriod === "month") {
        const startOfMonth = new Date(now.getFullYear(), now.getMonth(), 1);
        matchPeriod = orderTime >= startOfMonth.getTime();
      } else if (historyPeriod === "year") {
        const startOfYear = new Date(now.getFullYear(), 0, 1);
        matchPeriod = orderTime >= startOfYear.getTime();
      } else if (historyPeriod === "custom") {
        const start = historyStartDate ? new Date(historyStartDate) : null;
        if (start) start.setHours(0, 0, 0, 0);
        const end = historyEndDate ? new Date(historyEndDate) : null;
        if (end) end.setHours(23, 59, 59, 999);

        if (start && end) {
          matchPeriod =
            orderTime >= start.getTime() && orderTime <= end.getTime();
        } else if (start) {
          matchPeriod = orderTime >= start.getTime();
        } else if (end) {
          matchPeriod = orderTime <= end.getTime();
        }
      }
    }

    return (
      matchId &&
      matchName &&
      matchPhone &&
      matchSource &&
      matchStatus &&
      matchPeriod
    );
  }).sort((a, b) => {
    let comparison = 0;
    if (orderSortField === "date") {
      comparison = new Date(a.date).getTime() - new Date(b.date).getTime();
    } else if (orderSortField === "id") {
      comparison = (a.id || "").localeCompare(b.id || "");
    } else if (orderSortField === "name") {
      comparison = (a.customerName || "").localeCompare(b.customerName || "");
    } else if (orderSortField === "total") {
      comparison = (a.grandTotal || 0) - (b.grandTotal || 0);
    } else if (orderSortField === "status") {
      comparison = (a.status || "").localeCompare(b.status || "");
    }
    return orderSortOrder === "asc" ? comparison : -comparison;
  });

  const handleExportCSV = () => {
    if (historyFilteredOrders.length === 0) {
      alert("No orders available to export.");
      return;
    }

    // CSV Headers padded with spaces to ensure columns default to a readable width in Excel
    const headers = [
      "Order ID          ",
      "Date                   ",
      "Customer Name           ",
      "Customer Phone          ",
      "Source        ",
      "Subtotal      ",
      "Discount      ",
      "Delivery Fee  ",
      "Grand Total   ",
      "Payment                         ",
      "Split Payment ",
      "Split Mode 1  ",
      "Split Amount 1",
      "Split Mode 2  ",
      "Split Amount 2",
      "Status        ",
      "Items                                                                               ",
    ];

    // CSV Rows
    const rows = historyFilteredOrders.map((o) => {
      const itemsStr = o.items.map((i) => `${i.name} (x${i.qty})`).join("; ");

      // Formatting date: MM/DD/YYYY HH:MM AM/PM as an Excel text formula to prevent ### errors.
      // Date comes from the (backdatable) bill_date; the time comes from the real
      // transaction timestamp (created_at) rendered in IST.
      const dateStr = new Date(o.date).toLocaleDateString("en-IN");
      const timeStr = new Date(o.createdAt || o.date).toLocaleTimeString(
        "en-IN",
        {
          hour: "2-digit",
          minute: "2-digit",
          timeZone: "Asia/Kolkata",
        },
      );
      const formattedDate = `"=""${dateStr} ${timeStr}"""`;

      // Formatting phone number as an Excel text formula to prevent scientific notation
      const formattedPhone = o.customerPhone
        ? `"=""${o.customerPhone}"""`
        : `"N/A"`;

      return [
        o.id,
        formattedDate,
        o.customerName,
        formattedPhone,
        o.source,
        o.subtotal,
        o.discount,
        o.deliveryFee,
        o.grandTotal,
        paymentSummary(o),
        o.splitMode2 ? "Yes" : "No",
        o.splitMode2 ? o.paymentMode : "",
        o.splitMode2 ? o.splitAmount1 || 0 : "",
        o.splitMode2 ? o.splitMode2 : "",
        o.splitMode2 ? o.splitAmount2 || 0 : "",
        o.status,
        `"${itemsStr.replace(/"/g, '""')}"`,
      ];
    });

    const csvContent = [
      headers.join(","),
      ...rows.map((row) =>
        row
          .map((val) => {
            if (typeof val === "string" && !val.startsWith('"')) {
              return `"${val.replace(/"/g, '""')}"`;
            }
            return val;
          })
          .join(","),
      ),
    ].join("\n");

    const blob = new Blob([csvContent], { type: "text/csv;charset=utf-8;" });
    const url = URL.createObjectURL(blob);
    const link = document.createElement("a");
    link.setAttribute("href", url);
    link.setAttribute(
      "download",
      `Order_History_${historyPeriod}_${localDateStr()}.csv`,
    );
    link.style.visibility = "hidden";
    document.body.appendChild(link);
    link.click();
    document.body.removeChild(link);
  };

  // Analytics → Products CSV. Values are product value only (price × qty), GST excluded.
  const exportAnalyticsProductsCSV = () => {
    const q = productSearchQuery.toLowerCase();
    const rowsData = Object.values(productSalesExGst)
      .filter((i) => i.name.toLowerCase().includes(q))
      .sort((a, b) => b.revenue - a.revenue);
    if (rowsData.length === 0) {
      alert("No product sales available to export.");
      return;
    }
    const total = Object.values(productSalesExGst).reduce((acc, i) => acc + i.revenue, 0);
    const esc = (v: string | number) => `"${String(v).replace(/"/g, '""')}"`;
    const headers = [
      "Rank",
      "Product Name",
      "Qty Sold",
      "Product Value (excl. GST)",
      "Market Share %",
      "Bill Type",
      "Period",
    ];
    const billType =
      analyticsGstFilter === "gst" ? "GST bills" : analyticsGstFilter === "nongst" ? "Non-GST bills" : "All bills";
    const period =
      analyticsPeriod === "custom"
        ? `${analyticsStartDate || "start"} to ${analyticsEndDate || "end"}`
        : analyticsPeriod;
    const lines = rowsData.map((item, idx) =>
      [
        idx + 1,
        esc(item.name),
        item.qty,
        item.revenue.toFixed(2),
        total > 0 ? ((item.revenue / total) * 100).toFixed(1) : "0.0",
        esc(billType),
        esc(period),
      ].join(","),
    );
    const csv = "﻿" + [headers.map(esc).join(","), ...lines].join("\n");
    const url = URL.createObjectURL(new Blob([csv], { type: "text/csv;charset=utf-8;" }));
    const link = document.createElement("a");
    link.href = url;
    link.download = `Analytics_Products_${analyticsGstFilter}_${analyticsPeriod}_${localDateStr()}.csv`;
    link.style.visibility = "hidden";
    document.body.appendChild(link);
    link.click();
    document.body.removeChild(link);
    URL.revokeObjectURL(url);
  };

  const exportInventoryCSV = () => {
    if (inventoryProducts.length === 0) {
      alert("No products in inventory to export.");
      return;
    }
    const headers = [
      "Product ID",
      "Name",
      "Description",
      "Description 2",
      "Price",
      "GST %",
      "Stock Qty",
      "Low-Stock Threshold",
      "Batch No",
      "Brand / Manufacturer",
      "HSN Code",
    ];
    const rows = inventoryProducts.map((p) => [
      p.id,
      p.name,
      p.desc || "",
      p.desc2 || "",
      p.price ?? "",
      p.gstRate ?? "",
      p.stockQuantity ?? "",
      p.lowStockThreshold ?? "",
      p.batchNo || "",
      p.manufacturer || "",
      p.hsnCode || "",
    ]);
    const csv = [headers, ...rows]
      .map((row) =>
        row
          .map((v) => {
            const s = String(v ?? "");
            return `"${s.replace(/"/g, '""')}"`;
          })
          .join(","),
      )
      .join("\n");
    const blob = new Blob([csv], { type: "text/csv;charset=utf-8;" });
    const url = URL.createObjectURL(blob);
    const link = document.createElement("a");
    link.setAttribute("href", url);
    link.setAttribute(
      "download",
      `Raja_Mobiles_Inventory_${localDateStr()}.csv`,
    );
    link.style.visibility = "hidden";
    document.body.appendChild(link);
    link.click();
    document.body.removeChild(link);
  };

  return (
    <div className="min-h-screen bg-[#FFFFFF] text-[#000000] flex flex-row font-sans overflow-hidden">
      {/* Catalog Modal */}
      {showCatalogModal && (
        <div className="fixed inset-0 bg-black/60 backdrop-blur-sm z-[100] flex items-center justify-center p-4">
          <div className="bg-white rounded-2xl shadow-[0_20px_60px_rgba(0,0,0,0.3)] border border-black/10 w-full max-w-md overflow-hidden transform animate-in zoom-in-95 duration-200">
            {/* Header */}
            <div className="px-6 py-5 bg-white border-b border-black/10 flex justify-between items-center">
              <div className="flex items-center gap-3">
                <div className="w-10 h-10 bg-[#3F3F46]/10 rounded-xl flex items-center justify-center text-[#3F3F46]">
                  <PackagePlus className="w-5 h-5" />
                </div>
                <div>
                  <h3 className="font-extrabold text-base text-black tracking-tight">
                    {editingCatalogId
                      ? "Edit Catalog Item"
                      : "Add New Product"}
                  </h3>
                  <p className="text-[11px] text-gray-500 font-medium">
                    {editingCatalogId
                      ? "Modify product parameters"
                      : "Register product into catalog"}
                  </p>
                </div>
              </div>
              <button
                onClick={() => {
                  resetCatalogForm();
                  setEditingCatalogId(null);
                  setShowCatalogModal(false);
                }}
                className="w-8 h-8 flex items-center justify-center rounded-lg bg-gray-100 hover:bg-gray-200 text-gray-700 transition-colors cursor-pointer"
              >
                <X className="w-4 h-4" />
              </button>
            </div>

            {/* Form Content */}
            <div className="p-6 space-y-4 max-h-[80vh] overflow-y-auto bg-white">
              <div>
                <label className="block text-[10px] font-bold text-gray-600 uppercase tracking-widest mb-1.5">
                  Product Name <span className="text-[#3F3F46]">*</span>
                </label>
                <input
                  type="text"
                  placeholder="e.g., Redmi Note 13 (128GB)"
                  className="w-full bg-white border border-gray-200 hover:border-gray-300 focus:border-[#3F3F46] rounded-lg px-3.5 py-2.5 text-sm font-bold text-black focus:outline-none transition-colors shadow-xs"
                  value={newCatName}
                  onChange={(e) => setNewCatName(e.target.value)}
                  autoFocus
                />
              </div>

              <div className="grid grid-cols-2 gap-4">
                <div>
                  <label className="block text-[10px] font-bold text-gray-600 uppercase tracking-widest mb-1.5">
                    Description 1 (Optional)
                  </label>
                  <input
                    type="text"
                    placeholder="e.g., 128GB, Ice Blue, 6GB RAM"
                    className="w-full bg-white border border-gray-200 hover:border-gray-300 focus:border-[#3F3F46] rounded-lg px-3.5 py-2.5 text-sm font-semibold text-black focus:outline-none transition-colors shadow-xs"
                    value={newCatDesc}
                    onChange={(e) => setNewCatDesc(e.target.value)}
                  />
                </div>
                <div>
                  <label className="block text-[10px] font-bold text-gray-600 uppercase tracking-widest mb-1.5">
                    Description 2 (Optional)
                  </label>
                  <input
                    type="text"
                    placeholder="e.g., 1 Year Warranty"
                    className="w-full bg-white border border-gray-200 hover:border-gray-300 focus:border-[#3F3F46] rounded-lg px-3.5 py-2.5 text-sm font-semibold text-black focus:outline-none transition-colors shadow-xs"
                    value={newCatDesc2}
                    onChange={(e) => setNewCatDesc2(e.target.value)}
                  />
                </div>
              </div>
              {(newCatDesc.trim() || newCatDesc2.trim()) && (
                <p className="text-[9px] text-gray-400 font-semibold -mt-2">
                  Shows as: <span className="text-gray-600 font-bold">{combineDesc(newCatDesc, newCatDesc2)}</span>
                </p>
              )}

              <div>
                <label className="block text-[10px] font-bold text-gray-600 uppercase tracking-widest mb-1.5">
                  Category
                </label>
                <ProductCategoryInput
                  categories={categories}
                  value={newCatCategory}
                  onChange={setNewCatCategory}
                  usage={productCountByCategory}
                  canManage={role === "admin"}
                  notify={notify}
                  onRenamed={handleProductCategoryRenamed}
                  onDeleted={handleProductCategoryDeleted}
                />
                <p className="text-[9px] text-gray-400 font-semibold mt-1">
                  Pick an existing category or type a new one (it will be added automatically)
                </p>
              </div>

              <label className="flex items-center gap-2.5 py-1 cursor-pointer select-none">
                <input
                  type="checkbox"
                  className="w-4 h-4 accent-[#3F3F46] cursor-pointer"
                  checked={newCatTracksSerial}
                  onChange={(e) => setNewCatTracksSerial(e.target.checked)}
                />
                <span className="text-xs font-bold text-black">
                  This product has IMEI / serial numbers
                </span>
              </label>
              {newCatTracksSerial && (
                <p className="text-[9px] text-gray-500 font-semibold -mt-2">
                  Each unit is tracked individually. Stock is set by the number of serials you enter below.
                  {editingCatalogId && " To add more units later, use “+ Add Batch”."}
                </p>
              )}

              <div className="grid grid-cols-3 gap-4">
                <div>
                  <label className="block text-[10px] font-bold text-gray-600 uppercase tracking-widest mb-1.5">
                    Cost Price (₹) <span className="text-gray-400 normal-case tracking-normal font-semibold">(optional)</span>
                  </label>
                  <input
                    type="number"
                    min={0}
                    placeholder="0.00"
                    className="w-full bg-white border border-gray-200 hover:border-gray-300 focus:border-[#3F3F46] rounded-lg px-3.5 py-2.5 text-sm font-bold text-black focus:outline-none transition-colors shadow-xs"
                    value={newCatCostPrice}
                    onWheel={(e) => e.currentTarget.blur()}
                    onChange={(e) =>
                      setNewCatCostPrice(
                        e.target.value === "" ? "" : parseFloat(e.target.value),
                      )
                    }
                  />
                </div>

                <div>
                  <label className="block text-[10px] font-bold text-gray-600 uppercase tracking-widest mb-1.5">
                    Selling Price (₹, incl. GST) <span className="text-[#3F3F46]">*</span>
                  </label>
                  <input
                    type="number"
                    placeholder="0.00"
                    className="w-full bg-white border border-gray-200 hover:border-gray-300 focus:border-[#3F3F46] rounded-lg px-3.5 py-2.5 text-sm font-bold text-black focus:outline-none transition-colors shadow-xs"
                    value={newCatPrice}
                    onWheel={(e) => e.currentTarget.blur()}
                    onChange={(e) =>
                      setNewCatPrice(
                        e.target.value === "" ? "" : parseFloat(e.target.value),
                      )
                    }
                  />
                </div>

                <div>
                  <label className="block text-[10px] font-bold text-gray-600 uppercase tracking-widest mb-1.5">
                    GST Rate (%)
                  </label>
                  <input
                    type="number"
                    min={0}
                    max={100}
                    step="0.01"
                    placeholder="18"
                    className="w-full bg-white border border-gray-200 hover:border-gray-300 focus:border-[#3F3F46] rounded-lg px-3.5 py-2.5 text-sm font-bold text-black focus:outline-none transition-colors shadow-xs"
                    value={newCatGst}
                    onWheel={(e) => e.currentTarget.blur()}
                    onChange={(e) =>
                      setNewCatGst(
                        e.target.value === "" ? "" : parseFloat(e.target.value),
                      )
                    }
                  />
                  <p className="text-[9px] text-gray-400 font-semibold mt-1">
                    Price above already includes this GST — shown as CGST + SGST on the invoice
                  </p>
                </div>
              </div>

              <div className="grid grid-cols-2 gap-4">
                {!newCatTracksSerial && (
                  <div>
                    <label className="block text-[10px] font-bold text-gray-600 uppercase tracking-widest mb-1.5">
                      Stock Quantity
                    </label>
                    <input
                      type="number"
                      min={0}
                      placeholder="0"
                      className="w-full bg-white border border-gray-200 hover:border-gray-300 focus:border-[#3F3F46] rounded-lg px-3.5 py-2.5 text-sm font-bold text-black focus:outline-none transition-colors shadow-xs"
                      value={newCatStock}
                      onWheel={(e) => e.currentTarget.blur()}
                      onChange={(e) =>
                        setNewCatStock(
                          e.target.value === ""
                            ? ""
                            : parseInt(e.target.value, 10),
                        )
                      }
                    />
                  </div>
                )}

                <div>
                  <label className="block text-[10px] font-bold text-gray-600 uppercase tracking-widest mb-1.5">
                    Low-Stock Alert At
                  </label>
                  <input
                    type="number"
                    min={0}
                    placeholder="10"
                    className="w-full bg-white border border-gray-200 hover:border-gray-300 focus:border-[#3F3F46] rounded-lg px-3.5 py-2.5 text-sm font-bold text-black focus:outline-none transition-colors shadow-xs"
                    value={newCatThreshold}
                    onWheel={(e) => e.currentTarget.blur()}
                    onChange={(e) =>
                      setNewCatThreshold(
                        e.target.value === ""
                          ? ""
                          : parseInt(e.target.value, 10),
                      )
                    }
                  />
                </div>
              </div>

              {newCatTracksSerial && !editingCatalogId && (
                <div>{renderSerialEntry()}</div>
              )}

              <div className="grid grid-cols-2 gap-4">
                <div>
                  <label className="block text-[10px] font-bold text-gray-600 uppercase tracking-widest mb-1.5">
                    Batch Number
                  </label>
                  <input
                    type="text"
                    placeholder="e.g., B12345"
                    className="w-full bg-white border border-gray-200 hover:border-gray-300 focus:border-[#3F3F46] rounded-lg px-3.5 py-2.5 text-sm font-semibold text-black focus:outline-none transition-colors shadow-xs"
                    value={newCatBatch}
                    onChange={(e) => setNewCatBatch(e.target.value)}
                  />
                </div>

                <div>
                  <label className="block text-[10px] font-bold text-gray-600 uppercase tracking-widest mb-1.5">
                    HSN Code
                  </label>
                  <input
                    type="text"
                    placeholder="e.g., 8517"
                    className="w-full bg-white border border-gray-200 hover:border-gray-300 focus:border-[#3F3F46] rounded-lg px-3.5 py-2.5 text-sm font-semibold text-black focus:outline-none transition-colors shadow-xs"
                    value={newCatHsn}
                    onChange={(e) => setNewCatHsn(e.target.value)}
                  />
                </div>
              </div>

              <div>
                <label className="block text-[10px] font-bold text-gray-600 uppercase tracking-widest mb-1.5">
                  Brand / Manufacturer
                </label>
                <input
                  type="text"
                  placeholder="e.g., Samsung, Xiaomi, boAt"
                  className="w-full bg-white border border-gray-200 hover:border-gray-300 focus:border-[#3F3F46] rounded-lg px-3.5 py-2.5 text-sm font-semibold text-black focus:outline-none transition-colors shadow-xs"
                  value={newCatManufacturer}
                  onChange={(e) => setNewCatManufacturer(e.target.value)}
                />
              </div>

              <button
                onClick={addToCatalog}
                disabled={isSavingCatalog}
                className="w-full py-3.5 mt-2 bg-[#3F3F46] hover:bg-[#27272A] text-white rounded-xl font-bold text-xs uppercase tracking-widest transition-colors shadow-sm cursor-pointer flex items-center justify-center gap-2 disabled:opacity-60 disabled:cursor-not-allowed"
              >
                {isSavingCatalog ? (
                  <Loader2 className="w-4 h-4 animate-spin" />
                ) : (
                  <PackagePlus className="w-4 h-4" />
                )}
                {editingCatalogId ? "Save Changes" : "Save Product to Catalog"}
              </button>
            </div>
          </div>
        </div>
      )}

      {/* Add New Batch Modal */}
      {showBatchModal && (
        <div className="fixed inset-0 bg-black/60 backdrop-blur-sm z-[100] flex items-center justify-center p-4">
          <div className="bg-white rounded-2xl shadow-[0_20px_60px_rgba(0,0,0,0.3)] border border-black/10 w-full max-w-md overflow-hidden transform animate-in zoom-in-95 duration-200">
            {/* Header */}
            <div className="px-6 py-5 bg-white border-b border-black/10 flex justify-between items-center">
              <div className="flex items-center gap-3">
                <div className="w-10 h-10 bg-[#3F3F46]/10 rounded-xl flex items-center justify-center text-[#3F3F46]">
                  <PackagePlus className="w-5 h-5" />
                </div>
                <div>
                  <h3 className="font-extrabold text-base text-black tracking-tight">
                    Add New Batch
                  </h3>
                  <p className="text-[11px] text-gray-500 font-medium">
                    Record batch stock & arrival info
                  </p>
                </div>
              </div>
              <button
                onClick={() => {
                  resetCatalogForm();
                  setBatchTargetProductId(null);
                  setShowBatchModal(false);
                }}
                className="w-8 h-8 flex items-center justify-center rounded-lg bg-gray-100 hover:bg-gray-200 text-gray-700 transition-colors cursor-pointer"
              >
                <X className="w-4 h-4" />
              </button>
            </div>

            {/* Form Body - Clear 2-column layout */}
            <div className="p-6 space-y-4 max-h-[80vh] overflow-y-auto bg-white">
              {/* Row 1: Pricing */}
              <div className="grid grid-cols-2 gap-4">
                <div>
                  <label className="block text-[10px] font-bold text-gray-600 uppercase tracking-widest mb-1.5">
                    Cost Price (₹)
                  </label>
                  <input
                    type="number"
                    placeholder="0.00"
                    className="w-full bg-white border border-gray-200 hover:border-gray-300 focus:border-[#3F3F46] rounded-lg px-3.5 py-2.5 text-sm font-bold text-black focus:outline-none transition-colors shadow-xs"
                    value={newCatCostPrice}
                    onChange={(e) =>
                      setNewCatCostPrice(
                        e.target.value ? Number(e.target.value) : "",
                      )
                    }
                    onWheel={(e) => e.currentTarget.blur()}
                  />
                </div>
                <div>
                  <label className="block text-[10px] font-bold text-gray-600 uppercase tracking-widest mb-1.5">
                    Selling Price (₹, incl. GST)
                  </label>
                  <input
                    type="number"
                    placeholder="0.00"
                    className="w-full bg-white border border-gray-200 hover:border-gray-300 focus:border-[#3F3F46] rounded-lg px-3.5 py-2.5 text-sm font-bold text-black focus:outline-none transition-colors shadow-xs"
                    value={newCatPrice}
                    onChange={(e) =>
                      setNewCatPrice(
                        e.target.value ? Number(e.target.value) : "",
                      )
                    }
                    onWheel={(e) => e.currentTarget.blur()}
                  />
                </div>
              </div>

              {/* Row 2: Stock Quantity & Batch Number */}
              {(() => {
                const batchTracksSerial = Boolean(
                  catalog.find((c) => c.id === batchTargetProductId)?.tracksSerial,
                );
                return (
                  <>
                    <div className="grid grid-cols-2 gap-4">
                      {!batchTracksSerial && (
                        <div>
                          <label className="block text-[10px] font-bold text-gray-600 uppercase tracking-widest mb-1.5">
                            Stock Quantity
                          </label>
                          <input
                            type="number"
                            placeholder="0"
                            className="w-full bg-white border border-gray-200 hover:border-gray-300 focus:border-[#3F3F46] rounded-lg px-3.5 py-2.5 text-sm font-bold text-black focus:outline-none transition-colors shadow-xs"
                            value={newCatStock}
                            onChange={(e) =>
                              setNewCatStock(
                                e.target.value ? Number(e.target.value) : "",
                              )
                            }
                            onWheel={(e) => e.currentTarget.blur()}
                          />
                        </div>
                      )}
                      <div>
                        <label className="block text-[10px] font-bold text-gray-600 uppercase tracking-widest mb-1.5">
                          Batch Number
                        </label>
                        <input
                          type="text"
                          placeholder="e.g., LOT-002"
                          className="w-full bg-white border border-gray-200 hover:border-gray-300 focus:border-[#3F3F46] rounded-lg px-3.5 py-2.5 text-sm font-semibold text-black focus:outline-none transition-colors shadow-xs"
                          value={newCatBatch}
                          onChange={(e) => setNewCatBatch(e.target.value)}
                        />
                      </div>
                    </div>

                    {batchTracksSerial && <div>{renderSerialEntry()}</div>}
                  </>
                );
              })()}

              {/* Submit Button */}
              <button
                onClick={handleAddBatchSubmit}
                disabled={isSavingCatalog}
                className="w-full py-3.5 mt-2 bg-[#3F3F46] hover:bg-[#27272A] text-white rounded-xl font-bold text-xs uppercase tracking-widest transition-colors shadow-sm cursor-pointer flex items-center justify-center gap-2 disabled:opacity-60 disabled:cursor-not-allowed"
              >
                {isSavingCatalog ? (
                  <Loader2 className="w-4 h-4 animate-spin" />
                ) : (
                  <PackagePlus className="w-4 h-4" />
                )}
                Save New Batch
              </button>
            </div>
          </div>
        </div>
      )}

      {/* Manage IMEIs / Serials Modal */}
      {showUnitsModal && (
        <div className="fixed inset-0 bg-black/60 backdrop-blur-sm z-[100] flex items-center justify-center p-4">
          <div className="bg-white rounded-2xl shadow-[0_20px_60px_rgba(0,0,0,0.3)] border border-black/10 w-full max-w-lg overflow-hidden transform animate-in zoom-in-95 duration-200">
            <div className="px-6 py-5 bg-white border-b border-black/10 flex justify-between items-center">
              <div className="flex items-center gap-3">
                <div className="w-10 h-10 bg-[#3F3F46]/10 rounded-xl flex items-center justify-center text-[#3F3F46]">
                  <List className="w-5 h-5" />
                </div>
                <div>
                  <h3 className="font-extrabold text-base text-black tracking-tight">
                    Manage IMEIs / Serials
                  </h3>
                  <p className="text-[11px] text-gray-500 font-medium">
                    {unitsTargetName}
                  </p>
                </div>
              </div>
              <button
                onClick={() => {
                  setShowUnitsModal(false);
                  setUnitsTargetProductId(null);
                  setUnitRows([]);
                  setSerialInputs([]);
                }}
                className="w-8 h-8 flex items-center justify-center rounded-lg bg-gray-100 hover:bg-gray-200 text-gray-700 transition-colors cursor-pointer"
              >
                <X className="w-4 h-4" />
              </button>
            </div>

            <div className="p-6 space-y-4 max-h-[80vh] overflow-y-auto bg-white">
              {isLoadingUnits ? (
                <div className="py-10 flex items-center justify-center text-gray-400">
                  <Loader2 className="w-5 h-5 animate-spin" />
                </div>
              ) : (
                <>
                  <div>
                    <div className="flex items-center justify-between mb-2">
                      <label className="text-[10px] font-bold text-gray-600 uppercase tracking-widest">
                        Existing units ({unitRows.length})
                      </label>
                      <span className="text-[10px] font-bold text-green-600">
                        {unitRows.filter((u) => u.status === "AVAILABLE").length} available
                      </span>
                    </div>
                    {unitRows.length === 0 ? (
                      <p className="text-xs text-gray-400 font-semibold py-3">
                        No units yet. Add some below.
                      </p>
                    ) : (
                      <div className="space-y-1.5 max-h-52 overflow-y-auto pr-1">
                        {unitRows.map((u, idx) => {
                          const sold = u.status === "SOLD";
                          return (
                            <div key={u.id} className="flex items-center gap-2">
                              <span className="w-5 text-[10px] font-bold text-gray-400 text-right shrink-0">
                                {idx + 1}
                              </span>
                              <input
                                type="text"
                                disabled={sold}
                                value={u.serial}
                                onChange={(e) => updateUnitRow(u.id, e.target.value)}
                                onBlur={() => !sold && saveUnitSerial(u)}
                                className={`w-full border rounded-lg px-3 py-2 text-sm font-mono focus:outline-none transition-colors ${
                                  sold
                                    ? "bg-gray-100 border-gray-200 text-gray-400 cursor-not-allowed"
                                    : "bg-white border-gray-200 hover:border-gray-300 focus:border-[#3F3F46] text-black"
                                }`}
                              />
                              {sold ? (
                                <span className="text-[9px] font-bold text-[#27272A] bg-[#27272A]/10 border border-[#27272A]/20 rounded px-2 py-1 shrink-0">
                                  SOLD
                                </span>
                              ) : (
                                <button
                                  onClick={() => deleteUnitRow(u)}
                                  className="text-gray-400 hover:text-[#27272A] p-1.5 rounded-lg border border-gray-200 hover:border-transparent hover:bg-[#F4F4F5] transition-colors shrink-0"
                                  title="Remove unit"
                                >
                                  <Trash2 className="w-3.5 h-3.5" />
                                </button>
                              )}
                            </div>
                          );
                        })}
                      </div>
                    )}
                    <p className="text-[9px] text-gray-500 font-semibold mt-1">
                      Edit a serial and click away to save. Sold units are locked. To add more units, use “+ Add Batch”.
                    </p>
                  </div>
                </>
              )}
            </div>
          </div>
        </div>
      )}

      {/* Mobile/Tablet Sidebar Backdrop */}
      {isSidebarOpen && (
        <div
          onClick={() => setIsSidebarOpen(false)}
          className="fixed inset-0 bg-black/40 backdrop-blur-xs z-30 lg:hidden"
        />
      )}

      {/* Collapsible Left Sidebar */}
      <aside
        className={`fixed lg:sticky top-0 bottom-0 left-0 bg-gradient-to-b from-[#4F46E5] via-[#7C3AED] to-[#5B21B6] text-[#FFFFFF] flex flex-col justify-between h-screen shrink-0 shadow-2xl z-40 transition-all duration-300 ease-in-out ${isSidebarOpen ? "w-60 xl:w-64 border-r border-white/20 translate-x-0" : "w-0 min-w-0 border-r-0 -translate-x-full overflow-hidden"}`}
      >
        <div className="w-60 xl:w-64 flex flex-col h-full shrink-0 overflow-hidden relative">
          <div className="flex flex-col flex-1 min-h-0">
            {/* Header branding */}
            <div className="p-6 [@media(max-height:800px)]:p-4 border-b border-white/20 flex items-center justify-between gap-3 shrink-0">
              <div className="flex items-center gap-3">
                <div className="w-12 h-12 bg-[#FFFFFF] rounded-xl flex items-center justify-center shadow-md overflow-hidden shrink-0">
                  <img
                    src="/logo.jpeg"
                    alt="RAJA MOBILES Logo"
                    className="w-full h-full object-contain p-1"
                  />
                </div>
                <div>
                  <span className="font-black text-sm tracking-tight text-[#FFFFFF] block leading-tight">
                    RAJA MOBILES
                  </span>
                  <span className="text-[9px] text-white/80 font-bold tracking-wider block mt-0.5">
                    Naidumangalam
                  </span>
                </div>
              </div>

              {/* Close Button Inside Sidebar */}
              <button
                onClick={() => setIsSidebarOpen(false)}
                className="w-8 h-8 rounded-lg hover:bg-white/20 flex items-center justify-center text-white font-bold hover:text-white transition-all cursor-pointer"
                title="Close Menu"
              >
                <X className="w-5 h-5" />
              </button>
            </div>

            {/* Navigation Links */}
            <nav className="flex-1 min-h-0 overflow-y-auto overscroll-contain px-3 xl:px-4 py-4 space-y-2 [@media(max-height:800px)]:space-y-1 [&::-webkit-scrollbar]:w-1 [&::-webkit-scrollbar-thumb]:bg-white/30 [&::-webkit-scrollbar-thumb]:rounded">
              <button
                onClick={() => {
                  setActiveTab("billing");
                  setCompletedBillData(null);
                  if (mainScrollRef.current) mainScrollRef.current.scrollTop = 0;
                  window.scrollTo({ top: 0, behavior: "instant" });
                }}
                className={`w-full flex items-center gap-3 xl:gap-4 px-3 xl:px-4 py-3.5 [@media(max-height:800px)]:py-2.5 rounded-xl font-bold text-xs uppercase tracking-wider transition-colors cursor-pointer ${
                  activeTab === "billing"
                    ? "bg-white text-[#27272A] shadow-md"
                    : "text-white/90 hover:bg-white/20 hover:text-white"
                }`}
              >
                <Receipt className="w-5 h-5 shrink-0" />
                Billing Panel
              </button>
              <button
                onClick={() => {
                  setActiveTab("orders");
                  setCompletedBillData(null);
                  if (mainScrollRef.current) mainScrollRef.current.scrollTop = 0;
                  window.scrollTo({ top: 0, behavior: "instant" });
                }}
                className={`w-full flex items-center gap-3 xl:gap-4 px-3 xl:px-4 py-3.5 [@media(max-height:800px)]:py-2.5 rounded-xl font-bold text-xs uppercase tracking-wider transition-colors cursor-pointer ${
                  activeTab === "orders"
                    ? "bg-white text-[#27272A] shadow-md"
                    : "text-white/90 hover:bg-white/20 hover:text-white"
                }`}
              >
                <History className="w-5 h-5 shrink-0" />
                Order History
              </button>
              <button
                onClick={() => {
                  setActiveTab("advance");
                  setCompletedBillData(null);
                  if (mainScrollRef.current) mainScrollRef.current.scrollTop = 0;
                  window.scrollTo({ top: 0, behavior: "instant" });
                }}
                className={`w-full flex items-center gap-3 xl:gap-4 px-3 xl:px-4 py-3.5 [@media(max-height:800px)]:py-2.5 rounded-xl font-bold text-xs uppercase tracking-wider transition-colors cursor-pointer relative ${
                  activeTab === "advance"
                    ? "bg-white text-[#27272A] shadow-md"
                    : "text-white/90 hover:bg-white/20 hover:text-white"
                }`}
              >
                <Clock className="w-5 h-5 shrink-0" />
                Advance Orders
                {advanceOrders.filter((a) => a.status === "PENDING" || a.status === "READY").length > 0 && (
                  <span className="ml-auto min-w-[22px] h-[22px] px-1.5 rounded-full text-[10px] font-black flex items-center justify-center bg-[#F59E0B] text-white">
                    {advanceOrders.filter((a) => a.status === "PENDING" || a.status === "READY").length}
                  </span>
                )}
              </button>
              <button
                onClick={() => {
                  setActiveTab("alerts");
                  setCompletedBillData(null);
                  if (mainScrollRef.current) mainScrollRef.current.scrollTop = 0;
                  window.scrollTo({ top: 0, behavior: "instant" });
                }}
                className={`w-full flex items-center gap-3 xl:gap-4 px-3 xl:px-4 py-3.5 [@media(max-height:800px)]:py-2.5 rounded-xl font-bold text-xs uppercase tracking-wider transition-colors cursor-pointer relative ${
                  activeTab === "alerts"
                    ? "bg-white text-[#27272A] shadow-md"
                    : "text-white/90 hover:bg-white/20 hover:text-white"
                }`}
              >
                <AlertTriangle className="w-5 h-5 shrink-0" />
                Stock Alerts
                {lowStockItems.length > 0 && (
                  <span
                    className={`ml-auto min-w-[22px] h-[22px] px-1.5 rounded-full text-[10px] font-black flex items-center justify-center ${activeTab === "alerts" ? "bg-[#DC2626] text-white" : "bg-[#DC2626] text-white animate-pulse"}`}
                  >
                    {lowStockItems.length}
                  </span>
                )}
              </button>
              {role === "admin" && (
                <button
                  onClick={() => {
                    setActiveTab("inventory");
                    setCompletedBillData(null);
                    if (mainScrollRef.current) mainScrollRef.current.scrollTop = 0;
                    window.scrollTo({ top: 0, behavior: "instant" });
                  }}
                  className={`w-full flex items-center gap-3 xl:gap-4 px-3 xl:px-4 py-3.5 [@media(max-height:800px)]:py-2.5 rounded-xl font-bold text-xs uppercase tracking-wider transition-colors cursor-pointer ${
                    activeTab === "inventory"
                      ? "bg-white text-[#27272A] shadow-md"
                      : "text-white/90 hover:bg-white/20 hover:text-white"
                  }`}
                >
                  <Boxes className="w-5 h-5 shrink-0" />
                  Inventory
                </button>
              )}
              {role === "admin" && (
                <button
                  onClick={() => {
                    setActiveTab("analytics");
                    setCompletedBillData(null);
                    if (mainScrollRef.current) mainScrollRef.current.scrollTop = 0;
                    window.scrollTo({ top: 0, behavior: "instant" });
                  }}
                  className={`w-full flex items-center gap-3 xl:gap-4 px-3 xl:px-4 py-3.5 [@media(max-height:800px)]:py-2.5 rounded-xl font-bold text-xs uppercase tracking-wider transition-colors cursor-pointer ${
                    activeTab === "analytics"
                      ? "bg-white text-[#27272A] shadow-md"
                      : "text-white/90 hover:bg-white/20 hover:text-white"
                  }`}
                >
                  <BarChart2 className="w-5 h-5 shrink-0" />
                  Analytics Dashboard
                </button>
              )}
              {role && (
                <button
                  onClick={() => {
                    setActiveTab("expenses");
                    setCompletedBillData(null);
                    if (mainScrollRef.current) mainScrollRef.current.scrollTop = 0;
                    window.scrollTo({ top: 0, behavior: "instant" });
                  }}
                  className={`w-full flex items-center gap-3 xl:gap-4 px-3 xl:px-4 py-3.5 [@media(max-height:800px)]:py-2.5 rounded-xl font-bold text-xs uppercase tracking-wider transition-colors cursor-pointer ${
                    activeTab === "expenses"
                      ? "bg-white text-[#27272A] shadow-md"
                      : "text-white/90 hover:bg-white/20 hover:text-white"
                  }`}
                >
                  <Wallet className="w-5 h-5 shrink-0" />
                  Expense Tracker
                </button>
              )}

              <div className="pt-3 border-t border-white/20 mt-3">
                <button
                  onClick={handleLogout}
                  className="w-full flex items-center gap-3 xl:gap-4 px-3 xl:px-4 py-3.5 [@media(max-height:800px)]:py-2.5 rounded-xl font-bold text-xs uppercase tracking-wider text-white bg-white/10 hover:bg-white/25 hover:shadow-md border border-white/20 transition-all cursor-pointer"
                >
                  <LogOut className="w-5 h-5" />
                  Log Out
                </button>
              </div>
            </nav>
          </div>

          {/* Footer branding */}
          <div className="p-5 [@media(max-height:800px)]:p-3 border-t border-white/20 bg-white/10 flex items-center gap-3 shrink-0">
            <div className="w-8 h-8 rounded-full bg-white/20 border border-white/30 flex items-center justify-center text-white font-black text-xs uppercase">
              {role === "admin" ? "A" : "S"}
            </div>
            <div>
              <span className="text-xs font-bold text-white block uppercase tracking-wider">
                {role === "admin" ? "Admin Access" : "Staff Access"}
              </span>
              <span className="text-[9px] text-white/80 font-bold tracking-wider block">
                V2.1.0 • PREMIUM POS
              </span>
            </div>
          </div>
        </div>
      </aside>
      {/* Main Content Area */}
      <main
        ref={mainScrollRef}
        className="flex-1 h-screen overflow-y-auto overflow-x-hidden min-w-0 px-3 sm:px-8 lg:px-12 pt-3 pb-8 relative flex flex-col animate-in fade-in duration-300"
      >
        {/* Global Top Navbar */}
        <header className="flex-shrink-0 flex flex-col sm:flex-row justify-between items-start sm:items-center py-4 border-b border-black/10 w-full mb-6 gap-4">
          <div className="flex items-center gap-4">
            {!isSidebarOpen && (
              <button
                onClick={() => setIsSidebarOpen(true)}
                className="w-9 h-9 bg-white border border-black/10 hover:bg-[#FFFFFF]/40 rounded-lg flex items-center justify-center transition-all shadow-sm cursor-pointer"
                title="Open Menu"
              >
                <Menu className="w-4.5 h-4.5 text-[#3F3F46]" />
              </button>
            )}
            <div>
              <h1 className="text-lg font-black text-[#000000] tracking-tight">
                RAJA MOBILES
              </h1>
            </div>
          </div>

          {/* OFFLINE / ONLINE Toggle (only shown when billing tab is active) */}
          {activeTab === "billing" && (
            <div className="flex items-center bg-[#FFFFFF]/60 border border-black/10 rounded-full p-1 shadow-sm">
              <button
                onClick={() => setIsOnline(false)}
                className={`flex items-center gap-2 px-4 py-1.5 rounded-full text-[10px] font-bold tracking-wider transition-all uppercase cursor-pointer ${!isOnline ? "bg-[#27272A] text-[#FFFFFF] shadow-sm" : "text-[#000000] hover:text-[#000000]"}`}
              >
                <span className="w-2 h-2 rounded-full bg-[#27272A]"></span>
                OFFLINE (POS)
              </button>
              <button
                onClick={() => setIsOnline(true)}
                className={`flex items-center gap-2 px-4 py-1.5 rounded-full text-[10px] font-bold tracking-wider transition-all uppercase cursor-pointer ${isOnline ? "bg-[#00A86B] text-[#FFFFFF] shadow-sm" : "text-[#000000] hover:text-[#000000]"}`}
              >
                <span className="w-2 h-2 rounded-full bg-[#00A86B]"></span>
                ONLINE ORDER
              </button>
            </div>
          )}
        </header>

        {/* Bill Generated — shown as a modal over the billing screen (not a new page) */}
        {completedBillData && (
          <div className="fixed inset-0 z-[390] flex items-center justify-center p-2 sm:p-4 bg-black/60 backdrop-blur-sm animate-in fade-in duration-200">
            <div className="flex flex-col gap-4 w-full max-w-[640px] min-w-0 bg-white rounded-2xl shadow-2xl p-4 sm:p-5 max-h-[94vh] overflow-y-auto animate-in zoom-in-95 duration-200">
              {/* Header Bar */}
              <div className="flex justify-between items-center pb-2 border-b border-black/10">
                <div>
                  <div className="flex items-center gap-2">
                    <h1 className="text-xl sm:text-2xl font-black text-[#000000] tracking-tight">
                      Bill Generated
                    </h1>
                    <span
                      className={`text-[9px] font-black uppercase tracking-wider px-2 py-0.5 rounded ${completedBillData.isGst ? "bg-[#4F46E5]/10 text-[#4F46E5]" : "bg-black/5 text-[#111827]"}`}
                    >
                      {completedBillData.isGst ? "GST" : "Non-GST"}
                    </span>
                  </div>
                  <p className="text-[11px] font-mono font-bold text-[#3F3F46] mt-0.5">
                    #{completedBillData.id}
                  </p>
                </div>
                <button
                  onClick={() => setCompletedBillData(null)}
                  className="bg-black hover:bg-black/80 text-white px-3.5 py-1.5 rounded-lg text-[10px] font-extrabold uppercase tracking-wider flex items-center gap-1.5 shadow-sm transition-all cursor-pointer"
                >
                  <Plus className="w-3.5 h-3.5" />
                  New Sale
                </button>
              </div>

              {/* Payment Receipt Card */}
              <div className="bg-white rounded-xl p-4 sm:p-5 border border-black/10 shadow-xs space-y-3">
                <div className="text-[10px] font-extrabold text-gray-400 uppercase tracking-widest border-b border-gray-100 pb-2 flex justify-between items-center gap-2">
                  <span>Payment Receipt</span>
                  <span className="text-[9px] font-black text-[#3F3F46] bg-black/5 px-2 py-0.5 rounded text-right normal-case tracking-normal">
                    {paymentSummary(completedBillData)}
                  </span>
                </div>

                <div className="flex justify-between items-center text-xs">
                  <span className="font-semibold text-gray-600">
                    Grand Total
                  </span>
                  <span className="text-xl font-black text-black">
                    ₹
                    {completedBillData.grandTotal.toLocaleString(undefined, {
                      minimumFractionDigits: 2,
                    })}
                  </span>
                </div>

                <div className="flex justify-between items-center text-xs">
                  <span className="font-semibold text-gray-600">
                    Amount Received
                  </span>
                  <span className="text-sm font-black text-black">
                    ₹
                    {(
                      completedBillData.cashReceived ||
                      completedBillData.grandTotal
                    ).toLocaleString(undefined, { minimumFractionDigits: 2 })}
                  </span>
                </div>

                {/* Balance Returned Box */}
                <div className="bg-[#F4F4F5] border border-[#E4E4E7] rounded-lg p-3 sm:p-3.5 flex justify-between items-center mt-1">
                  <span className="text-xs font-bold text-[#52525B]">
                    Balance Returned
                  </span>
                  <span className="text-base sm:text-lg font-black text-[#52525B]">
                    ₹
                    {Math.max(
                      0,
                      (completedBillData.cashReceived || 0) -
                        completedBillData.grandTotal,
                    ).toLocaleString(undefined, { minimumFractionDigits: 2 })}
                  </span>
                </div>
              </div>

              {/* Action Buttons Bar */}
              <div className="grid grid-cols-1 sm:grid-cols-3 gap-2.5">
                <button
                  onClick={() => window.open(`/invoice/${completedBillData.id}?autoprint=1`, "_blank")}
                  className="bg-white border border-gray-300 hover:bg-gray-50 text-black py-2.5 px-3 rounded-lg font-bold text-[10px] uppercase tracking-wider flex items-center justify-center gap-1.5 shadow-2xs transition-colors cursor-pointer"
                >
                  <Printer className="w-3.5 h-3.5 text-[#3F3F46]" />
                  Print Receipt
                </button>
                <button
                  onClick={() => setActiveInvoiceId(completedBillData.id)}
                  className="bg-white border border-gray-300 hover:bg-gray-50 text-black py-2.5 px-3 rounded-lg font-bold text-[10px] uppercase tracking-wider flex items-center justify-center gap-1.5 shadow-2xs transition-colors cursor-pointer"
                >
                  <Eye className="w-3.5 h-3.5 text-[#3F3F46]" />
                  View
                </button>
                <button
                  onClick={() => resendWhatsApp(completedBillData)}
                  className="bg-[#10B981] hover:bg-[#059669] text-white py-2.5 px-3 rounded-lg font-bold text-[10px] uppercase tracking-wider flex items-center justify-center gap-1.5 shadow-sm transition-colors cursor-pointer"
                >
                  <svg
                    className="w-3.5 h-3.5"
                    viewBox="0 0 24 24"
                    fill="currentColor"
                  >
                    <path d="M17.472 14.382c-.297-.149-1.758-.867-2.03-.967-.273-.099-.471-.148-.67.15-.197.297-.767.966-.94 1.164-.173.199-.347.223-.644.075-.297-.15-1.255-.463-2.39-1.475-.883-.788-1.48-1.761-1.653-2.059-.173-.297-.018-.458.13-.606.134-.133.298-.347.446-.52.149-.174.198-.298.298-.497.099-.198.05-.371-.025-.52-.075-.149-.669-1.612-.916-2.207-.242-.579-.487-.5-.669-.51a12.8 12.8 0 0 0-.57-.012c-.198 0-.52.074-.792.372-.272.297-1.04 1.016-1.04 2.479 0 1.462 1.065 2.875 1.213 3.074.149.198 2.096 3.2 5.077 4.487.709.306 1.262.489 1.694.625.712.227 1.36.195 1.871.118.571-.085 1.758-.719 2.006-1.413.248-.694.248-1.289.173-1.413-.074-.124-.272-.198-.57-.347m-5.421 7.403h-.004a9.87 9.87 0 0 1-5.031-1.378l-.361-.214-3.741.982.998-3.648-.235-.374a9.86 9.86 0 0 1-1.51-5.26c.001-5.45 4.436-9.884 9.888-9.884 2.64 0 5.122 1.03 6.988 2.898a9.825 9.825 0 0 1 2.893 6.994c-.003 5.45-4.437 9.884-9.885 9.884m8.413-18.297A11.815 11.815 0 0 0 12.05 0C5.495 0 .16 5.335.157 11.892c0 2.096.547 4.142 1.588 5.945L.057 24l6.305-1.654a11.882 11.882 0 0 0 5.683 1.448h.005c6.554 0 11.89-5.335 11.893-11.893a11.821 11.821 0 0 0-3.48-8.413Z" />
                  </svg>
                  WhatsApp Invoice
                </button>
                <button
                  onClick={() => setCompletedBillData(null)}
                  className="bg-black hover:bg-black/80 text-white py-2.5 px-3 rounded-lg font-bold text-[10px] uppercase tracking-wider flex items-center justify-center gap-1.5 shadow-sm transition-colors cursor-pointer"
                >
                  <Plus className="w-3.5 h-3.5" />
                  New Sale
                </button>
              </div>

              {/* Items Sold Card */}
              <div className="bg-white rounded-xl p-4 sm:p-5 border border-black/10 shadow-xs space-y-3">
                <div className="text-[10px] font-extrabold text-gray-400 uppercase tracking-widest border-b border-gray-100 pb-2">
                  Items Sold
                </div>

                <div className="space-y-2 max-h-[220px] overflow-y-auto pr-1">
                  {completedBillData.items.map((item, idx) => (
                    <div
                      key={idx}
                      className="flex justify-between items-center text-xs py-1 border-b border-gray-50 last:border-none"
                    >
                      <span className="font-semibold text-black">
                        {item.name}{" "}
                        <span className="text-gray-400 font-bold text-[10px] ml-1">
                          × {item.qty} {item.qty === 1 ? "piece" : "pieces"}
                        </span>
                      </span>
                      <span className="font-bold text-black">
                        ₹
                        {(item.price * item.qty).toLocaleString(undefined, {
                          minimumFractionDigits: 2,
                        })}
                      </span>
                    </div>
                  ))}
                  {(completedBillData.gifts ?? []).map((g, gi) => (
                    <div key={`g-${gi}`} className="flex justify-between items-center text-xs py-1">
                      <span className="font-semibold text-black">{g.name} <span className="text-emerald-700 font-bold text-[10px] ml-1">FREE GIFT</span></span>
                      <span className="font-bold text-emerald-700">FREE</span>
                    </div>
                  ))}
                </div>
              </div>
            </div>
          </div>
        )}

        {activeTab === "billing" && (
            <div className="flex-1 flex flex-col gap-6 max-w-[1400px] min-w-0 mx-auto w-full">
              {/* Subheader Accent Bar and Title */}
              <div className="flex justify-between items-center py-2 border-b border-black/10 w-full">
                <div className="flex items-center gap-4">
                  <span className="w-1.5 h-8 bg-[#3F3F46] rounded-full"></span>
                  <div>
                    <h2 className="text-xl font-black text-[#000000] tracking-tight">
                      POS Billing Panel
                    </h2>
                    <p className="text-[11px] text-[#000000] font-semibold mt-0.5">
                      Quick Invoice generator & database synced checkout
                    </p>
                  </div>
                </div>
              </div>

              {/* Grid Layout */}
              <div className="flex flex-col lg:flex-row gap-8 w-full">
                {/* Left Column */}
                <div className="w-full lg:w-[60%] xl:w-[65%] flex flex-col gap-6 h-auto lg:h-full">
                  {/* Customer Details */}
                  <div className="flex-shrink-0 bg-white border border-black/10 rounded-xl p-4 sm:p-6 shadow-sm hover:shadow-[0_8px_30px_rgb(0,0,0,0.06)] transition-all duration-300 relative overflow-hidden group">
                    <h2 className="text-base font-black flex items-center gap-3 text-[#000000] mb-6 tracking-tight">
                      <User className="w-4 h-4 text-[#3F3F46]" />
                      Customer Details
                    </h2>

                    <div className="grid grid-cols-1 md:grid-cols-3 gap-x-6 gap-y-6">
                      <div>
                        <label className="block text-[10px] font-bold text-[#000000] uppercase tracking-[0.15em] mb-2">
                          Customer Name
                        </label>
                        <input
                          type="text"
                          placeholder="Walk-in Customer"
                          className="w-full bg-[#FFFFFF]/40 border border-black/10 hover:border-black/10 focus:border-[#3F3F46] focus:bg-white rounded-lg px-4 py-2.5 text-[#000000] text-sm font-semibold focus:outline-none transition-colors placeholder:text-[#000000] placeholder:font-normal shadow-sm"
                          value={customerName}
                          onChange={(e) => setCustomerName(e.target.value)}
                        />
                      </div>
                      <div>
                        <label className="block text-[10px] font-bold text-[#000000] uppercase tracking-[0.15em] mb-2">
                          Mobile Number (WhatsApp)
                        </label>
                        <input
                          type="tel"
                          placeholder="Enter 10-digit number"
                          maxLength={10}
                          className="w-full bg-[#FFFFFF]/40 border border-black/10 hover:border-black/10 focus:border-[#3F3F46] focus:bg-white rounded-lg px-4 py-2.5 text-[#000000] text-sm font-semibold focus:outline-none transition-colors placeholder:text-[#000000] placeholder:font-normal shadow-sm"
                          value={customerPhone}
                          onChange={(e) =>
                            setCustomerPhone(
                              e.target.value.replace(/\D/g, "").slice(0, 10),
                            )
                          }
                        />
                      </div>
                      <div>
                        <label className="block text-[10px] font-bold text-[#000000] uppercase tracking-[0.15em] mb-2 flex items-center justify-between">
                          <span className="flex items-center gap-1.5">
                            <Calendar className="w-3.5 h-3.5 text-[#3F3F46]" />
                            Bill Date
                          </span>
                          <span className="text-[9px] text-[#3F3F46] font-extrabold uppercase">
                            Custom / Past
                          </span>
                        </label>
                        <input
                          type="date"
                          max={localDateStr()}
                          className="w-full bg-[#FFFFFF]/40 border border-black/10 hover:border-black/10 focus:border-[#3F3F46] focus:bg-white rounded-lg px-4 py-2.5 text-[#000000] text-sm font-bold focus:outline-none transition-colors cursor-pointer shadow-sm"
                          value={customOrderDate}
                          onChange={(e) => {
                            customDateEditedRef.current = e.target.value !== localDateStr();
                            setCustomOrderDate(e.target.value);
                          }}
                        />
                      </div>
                    </div>
                    <div className="mt-6">
                      <label className="block text-[10px] font-bold text-[#000000] uppercase tracking-[0.15em] mb-2">
                        Customer Address (Optional)
                      </label>
                      <input
                        type="text"
                        placeholder="Enter full address"
                        className="w-full bg-[#FFFFFF]/40 border border-black/10 hover:border-black/10 focus:border-[#3F3F46] focus:bg-white rounded-lg px-4 py-2.5 text-[#000000] text-sm font-semibold focus:outline-none transition-colors placeholder:text-[#000000] placeholder:font-normal shadow-sm"
                        value={customerAddress}
                        onChange={(e) => setCustomerAddress(e.target.value)}
                      />
                    </div>
                  </div>

                  {/* Order Items Ledger */}
                  <div className="flex-1 bg-white border border-black/10 rounded-xl shadow-sm hover:shadow-[0_8px_30px_rgb(0,0,0,0.06)] transition-all duration-300 flex flex-col overflow-visible">
                    <div className="flex-shrink-0 flex flex-col sm:flex-row justify-between items-start sm:items-center px-4 sm:px-6 pt-4 sm:pt-6 pb-2 border-b border-transparent gap-4">
                      <h2 className="text-base font-black flex items-center gap-3 text-[#000000] tracking-tight">
                        <Receipt className="w-4 h-4 text-[#3F3F46]" />
                        Order Items
                      </h2>
                      <div className="flex flex-wrap items-center gap-2 w-full sm:w-auto justify-start sm:justify-end">
                        <button
                          onClick={clearOrder}
                          className="text-[10px] font-bold text-[#000000] bg-[#FFFFFF] hover:bg-[#FFFFFF] border border-black/10 px-4 py-2 rounded-lg uppercase tracking-wider flex items-center gap-1.5 transition-colors cursor-pointer"
                        >
                          <Trash2 className="w-3.5 h-3.5" /> Clear Order
                        </button>
                        <button
                          onClick={() => {
                            setNewCatName("");
                            setNewCatDesc("");
                            setNewCatPrice("");
                            setCatalogTargetRowId(null);
                            setShowCatalogModal(true);
                          }}
                          className="text-[10px] font-bold text-[#000000] bg-[#FFFFFF] hover:bg-[#FFFFFF] border border-black/10 px-4 py-2 rounded-lg uppercase tracking-wider flex items-center gap-1.5 transition-colors cursor-pointer"
                        >
                          <PackagePlus className="w-3.5 h-3.5 text-[#3F3F46]" />{" "}
                          Add To Catalog
                        </button>
                        <button
                          onClick={addItem}
                          className="text-[10px] font-bold text-[#3F3F46] bg-[#3F3F46]/5 hover:bg-[#3F3F46]/10 border border-[#3F3F46]/20 px-4 py-2 rounded-lg uppercase tracking-wider flex items-center gap-1.5 transition-colors cursor-pointer"
                        >
                          <Plus className="w-3.5 h-3.5" /> Add Custom Item
                        </button>
                      </div>
                    </div>

                    <div className="flex-1 px-4 sm:px-6 pb-4 sm:pb-6 overflow-visible">
                      {/* Table Header */}
                      <div className="hidden sm:grid grid-cols-12 gap-4 pb-3 border-b border-black/10 text-[9px] font-black text-[#000000] uppercase tracking-[0.15em] mt-4 mb-2">
                        <div className="col-span-4 pl-2">
                          Item Name / Description
                        </div>
                        <div className="col-span-2 text-center">Price (₹)</div>
                        <div className="col-span-2 text-center">Qty</div>
                        <div className={`col-span-1 text-center transition-all ${applyGST ? "" : "opacity-40 blur-[1px]"}`}>GST</div>
                        <div className="col-span-2 text-right pr-2">Total (₹)</div>
                        <div className="col-span-1"></div>
                      </div>

                      {/* Items List */}
                      <div className="space-y-4 pt-2 overflow-visible">
                        {items.map((item) => (
                          <div
                            key={item.id}
                            className="flex flex-col sm:grid sm:grid-cols-12 gap-3 sm:gap-4 items-stretch sm:items-center group border-b border-transparent pb-4 pt-1 overflow-visible relative"
                          >
                            {/* Item Name / Description Input + Catalog Button */}
                            <div className="col-span-4 relative flex flex-col sm:flex-row items-stretch sm:items-center gap-2 w-full">
                              <input
                                type="text"
                                placeholder="Type custom item name..."
                                className="flex-1 bg-white border border-black/10 focus:border-[#3F3F46] rounded-lg px-4 py-2 text-xs font-semibold text-[#000000] focus:outline-none transition-colors placeholder:text-[#000000] min-w-0"
                                value={item.name}
                                onChange={(e) =>
                                  updateItem(item.id, "name", e.target.value)
                                }
                              />
                              <button
                                onClick={() => {
                                  setActiveCatalogRowId(
                                    activeCatalogRowId === item.id
                                      ? null
                                      : item.id,
                                  );
                                  setCatalogSearch("");
                                }}
                                className="flex items-center justify-center gap-1.5 border border-[#3F3F46]/30 bg-[#3F3F46]/5 text-[#3F3F46] hover:bg-[#3F3F46]/10 px-3 py-2 rounded-lg text-[10px] font-bold transition-colors uppercase tracking-wider shrink-0 cursor-pointer w-full sm:w-auto"
                              >
                                <List className="w-3.5 h-3.5" />
                                Catalog
                              </button>

                              {/* Catalog Dropdown Popover */}
                              {activeCatalogRowId === item.id && (
                                <div className="absolute z-[80] top-full left-0 mt-1 w-full sm:w-80 max-w-[calc(100vw-2.5rem)] bg-[#FFFFFF] border-2 border-black/10 rounded-lg shadow-2xl overflow-hidden animate-in fade-in slide-in-from-top-2 duration-150">
                                  <div className="p-2 border-b border-black/10 bg-[#FFFFFF] space-y-2">
                                    <div className="flex items-center justify-between gap-2">
                                      <input
                                        type="text"
                                        placeholder="Search by IMEI, name or description..."
                                        className="w-full bg-white border border-black/10 focus:border-[#3F3F46] rounded-md px-3 py-1.5 text-xs font-semibold focus:outline-none transition-colors"
                                        value={catalogSearch}
                                        onChange={(e) =>
                                          setCatalogSearch(e.target.value)
                                        }
                                        autoFocus
                                      />
                                      <button
                                        onClick={() =>
                                          setActiveCatalogRowId(null)
                                        }
                                        className="text-[#000000] hover:text-tertiary cursor-pointer"
                                      >
                                        <X className="w-4 h-4" />
                                      </button>
                                    </div>
                                    <select
                                      value={activeCategory}
                                      onChange={(e) =>
                                        setActiveCategory(e.target.value)
                                      }
                                      className="w-full bg-white border border-black/10 focus:border-[#3F3F46] rounded-md px-3 py-1.5 text-xs font-bold text-[#000000] focus:outline-none transition-colors cursor-pointer"
                                    >
                                      <option value="ALL">All categories</option>
                                      {categories.map((c) => (
                                        <option key={c.id} value={c.name}>
                                          {c.name}
                                        </option>
                                      ))}
                                    </select>
                                  </div>
                                  <div className="max-h-48 overflow-y-auto">
                                    {(() => {
                                      const q = catalogSearch.toLowerCase();
                                      // One row per sellable unit: serialized products (phones) are listed
                                      // by IMEI so the IMEI comes first, followed by the description.
                                      // Accessories (no IMEI) stay one row per product.
                                      const rows = catalog.flatMap((c) => {
                                        if (
                                          activeCategory !== "ALL" &&
                                          (c.category || "General") !== activeCategory
                                        )
                                          return [];
                                        const textMatch =
                                          c.name.toLowerCase().includes(q) ||
                                          combineDesc(c.desc, c.desc2)
                                            .toLowerCase()
                                            .includes(q) ||
                                          (c.batchNo || "").toLowerCase().includes(q);
                                        const units = c.availableUnits || [];
                                        if (c.tracksSerial && units.length > 0) {
                                          return units
                                            .filter(
                                              (u) =>
                                                textMatch ||
                                                u.serial.toLowerCase().includes(q),
                                            )
                                            .map((u) => ({ cat: c, unit: u }));
                                        }
                                        return textMatch
                                          ? [{ cat: c, unit: null as ProductUnit | null }]
                                          : [];
                                      });
                                      return rows.length > 0 ? (
                                        rows.map(({ cat: catItem, unit }) => {
                                          const isOutOfStock =
                                            catItem.stockQuantity === 0;
                                          const desc = combineDesc(
                                            catItem.desc,
                                            catItem.desc2,
                                          );
                                          // Price of the batch this IMEI belongs to (falls back to the product price).
                                          const unitPrice = unit
                                            ? Number(
                                                catItem.batches?.find(
                                                  (b) => b.id === unit.batch_id,
                                                )?.selling_price,
                                              ) || catItem.price
                                            : catItem.price;
                                          return (
                                            <div
                                              key={unit ? unit.id : catItem.id}
                                              className={`w-full flex items-center border-b border-black/5 last:border-0 hover:bg-[#F4F4F5] transition-colors ${
                                                isOutOfStock ? "opacity-50" : ""
                                              }`}
                                            >
                                              <button
                                                className={`flex-1 text-left px-4 py-2.5 flex flex-col ${
                                                  isOutOfStock
                                                    ? "cursor-not-allowed"
                                                    : "cursor-pointer"
                                                }`}
                                                onClick={() => {
                                                  if (isOutOfStock) return;
                                                  updateItem(
                                                    item.id,
                                                    "name",
                                                    catItem.name,
                                                  );
                                                  updateItem(
                                                    item.id,
                                                    "desc",
                                                    desc,
                                                  );
                                                  updateItem(
                                                    item.id,
                                                    "product_id",
                                                    catItem.productId ||
                                                      catItem.id,
                                                  );
                                                  // An IMEI row selects that exact unit; a product row
                                                  // clears any prior unit (IMEI is then picked below).
                                                  updateItem(
                                                    item.id,
                                                    "unit_id",
                                                    unit ? unit.id : null,
                                                  );
                                                  updateItem(
                                                    item.id,
                                                    "serial",
                                                    unit ? unit.serial : null,
                                                  );
                                                  updateItem(
                                                    item.id,
                                                    "batch_id",
                                                    unit ? unit.batch_id : null,
                                                  );
                                                  if (catItem.tracksSerial) {
                                                    updateItem(
                                                      item.id,
                                                      "qty",
                                                      1,
                                                    );
                                                  }
                                                  if (unitPrice !== undefined) {
                                                    updateItem(
                                                      item.id,
                                                      "price",
                                                      unitPrice,
                                                    );
                                                  }
                                                  setActiveCatalogRowId(null);
                                                }}
                                              >
                                                {unit ? (
                                                  <>
                                                    {/* IMEI first … */}
                                                    <div className="flex justify-between items-center w-full gap-2">
                                                      <span className="text-xs font-black text-[#000000] font-mono tracking-wide">
                                                        IMEI: {unit.serial}
                                                      </span>
                                                      {unitPrice !== undefined && (
                                                        <span className="text-[10px] font-bold text-[#3F3F46]">
                                                          ₹{unitPrice}
                                                        </span>
                                                      )}
                                                    </div>
                                                    {/* … then the description */}
                                                    <span className="text-[11px] font-bold text-[#000000] mt-0.5">
                                                      {catItem.name}
                                                    </span>
                                                    {desc && (
                                                      <span className="text-[10px] font-semibold uppercase tracking-wider text-[#000000]">
                                                        {desc}
                                                      </span>
                                                    )}
                                                  </>
                                                ) : (
                                                  <>
                                                    <div className="flex justify-between items-center w-full">
                                                      <span className="text-xs font-bold text-[#000000]">
                                                        {catItem.name}
                                                      </span>
                                                      <span
                                                        className={`text-[10px] font-bold ${isOutOfStock ? "text-[#27272A]" : "text-green-600"}`}
                                                      >
                                                        {isOutOfStock
                                                          ? "Out of Stock"
                                                          : `Stock: ${catItem.stockQuantity}`}
                                                      </span>
                                                    </div>
                                                    {desc && (
                                                      <span className="text-[10px] font-semibold uppercase tracking-wider text-[#000000] mt-0.5">
                                                        {desc}
                                                      </span>
                                                    )}
                                                    <div className="flex items-center gap-2 mt-0.5">
                                                      {catItem.price !==
                                                        undefined && (
                                                        <span className="text-[10px] font-bold text-[#3F3F46]">
                                                          ₹{catItem.price}
                                                        </span>
                                                      )}
                                                      {catItem.batchNo && (
                                                        <span className="text-[10px] font-bold text-[#3F3F46]/70">
                                                          • Batch: {catItem.batchNo}
                                                        </span>
                                                      )}
                                                    </div>
                                                  </>
                                                )}
                                              </button>
                                              <div className="flex shrink-0">
                                                <button
                                                  onClick={(e) => {
                                                    e.stopPropagation();
                                                    openEditCatalog(
                                                      catItem,
                                                      item.id,
                                                    );
                                                    setActiveCatalogRowId(null);
                                                  }}
                                                  className="px-3 py-2.5 text-[#000000] hover:text-[#3F3F46] transition-colors cursor-pointer"
                                                  title="Edit item"
                                                >
                                                  <Pencil className="w-4 h-4" />
                                                </button>
                                                <button
                                                  onClick={(e) => {
                                                    e.stopPropagation();
                                                    if (
                                                      window.confirm(
                                                        "Are you sure you want to delete this item from the catalog?",
                                                      )
                                                    ) {
                                                      deleteFromCatalog(
                                                        catItem.id,
                                                      );
                                                    }
                                                  }}
                                                  className="px-3 py-2.5 text-[#000000] hover:text-tertiary transition-colors cursor-pointer"
                                                  title="Delete item"
                                                >
                                                  <Trash2 className="w-4 h-4" />
                                                </button>
                                              </div>
                                            </div>
                                          );
                                        })
                                      ) : (
                                        <div className="px-4 py-4 text-center">
                                          <div className="text-xs text-[#000000] font-semibold mb-2">
                                            No items match "{catalogSearch}"
                                          </div>
                                          <button
                                            onClick={() => {
                                              setNewCatName(catalogSearch);
                                              setCatalogTargetRowId(item.id);
                                              setShowCatalogModal(true);
                                              setActiveCatalogRowId(null);
                                            }}
                                            className="text-[10px] font-bold text-[#3F3F46] bg-[#3F3F46]/10 hover:bg-[#3F3F46]/20 px-3 py-1.5 rounded uppercase tracking-wider transition-colors cursor-pointer"
                                          >
                                            + Add to Catalog
                                          </button>
                                        </div>
                                      );
                                    })()}
                                  </div>
                                </div>
                              )}
                            </div>

                            {/* Price, Qty, and Trash (Grid on mobile to prevent overflow, grid on desktop) */}
                            <div className="col-span-8 grid grid-cols-[minmax(0,1fr)_auto_auto] sm:grid-cols-8 gap-2 sm:gap-4 w-full items-center">
                              {/* Price Input */}
                              <div className="sm:col-span-2 flex items-center gap-1.5 sm:gap-2 sm:block min-w-0 w-full">
                                <span className="text-[10px] font-bold text-[#000000] uppercase sm:hidden shrink-0">
                                  Price:
                                </span>
                                <input
                                  type="number"
                                  className="w-full min-w-0 text-center bg-white border border-black/10 focus:border-[#3F3F46] rounded-lg px-2 sm:px-3 py-2 text-xs font-semibold text-[#000000] focus:outline-none transition-colors"
                                  value={item.price || ""}
                                  onChange={(e) =>
                                    updateItem(
                                      item.id,
                                      "price",
                                      parseFloat(e.target.value) || 0,
                                    )
                                  }
                                  onWheel={(e) => e.currentTarget.blur()}
                                  placeholder="0"
                                />
                              </div>

                              {/* Quantity Counter */}
                              <div className="sm:col-span-2 flex items-center justify-end gap-1.5 sm:gap-2 sm:block shrink-0">
                                <span className="text-[10px] font-bold text-[#000000] uppercase sm:hidden shrink-0">
                                  Qty:
                                </span>
                                <div className="flex items-center border border-black/10 bg-white rounded-lg overflow-hidden h-[36px] max-w-[90px] shrink-0">
                                  <button
                                    className="w-7 h-full flex items-center justify-center text-[#000000] hover:bg-[#FFFFFF] hover:text-tertiary font-bold text-xs transition-colors cursor-pointer"
                                    onClick={() =>
                                      handleQtyChange(item.id, item.qty - 1)
                                    }
                                  >
                                    −
                                  </button>
                                  <span className="flex-1 text-center font-bold text-xs text-[#000000] min-w-[18px]">
                                    {item.qty}
                                  </span>
                                  <button
                                    className="w-7 h-full flex items-center justify-center text-[#000000] hover:bg-[#FFFFFF] hover:text-tertiary font-bold text-xs transition-colors cursor-pointer"
                                    onClick={() =>
                                      handleQtyChange(item.id, item.qty + 1)
                                    }
                                  >
                                    +
                                  </button>
                                </div>
                              </div>

                              {/* Per-product GST: % (left) and ₹ (right), read-only. Blurred + ignored in Non-GST mode. */}
                              <div
                                className={`col-span-3 sm:col-span-1 order-last sm:order-none bg-[#F4F4F5] border border-black/10 rounded-lg px-2 py-2 text-center text-xs font-bold text-[#000000] cursor-not-allowed select-none transition-all ${applyGST ? "" : "opacity-40 blur-[1.5px] pointer-events-none"}`}
                                aria-disabled={!applyGST}
                                title="GST rate (set per product)"
                              >
                                {itemGstRate(item)}%
                              </div>

                              {/* Line total on the right */}
                              <div className="col-span-3 sm:col-span-2 order-last sm:order-none text-right pr-1 select-none">
                                <div className="text-sm font-black text-[#000000]">
                                  ₹{(item.price * item.qty).toLocaleString(undefined, { minimumFractionDigits: 2, maximumFractionDigits: 2 })}
                                </div>
                              </div>

                              {/* Trash Button */}
                              <div className="sm:col-span-1 flex justify-end shrink-0">
                                <button
                                  onClick={() => removeItem(item.id)}
                                  className="text-[#000000] hover:text-[#27272A] hover:bg-[#F4F4F5] p-2 rounded-lg border border-black/10 hover:border-transparent transition-colors flex items-center justify-center cursor-pointer"
                                  title="Remove Item"
                                >
                                  <Trash2 className="w-4 h-4" />
                                </button>
                              </div>
                            </div>

                            {/* IMEI / Serial picker — only for serialized products */}
                            {(() => {
                              const cat = catalog.find(
                                (c) =>
                                  c.productId === item.product_id ||
                                  c.id === item.product_id,
                              );
                              if (!cat?.tracksSerial) return null;
                              const units = cat.availableUnits || [];
                              return (
                                <div className="sm:col-span-12 w-full">
                                  <label className="block text-[10px] font-bold text-[#3F3F46] uppercase tracking-widest mb-1">
                                    IMEI / Serial
                                  </label>
                                  {units.length === 0 ? (
                                    <div className="text-[11px] font-bold text-[#27272A] bg-[#27272A]/10 border border-[#27272A]/20 rounded-lg px-3 py-2">
                                      No units in stock for this product.
                                    </div>
                                  ) : (
                                    <select
                                      value={item.unit_id || ""}
                                      onChange={(e) => {
                                        const u = units.find(
                                          (x) => x.id === e.target.value,
                                        );
                                        updateItem(
                                          item.id,
                                          "unit_id",
                                          u ? u.id : null,
                                        );
                                        updateItem(
                                          item.id,
                                          "serial",
                                          u ? u.serial : null,
                                        );
                                        updateItem(
                                          item.id,
                                          "batch_id",
                                          u ? u.batch_id : null,
                                        );
                                        updateItem(item.id, "qty", 1);
                                      }}
                                      className={`w-full bg-white border rounded-lg px-3 py-2 text-xs font-semibold text-[#000000] focus:outline-none focus:border-[#3F3F46] transition-colors cursor-pointer ${
                                        item.unit_id
                                          ? "border-black/10"
                                          : "border-[#3F3F46]/60"
                                      }`}
                                    >
                                      <option value="">
                                        Select IMEI / serial…
                                      </option>
                                      {units.map((u) => (
                                        <option key={u.id} value={u.id}>
                                          {u.serial}
                                        </option>
                                      ))}
                                    </select>
                                  )}
                                </div>
                              );
                            })()}
                          </div>
                        ))}
                      </div>
                    </div>
                  </div>
                </div>{" "}
                {/* Right Column - Premium Light Order Panel */}
                <div className="w-full lg:w-[40%] xl:w-[35%] flex flex-col shrink-0 bg-white text-[#000000] border border-black/10 rounded-2xl shadow-sm lg:sticky lg:top-28 lg:self-start transition-all duration-500 hover:shadow-[0_8px_30px_rgb(0,0,0,0.06)] hover:-translate-y-1 overflow-hidden group">
                  <div className="p-4 sm:p-6 pb-4 border-b border-black/10 flex justify-between items-center bg-[#FFFFFF]">
                    <h2 className="text-base font-black flex items-center gap-3 text-[#000000] tracking-tight">
                      <ShoppingBag className="w-4 h-4 text-[#3F3F46]" />
                      Current Order
                    </h2>
                    <span
                      className={`flex items-center gap-2 bg-white border border-black/10 px-3 py-1 rounded-full font-bold text-[9px] ${isOnline ? "text-[#00A86B]" : "text-[#27272A]"}`}
                    >
                      <span
                        className={`w-1.5 h-1.5 rounded-full ${isOnline ? "bg-[#00A86B]" : "bg-[#27272A]"}`}
                      ></span>
                      {isOnline ? "ONLINE ORDER" : "OFFLINE (POS)"}
                    </span>
                  </div>

                  <div className="p-4 sm:p-6 space-y-5">
                    {/* Customer Details Box */}
                    <div className="bg-[#FFFFFF]/40 border border-black/10 rounded-xl p-4 space-y-2.5">
                      <div className="flex justify-between items-center text-xs">
                        <span className="text-[#000000] font-semibold">
                          SOURCE
                        </span>
                        <span
                          className={`px-2 py-0.5 rounded text-[9px] font-bold tracking-widest border ${isOnline ? "border-[#00A86B] text-[#00A86B] bg-[#00A86B]/10" : "border-[#27272A] text-[#27272A] bg-[#27272A]/10"}`}
                        >
                          {isOnline ? "ONLINE" : "OFFLINE"}
                        </span>
                      </div>
                      <div className="flex justify-between items-center text-xs">
                        <span className="text-[#000000] font-semibold">
                          CUSTOMER
                        </span>
                        <span className="font-bold text-[#000000] truncate max-w-[65%] text-right">
                          {customerName || "-"}
                        </span>
                      </div>
                      <div className="flex justify-between items-center text-xs">
                        <span className="text-[#000000] font-semibold">
                          PHONE
                        </span>
                        <span className="font-bold text-[#000000]">
                          {customerPhone || "-"}
                        </span>
                      </div>

                      {/* Items summary list inside customer details box */}
                      <div className="border-t border-black/10 pt-2.5 mt-2.5">
                        {items.filter((i) => i.name).length === 0 ? (
                          <div className="text-center py-2 text-[10px] text-[#000000] font-semibold italic">
                            No items added yet
                          </div>
                        ) : (
                          <div className="max-h-24 overflow-y-auto space-y-1.5 scrollbar-thin pr-1">
                            {items
                              .filter((i) => i.name)
                              .map((item) => (
                                <div
                                  key={item.id}
                                  className="flex justify-between items-center text-[10px]"
                                >
                                  <span className="text-[#000000] font-semibold">
                                    {item.qty}x {item.name}
                                  </span>
                                  <span className="font-bold text-[#3F3F46]">
                                    ₹
                                    {(item.price * item.qty).toLocaleString(
                                      undefined,
                                      { minimumFractionDigits: 2 },
                                    )}
                                  </span>
                                </div>
                              ))}
                          </div>
                        )}
                      </div>
                    </div>

                    {/* Discounts section */}
                    <div className="space-y-4 pt-1">
                      {/* Manual Discount */}
                      <div>
                        <label className="block text-[10px] font-bold text-[#000000] uppercase tracking-[0.1em] mb-1.5">
                          Manual Discount
                        </label>
                        <div className="flex gap-2">
                          <select
                            value={discountType}
                            onChange={(e) => {
                              setDiscountType(
                                e.target.value as "fixed" | "percent",
                              );
                              setSelectedCoupon("none");
                            }}
                            className="bg-white border border-black/10 text-[#000000] rounded-lg px-3 py-2 text-xs font-bold focus:outline-none focus:border-[#3F3F46] cursor-pointer"
                          >
                            <option value="fixed">₹</option>
                            <option value="percent">%</option>
                          </select>
                          <input
                            type="number"
                            className="flex-1 text-right bg-white border border-black/10 rounded-lg px-3 py-2 text-xs font-bold text-[#000000] placeholder:text-[#000000] focus:outline-none focus:border-[#3F3F46] [appearance:textfield] [&::-webkit-outer-spin-button]:appearance-none [&::-webkit-inner-spin-button]:appearance-none min-w-0"
                            value={discountValue || ""}
                            onWheel={(e) => e.currentTarget.blur()}
                            onChange={(e) => {
                              setDiscountValue(parseFloat(e.target.value) || 0);
                              setSelectedCoupon("none");
                            }}
                            placeholder="0"
                          />
                        </div>
                      </div>

                      {/* Subtotal & Delivery Breakdown */}
                      <div className="space-y-2.5 pt-2 border-t border-black/10">
                        <div className="flex justify-between items-center text-xs font-semibold">
                          <span className="text-[#000000]">
                            Subtotal (
                            {items
                              .filter((i) => i.name)
                              .reduce((sum, i) => sum + i.qty, 0)}{" "}
                            items)
                          </span>
                          <span className="font-bold text-[#000000]">
                            ₹
                            {subtotal.toLocaleString(undefined, {
                              minimumFractionDigits: 2,
                            })}
                          </span>
                        </div>

                        <div className="flex justify-between items-center text-xs font-semibold">
                          <span className="text-[#000000]">Delivery</span>
                          <input
                            type="number"
                            className="w-20 text-right bg-white border border-black/10 rounded-lg px-2.5 py-1.5 text-xs font-bold text-[#000000] placeholder:text-[#000000] focus:outline-none focus:border-[#3F3F46]"
                            value={deliveryFee || ""}
                            onWheel={(e) => e.currentTarget.blur()}
                            onChange={(e) =>
                              setDeliveryFee(parseFloat(e.target.value) || 0)
                            }
                            placeholder="0"
                          />
                        </div>

                        {/* Bill Type: GST Invoice vs Non-GST Bill */}
                        <div className="pt-2 space-y-2.5">
                          <div className="flex items-center bg-[#FFFFFF] border border-black/10 rounded-full p-1 w-full">
                            <button
                              type="button"
                              onClick={() => setGstBill(false)}
                              className={`flex-1 py-1.5 rounded-full text-[10px] font-bold tracking-wider uppercase transition-all cursor-pointer ${!applyGST ? "bg-[#111827] text-white shadow-sm" : "text-[#000000]"}`}
                            >
                              Non-GST Bill
                            </button>
                            <button
                              type="button"
                              onClick={() => setGstBill(true)}
                              className={`flex-1 py-1.5 rounded-full text-[10px] font-bold tracking-wider uppercase transition-all cursor-pointer ${applyGST ? "bg-[#3F3F46] text-white shadow-sm" : "text-[#000000]"}`}
                            >
                              GST Invoice
                            </button>
                          </div>
                        </div>
                      </div>

                      {/* Financial Option — payment method / EMI provider */}
                      <div className="pt-2 space-y-1.5">
                        <div className="flex items-center justify-between">
                          <span className="block text-[9px] font-bold text-[#000000] uppercase tracking-wider">
                            Financial Option
                          </span>
                          <button
                            type="button"
                            onClick={() => setIsSplitPayment((v) => !v)}
                            className={`text-[9px] font-bold uppercase tracking-wider px-2.5 py-1 rounded-md border transition-all cursor-pointer ${
                              isSplitPayment
                                ? "bg-[#3F3F46] text-white border-[#3F3F46]"
                                : "bg-white text-[#3F3F46] border-[#3F3F46]/40 hover:border-[#3F3F46]"
                            }`}
                          >
                            {isSplitPayment ? "✕ Split On" : "⇄ Split Payment"}
                          </button>
                        </div>

                        {!isSplitPayment ? (
                          <div className="grid grid-cols-3 gap-1.5">
                            {ORDER_PAYMENT_MODES.map((mode) => (
                              <button
                                key={mode}
                                type="button"
                                onClick={() => setPaymentMode(mode)}
                                className={`py-1.5 rounded-lg text-[10px] font-bold tracking-wider uppercase transition-all cursor-pointer border ${
                                  paymentMode === mode
                                    ? "bg-[#3F3F46] text-white border-[#3F3F46] shadow-sm"
                                    : "bg-white text-[#000000] border-black/10 hover:border-[#3F3F46]"
                                }`}
                              >
                                {mode}
                              </button>
                            ))}
                          </div>
                        ) : (
                          <div className="bg-white border border-black/10 rounded-2xl p-4 space-y-3">
                            <div className="text-[10px] font-black text-black uppercase tracking-widest">
                              Split Payment
                            </div>
                            <div className="grid grid-cols-2 gap-3">
                              {([
                                { mode: splitMode1, setMode: setSplitMode1, amt: splitAmount1, setAmt: setSplitAmount1 },
                                { mode: splitMode2, setMode: setSplitMode2, amt: splitAmount2, setAmt: setSplitAmount2 },
                              ] as const).map((f, idx) => (
                                <div key={idx} className="min-w-0">
                                  <div className="relative mb-1.5">
                                    <select
                                      value={f.mode}
                                      onChange={(e) => f.setMode(e.target.value as OrderPaymentMode)}
                                      className="w-full appearance-none bg-[#F4F4F5] hover:bg-[#EDEDEF] border border-black/10 rounded-lg pl-3 pr-8 py-2 text-xs font-black text-black focus:outline-none focus:border-[#3F3F46] cursor-pointer"
                                    >
                                      {ORDER_PAYMENT_MODES.map((m) => (
                                        <option
                                          key={m}
                                          value={m}
                                          disabled={m === (idx === 0 ? splitMode2 : splitMode1)}
                                        >
                                          {m === "CASH" ? "Cash" : m === "GPAY" ? "GPay" : m} (₹)
                                        </option>
                                      ))}
                                    </select>
                                    <ChevronDown className="pointer-events-none absolute right-2.5 top-1/2 -translate-y-1/2 w-3.5 h-3.5 text-[#3F3F46]" />
                                  </div>
                                  <input
                                    type="number"
                                    min={0}
                                    value={f.amt}
                                    onWheel={(e) => e.currentTarget.blur()}
                                    onChange={(e) => f.setAmt(e.target.value === "" ? "" : parseFloat(e.target.value))}
                                    placeholder="0.00"
                                    className="w-full bg-white border border-black/10 rounded-xl px-3 py-2.5 text-lg font-black text-black focus:outline-none focus:border-[#3F3F46]"
                                  />
                                </div>
                              ))}
                            </div>
                            {(() => {
                              const received = (Number(splitAmount1) || 0) + (Number(splitAmount2) || 0);
                              const remaining = grandTotal - received;
                              const balanced = Math.abs(remaining) < 0.01;
                              const fmt = (n: number) =>
                                `₹${Math.abs(n).toLocaleString(undefined, { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`;
                              return (
                                <div className="border-t border-black/10 pt-3 space-y-2">
                                  <div className="flex justify-between items-center">
                                    <span className="text-xs font-black uppercase tracking-wider text-black">Total Received</span>
                                    <span className="text-base font-black text-[#3F5F7F]">{fmt(received)}</span>
                                  </div>
                                  <div className="flex justify-between items-center">
                                    <span className="text-xs font-black uppercase tracking-wider text-black">
                                      {remaining < -0.01 ? "Over By" : "Balance Remaining"}
                                    </span>
                                    <span className={`text-base font-black ${balanced ? "text-[#16A34A]" : "text-[#DC2626]"}`}>
                                      {balanced ? "✓ ₹0.00" : fmt(remaining)}
                                    </span>
                                  </div>
                                </div>
                              );
                            })()}
                          </div>
                        )}
                      </div>

                      {/* Free Gift — this bill only; price is NOT part of totals or analytics */}
                      <div className="pt-2 space-y-1.5">
                        <div className="flex items-center justify-between">
                          <span className="block text-[9px] font-bold text-[#000000] uppercase tracking-wider">
                            Free Gift (not billed)
                          </span>
                          <button
                            type="button"
                            onClick={() => setFreeGifts((prev) => [...prev, { name: "", price: 0 }])}
                            className="text-[10px] font-bold uppercase text-[#3F3F46] cursor-pointer hover:underline"
                          >
                            + Add
                          </button>
                        </div>
                        {freeGifts.map((g, gi) => (
                          <div key={gi} className="flex gap-1.5">
                            <input
                              type="text"
                              value={g.name}
                              onChange={(e) =>
                                setFreeGifts((prev) => prev.map((x, i) => (i === gi ? { ...x, name: e.target.value } : x)))
                              }
                              placeholder="Gift name"
                              className="flex-1 min-w-0 px-2 py-1.5 rounded-lg border border-black/10 text-[11px] bg-white"
                            />
                            <input
                              type="number"
                              min={0}
                              value={g.price || ""}
                              onChange={(e) =>
                                setFreeGifts((prev) =>
                                  prev.map((x, i) => (i === gi ? { ...x, price: parseFloat(e.target.value) || 0 } : x)),
                                )
                              }
                              placeholder="Price"
                              className="w-20 px-2 py-1.5 rounded-lg border border-black/10 text-[11px] bg-white"
                            />
                            <button
                              type="button"
                              title="Remove gift"
                              onClick={() => setFreeGifts((prev) => prev.filter((_, i) => i !== gi))}
                              className="px-2 text-sm font-bold text-[#DC2626] cursor-pointer"
                            >
                              ×
                            </button>
                          </div>
                        ))}
                      </div>

                      {/* Grand Total */}
                      <div className="flex justify-between items-center text-sm font-bold pt-4 border-t border-black/10">
                        <span className="text-[#000000] uppercase tracking-wider">
                          Grand Total
                        </span>
                        <span className="text-xl text-[#3F3F46] font-black">
                          ₹
                          {grandTotal.toLocaleString(undefined, {
                            minimumFractionDigits: 2,
                          })}
                        </span>
                      </div>

                      {/* Cash / Finance Amount Received — hidden during split (amounts entered above) */}
                      {!isSplitPayment && (
                      <div className="bg-[#FFFFFF]/40 border border-black/10 rounded-xl p-4 mt-2">
                        <span className="block text-[9px] font-bold text-[#000000] uppercase tracking-wider mb-0.5">
                          {paymentMode === "CASH" ? "Cash Payment" : paymentMode === "GPAY" ? "GPay Payment" : `${paymentMode} Finance`}
                        </span>
                        <label className="block text-[10px] font-bold text-[#000000] mb-2.5">
                          Amount Received (₹)
                        </label>
                        <input
                          type="number"
                          className="w-full bg-white border border-black/10 focus:border-[#3F3F46] rounded-lg px-3 py-2 text-base font-bold text-[#000000] placeholder:text-[#000000] focus:outline-none transition-colors"
                          value={cashReceived || ""}
                          onWheel={(e) => e.currentTarget.blur()}
                          onChange={(e) =>
                            setCashReceived(parseFloat(e.target.value) || 0)
                          }
                          placeholder="0.00"
                        />
                      </div>
                      )}

                      {/* Change Return */}
                      {!isSplitPayment && cashReceived > 0 && (
                        <div className="flex justify-between items-center bg-white border border-black/10 rounded-lg p-3 text-xs">
                          <span className="font-bold text-[#000000] uppercase tracking-[0.05em]">
                            Change Return
                          </span>
                          <span
                            className={`font-black text-sm ${cashReceived >= grandTotal ? "text-[#00A86B]" : "text-[#27272A]"}`}
                          >
                            ₹
                            {Math.max(
                              0,
                              cashReceived - grandTotal,
                            ).toLocaleString(undefined, {
                              minimumFractionDigits: 2,
                            })}
                          </span>
                        </div>
                      )}

                      {/* Complete Sale — saves the order to the database */}
                      <button
                        onClick={() => completeSale()}
                        disabled={isSubmittingOrder}
                        className={`w-full mt-2 bg-[#3F3F46] hover:bg-[#27272A] text-white py-3 rounded-lg font-black text-[11px] uppercase tracking-[0.1em] flex items-center justify-center gap-2 transition-all active:scale-[0.98] shadow-[0_4px_14px_rgba(63,63,70,0.35)] ${
                          isSubmittingOrder
                            ? "opacity-60 cursor-not-allowed"
                            : "cursor-pointer"
                        }`}
                      >
                        {isSubmittingOrder ? (
                          <>
                            <Loader2 className="w-4 h-4 animate-spin" />
                            <span>Processing Sale...</span>
                          </>
                        ) : (
                          <>
                            <Check className="w-4 h-4" />
                            <span>Complete Sale</span>
                          </>
                        )}
                      </button>

                      {/* Save as Advance Order — partial payment hold, not counted as revenue */}
                      <button
                        onClick={openAdvanceSaveModal}
                        disabled={isSubmittingOrder}
                        className={`w-full mt-2 bg-white border-2 border-[#F59E0B] hover:bg-[#FEF3C7] text-[#B45309] py-3 rounded-lg font-black text-[10px] uppercase tracking-[0.1em] flex items-center justify-center gap-2 transition-all active:scale-[0.98] ${
                          isSubmittingOrder ? "opacity-60 cursor-not-allowed" : "cursor-pointer"
                        }`}
                      >
                        <Clock className="w-4 h-4" />
                        <span>Save as Advance Order</span>
                      </button>

                      {/* Send Bill Button — completes/saves the sale, then shares it via WhatsApp */}
                      <button
                        onClick={handleCompleteAndSendWhatsApp}
                        disabled={isSubmittingOrder}
                        className={`w-full mt-2 bg-[#10B981] hover:bg-[#059669] text-white py-3 rounded-lg font-bold text-[10px] uppercase tracking-[0.1em] flex items-center justify-center gap-2 transition-all active:scale-[0.98] shadow-[0_4px_14px_rgba(16,185,129,0.4)] ${
                          isSubmittingOrder
                            ? "opacity-60 cursor-not-allowed"
                            : "cursor-pointer"
                        }`}
                      >
                        {isSubmittingOrder ? (
                          <>
                            <Loader2 className="w-4 h-4 animate-spin" />
                            <span>Processing & Opening WhatsApp...</span>
                          </>
                        ) : (
                          <>
                            <svg
                              className="w-3.5 h-3.5"
                              viewBox="0 0 24 24"
                              fill="currentColor"
                            >
                              <path d="M17.472 14.382c-.297-.149-1.758-.867-2.03-.967-.273-.099-.471-.148-.67.15-.197.297-.767.966-.94 1.164-.173.199-.347.223-.644.075-.297-.15-1.255-.463-2.39-1.475-.883-.788-1.48-1.761-1.653-2.059-.173-.297-.018-.458.13-.606.134-.133.298-.347.446-.52.149-.174.198-.298.298-.497.099-.198.05-.371-.025-.52-.075-.149-.669-1.612-.916-2.207-.242-.579-.487-.5-.669-.51a12.8 12.8 0 0 0-.57-.012c-.198 0-.52.074-.792.372-.272.297-1.04 1.016-1.04 2.479 0 1.462 1.065 2.875 1.213 3.074.149.198 2.096 3.2 5.077 4.487.709.306 1.262.489 1.694.625.712.227 1.36.195 1.871.118.571-.085 1.758-.719 2.006-1.413.248-.694.248-1.289.173-1.413-.074-.124-.272-.198-.57-.347m-5.421 7.403h-.004a9.87 9.87 0 0 1-5.031-1.378l-.361-.214-3.741.982.998-3.648-.235-.374a9.86 9.86 0 0 1-1.51-5.26c.001-5.45 4.436-9.884 9.888-9.884 2.64 0 5.122 1.03 6.988 2.898a9.825 9.825 0 0 1 2.893 6.994c-.003 5.45-4.437 9.884-9.885 9.884m8.413-18.297A11.815 11.815 0 0 0 12.05 0C5.495 0 .16 5.335.157 11.892c0 2.096.547 4.142 1.588 5.945L.057 24l6.305-1.654a11.882 11.882 0 0 0 5.683 1.448h.005c6.554 0 11.89-5.335 11.893-11.893a11.821 11.821 0 0 0-3.48-8.413Z" />
                            </svg>
                            <span>Send Bill Via WhatsApp</span>
                          </>
                        )}
                      </button>
                    </div>
                  </div>
                </div>
              </div>
            </div>
          )}

        {/* ── Advance Order Saved — confirmation receipt (image-2 style) ─── */}
        {activeTab === "billing" && savedAdvanceData && (
          <div className="fixed inset-0 z-[395] flex items-center justify-center p-3 sm:p-4 bg-black/60 backdrop-blur-sm animate-in fade-in duration-200">
            <div className="w-full max-w-md bg-white rounded-2xl shadow-2xl p-5 sm:p-6 max-h-[94vh] overflow-y-auto animate-in zoom-in-95 duration-200">
              {/* Header */}
              <div className="flex justify-between items-start pb-3 border-b border-black/10">
                <div>
                  <div className="flex items-center gap-2 flex-wrap">
                    <h1 className="text-xl sm:text-2xl font-black text-[#000000] tracking-tight">
                      Advance Order Saved
                    </h1>
                    <span className="text-[9px] font-black uppercase tracking-wider px-2 py-0.5 rounded bg-[#FEF3C7] text-[#92400E]">
                      Deposit
                    </span>
                  </div>
                  <p className="text-[11px] font-mono font-bold text-[#3F3F46] mt-1">
                    #{savedAdvanceData.id}
                  </p>
                </div>
                <button
                  onClick={() => setSavedAdvanceData(null)}
                  className="flex items-center gap-1.5 bg-[#000000] hover:bg-[#27272A] text-white px-3 py-2 rounded-lg text-[10px] font-black uppercase tracking-wider transition-colors cursor-pointer shrink-0"
                >
                  <Plus className="w-3.5 h-3.5" /> New Sale
                </button>
              </div>

              {/* Receipt card */}
              <div className="mt-4 border border-black/10 rounded-xl p-4 space-y-3">
                <div className="text-[10px] font-extrabold text-gray-400 uppercase tracking-widest border-b border-gray-100 pb-2">
                  Advance Receipt — Deposit via {savedAdvanceData.depositMode}
                </div>
                <div className="flex justify-between items-center text-xs">
                  <span className="font-semibold text-gray-600">Order Total</span>
                  <span className="text-xl font-black text-black">
                    {money(savedAdvanceData.orderTotal)}
                  </span>
                </div>
                <div className="flex justify-between items-center text-xs">
                  <span className="font-semibold text-gray-600">Deposit Paid</span>
                  <span className="text-sm font-black text-[#16A34A]">
                    {money(savedAdvanceData.depositPaid)}
                  </span>
                </div>
                <div className="bg-[#FEE2E2] border border-[#FCA5A5]/50 rounded-lg p-3.5 flex justify-between items-center mt-1">
                  <span className="text-xs font-bold text-[#991B1B]">Balance Due</span>
                  <span className="text-base sm:text-lg font-black text-[#991B1B]">
                    {money(savedAdvanceData.balanceDue)}
                  </span>
                </div>
                {savedAdvanceData.deliveryDate && (
                  <div className="flex items-center gap-1.5 text-[11px] font-bold text-[#52525B] pt-0.5">
                    <Clock className="w-3.5 h-3.5 text-[#3F3F46]" />
                    Expected delivery:{" "}
                    {new Date(savedAdvanceData.deliveryDate).toLocaleDateString("en-IN", {
                      day: "2-digit",
                      month: "short",
                      year: "numeric",
                    })}
                  </div>
                )}
              </div>

              {/* Actions */}
              <div className="grid grid-cols-1 sm:grid-cols-3 gap-2.5 mt-4">
                <button
                  onClick={() => printAdvanceReceipt(savedAdvanceData)}
                  className="bg-white border border-gray-300 hover:bg-gray-50 text-black py-2.5 px-3 rounded-lg font-bold text-[10px] uppercase tracking-wider flex items-center justify-center gap-1.5 shadow-2xs transition-colors cursor-pointer"
                >
                  <Printer className="w-3.5 h-3.5 text-[#3F3F46]" /> Print Receipt
                </button>
                <button
                  onClick={() => advanceReceiptWhatsApp(savedAdvanceData)}
                  className="bg-[#10B981] hover:bg-[#059669] text-white py-2.5 px-3 rounded-lg font-bold text-[10px] uppercase tracking-wider flex items-center justify-center gap-1.5 shadow-sm transition-colors cursor-pointer"
                >
                  <svg className="w-3.5 h-3.5" viewBox="0 0 24 24" fill="currentColor">
                    <path d="M17.472 14.382c-.297-.149-1.758-.867-2.03-.967-.273-.099-.471-.148-.67.15-.197.297-.767.966-.94 1.164-.173.199-.347.223-.644.075-.297-.15-1.255-.463-2.39-1.475-.883-.788-1.48-1.761-1.653-2.059-.173-.297-.018-.458.13-.606.134-.133.298-.347.446-.52.149-.174.198-.298.298-.497.099-.198.05-.371-.025-.52-.075-.149-.669-1.612-.916-2.207-.242-.579-.487-.5-.669-.51a12.8 12.8 0 0 0-.57-.012c-.198 0-.52.074-.792.372-.272.297-1.04 1.016-1.04 2.479 0 1.462 1.065 2.875 1.213 3.074.149.198 2.096 3.2 5.077 4.487.709.306 1.262.489 1.694.625.712.227 1.36.195 1.871.118.571-.085 1.758-.719 2.006-1.413.248-.694.248-1.289.173-1.413-.074-.124-.272-.198-.57-.347m-5.421 7.403h-.004a9.87 9.87 0 0 1-5.031-1.378l-.361-.214-3.741.982.998-3.648-.235-.374a9.86 9.86 0 0 1-1.51-5.26c.001-5.45 4.436-9.884 9.888-9.884 2.64 0 5.122 1.03 6.988 2.898a9.825 9.825 0 0 1 2.893 6.994c-.003 5.45-4.437 9.884-9.885 9.884m8.413-18.297A11.815 11.815 0 0 0 12.05 0C5.495 0 .16 5.335.157 11.892c0 2.096.547 4.142 1.588 5.945L.057 24l6.305-1.654a11.882 11.882 0 0 0 5.683 1.448h.005c6.554 0 11.89-5.335 11.893-11.893a11.821 11.821 0 0 0-3.48-8.413Z" />
                  </svg>
                  WhatsApp
                </button>
                <button
                  onClick={() => {
                    setSavedAdvanceData(null);
                    setActiveTab("advance");
                  }}
                  className="bg-[#000000] hover:bg-[#27272A] text-white py-2.5 px-3 rounded-lg font-bold text-[10px] uppercase tracking-wider flex items-center justify-center gap-1.5 shadow-sm transition-colors cursor-pointer"
                >
                  <Package className="w-3.5 h-3.5" /> View Advance
                </button>
              </div>
            </div>
          </div>
        )}

        {/* ── Save-as-Advance modal (opens from billing) ─────────── */}
        {showAdvanceSaveModal && (
          <div className="fixed inset-0 z-[400] flex items-center justify-center p-3 bg-black/60 backdrop-blur-sm animate-in fade-in duration-200">
            <div className="bg-white rounded-2xl shadow-2xl w-full max-w-md p-5 animate-in zoom-in-95 duration-200">
              <div className="flex justify-between items-center pb-3 border-b border-black/10">
                <div>
                  <h3 className="text-lg font-black text-[#000000] tracking-tight">Save as Advance Order</h3>
                  <p className="text-[10px] font-bold text-[#B45309] mt-0.5 uppercase tracking-wider">Not counted as revenue until fully paid</p>
                </div>
                <button onClick={() => setShowAdvanceSaveModal(false)} className="text-black hover:bg-black/5 w-7 h-7 rounded-lg flex items-center justify-center cursor-pointer">
                  <X className="w-4 h-4" />
                </button>
              </div>

              <div className="mt-4 space-y-4">
                <div className="bg-[#FEF3C7] border border-[#F59E0B]/40 rounded-lg p-3">
                  <div className="flex justify-between text-[10px] font-bold text-[#78350F] uppercase tracking-wider">
                    <span>Order Total</span>
                    <span>₹{grandTotal.toLocaleString(undefined, { minimumFractionDigits: 2 })}</span>
                  </div>
                </div>

                <div>
                  <label className="block text-[10px] font-bold text-[#000000] uppercase tracking-wider mb-1.5">Deposit Amount (₹) *</label>
                  <input
                    type="number"
                    value={advDeposit}
                    onChange={(e) => setAdvDeposit(e.target.value === "" ? "" : parseFloat(e.target.value))}
                    onWheel={(e) => e.currentTarget.blur()}
                    className="w-full bg-white border border-black/15 focus:border-[#F59E0B] rounded-lg px-3 py-2.5 text-sm font-bold text-black focus:outline-none"
                    placeholder="0.00"
                    autoFocus
                  />
                  {typeof advDeposit === "number" && advDeposit > 0 && (
                    <p className="mt-1.5 text-[10px] font-bold text-[#52525B]">
                      Balance due: ₹{Math.max(0, grandTotal - Number(advDeposit)).toLocaleString(undefined, { minimumFractionDigits: 2 })}
                    </p>
                  )}
                </div>

                <div>
                  <label className="block text-[10px] font-bold text-[#000000] uppercase tracking-wider mb-1.5">Deposit Payment Mode</label>
                  <div className="grid grid-cols-3 gap-1.5">
                    {ORDER_PAYMENT_MODES.map((mode) => (
                      <button
                        key={mode}
                        onClick={() => setAdvDepositPaymentMode(mode)}
                        className={`py-1.5 rounded-lg text-[10px] font-bold uppercase tracking-wider border transition-all cursor-pointer ${
                          advDepositPaymentMode === mode ? "bg-[#3F3F46] text-white border-[#3F3F46]" : "bg-white text-black border-black/10 hover:border-[#3F3F46]"
                        }`}
                      >
                        {mode}
                      </button>
                    ))}
                  </div>
                </div>

                <div>
                  <label className="block text-[10px] font-bold text-[#000000] uppercase tracking-wider mb-1.5">Expected Delivery Date</label>
                  <input
                    type="date"
                    value={advDeliveryDate}
                    onChange={(e) => setAdvDeliveryDate(e.target.value)}
                    className="w-full bg-white border border-black/15 focus:border-[#F59E0B] rounded-lg px-3 py-2 text-sm font-bold text-black focus:outline-none"
                  />
                </div>

                <div>
                  <label className="block text-[10px] font-bold text-[#000000] uppercase tracking-wider mb-1.5">Notes (Optional)</label>
                  <textarea
                    value={advNotes}
                    onChange={(e) => setAdvNotes(e.target.value)}
                    className="w-full bg-white border border-black/15 focus:border-[#F59E0B] rounded-lg px-3 py-2 text-sm text-black focus:outline-none min-h-[60px] resize-none"
                    placeholder="e.g. Colour preference, follow-up needed..."
                  />
                </div>

                <button
                  onClick={saveAdvanceOrder}
                  disabled={isSavingAdvance}
                  className={`w-full py-3 rounded-lg font-black text-[11px] uppercase tracking-[0.1em] flex items-center justify-center gap-2 bg-[#F59E0B] hover:bg-[#D97706] text-white shadow-md transition-all ${
                    isSavingAdvance ? "opacity-60 cursor-not-allowed" : "cursor-pointer"
                  }`}
                >
                  {isSavingAdvance ? (<><Loader2 className="w-4 h-4 animate-spin" /><span>Saving...</span></>) : (<><Clock className="w-4 h-4" /><span>Confirm Advance Order</span></>)}
                </button>
              </div>
            </div>
          </div>
        )}

        {/* ── Advance Order VIEW / RECEIVE-BALANCE dialog ────────── */}
        {selectedAdvance && advanceViewMode && (
          <div className="fixed inset-0 z-[400] flex items-center justify-center p-3 bg-black/60 backdrop-blur-sm animate-in fade-in duration-200">
            <div className="bg-white rounded-2xl shadow-2xl w-full max-w-lg p-5 max-h-[92vh] overflow-y-auto animate-in zoom-in-95 duration-200">
              <div className="flex justify-between items-center pb-3 border-b border-black/10">
                <div>
                  <p className="text-[11px] font-mono font-bold text-[#3F3F46]">{selectedAdvance.id}</p>
                  <h3 className="text-lg font-black text-[#000000] tracking-tight">
                    {advanceViewMode === "receive" ? "Receive Remaining Payment" : "Advance Order Details"}
                  </h3>
                </div>
                <button onClick={closeAdvanceDialog} className="text-black hover:bg-black/5 w-7 h-7 rounded-lg flex items-center justify-center cursor-pointer">
                  <X className="w-4 h-4" />
                </button>
              </div>

              {/* Customer + Items summary (both modes) */}
              <div className="mt-4 space-y-3">
                <div className="bg-[#F9FAFB] border border-black/10 rounded-lg p-3">
                  <p className="text-[10px] font-bold uppercase tracking-wider text-[#52525B]">Customer</p>
                  <p className="text-sm font-black text-black">{selectedAdvance.customer_name}</p>
                  <p className="text-[11px] font-bold text-[#52525B]">{selectedAdvance.customer_phone}</p>
                  {selectedAdvance.customer_address && (
                    <p className="text-[11px] text-[#52525B] mt-0.5">{selectedAdvance.customer_address}</p>
                  )}
                </div>

                <div className="border border-black/10 rounded-lg divide-y divide-black/5">
                  {selectedAdvance.items.map((it) => (
                    <div key={it.id} className="flex justify-between items-center p-2.5 text-xs">
                      <div>
                        <p className="font-bold text-black">{it.snapshot_name}</p>
                        <p className="text-[10px] text-[#52525B]">Qty: {it.quantity} × ₹{Number(it.snapshot_price).toLocaleString(undefined, { minimumFractionDigits: 2 })}</p>
                      </div>
                      <p className="font-black text-black">₹{(Number(it.snapshot_price) * it.quantity).toLocaleString(undefined, { minimumFractionDigits: 2 })}</p>
                    </div>
                  ))}
                </div>

                {Number(selectedAdvance.discount_amount) > 0 && (
                  <div className="flex justify-between items-center bg-[#FEF3C7] border border-[#F59E0B]/30 rounded-lg px-3 py-2 text-xs font-black text-[#78350F]">
                    <span>
                      Discount applied
                      {selectedAdvance.discount_type === "PERCENT" && Number(selectedAdvance.discount_value) ? ` (${Number(selectedAdvance.discount_value)}%)` : ""}
                    </span>
                    <span>−₹{Number(selectedAdvance.discount_amount).toLocaleString(undefined, { minimumFractionDigits: 2, maximumFractionDigits: 2 })}</span>
                  </div>
                )}

                <div className="grid grid-cols-3 gap-2 text-center">
                  <div className="bg-[#F4F4F5] border border-black/10 rounded-lg p-2.5">
                    <p className="text-[9px] font-bold text-[#52525B] uppercase tracking-wider">Total</p>
                    <p className="text-sm font-black text-black">₹{Number(selectedAdvance.total_amount).toLocaleString(undefined, { minimumFractionDigits: 2 })}</p>
                  </div>
                  <div className="bg-[#DCFCE7] border border-[#16A34A]/30 rounded-lg p-2.5">
                    <p className="text-[9px] font-bold text-[#166534] uppercase tracking-wider">Paid</p>
                    <p className="text-sm font-black text-[#166534]">₹{Number(selectedAdvance.deposit_amount).toLocaleString(undefined, { minimumFractionDigits: 2 })}</p>
                  </div>
                  <div className="bg-[#FEE2E2] border border-[#DC2626]/30 rounded-lg p-2.5">
                    <p className="text-[9px] font-bold text-[#991B1B] uppercase tracking-wider">Balance</p>
                    <p className="text-sm font-black text-[#991B1B]">₹{balanceRemaining(selectedAdvance).toLocaleString(undefined, { minimumFractionDigits: 2 })}</p>
                  </div>
                </div>

                {selectedAdvance.delivery_date && (
                  <p className="text-[11px] font-bold text-[#52525B]"><Calendar className="w-3 h-3 inline mr-1" />Delivery: {new Date(selectedAdvance.delivery_date).toLocaleDateString()}</p>
                )}
                {selectedAdvance.notes && (
                  <div className="bg-[#FEF9C3] border border-[#EAB308]/30 rounded-lg p-2.5 text-[11px] text-[#78350F]">
                    <span className="font-bold">Notes: </span>{selectedAdvance.notes}
                  </div>
                )}

                {/* Receive-payment specific fields */}
                {advanceViewMode === "receive" && selectedAdvance.status !== "COMPLETED" && selectedAdvance.status !== "CANCELLED" && (
                  <div className="pt-3 border-t border-black/10 space-y-3">
                    <div>
                      <label className="block text-[10px] font-bold text-[#000000] uppercase tracking-wider mb-1.5">Payment Method</label>
                      <div className="grid grid-cols-3 gap-1.5">
                        {ORDER_PAYMENT_MODES.map((mode) => (
                          <button
                            key={mode}
                            onClick={() => setReceivePaymentMode(mode)}
                            className={`py-1.5 rounded-lg text-[10px] font-bold uppercase tracking-wider border transition-all cursor-pointer ${
                              receivePaymentMode === mode ? "bg-[#3F3F46] text-white border-[#3F3F46]" : "bg-white text-black border-black/10 hover:border-[#3F3F46]"
                            }`}
                          >
                            {mode}
                          </button>
                        ))}
                      </div>
                    </div>

                    <div className="flex items-center gap-2">
                      <input
                        type="checkbox"
                        id="receiveIsGst"
                        checked={receiveIsGst}
                        onChange={(e) => setReceiveIsGst(e.target.checked)}
                        className="w-4 h-4"
                      />
                      <label htmlFor="receiveIsGst" className="text-xs font-bold text-black">GST Invoice</label>
                      {receiveIsGst && (
                        <input
                          type="number"
                          value={receiveGstPct}
                          onChange={(e) => setReceiveGstPct(parseFloat(e.target.value) || 0)}
                          onWheel={(e) => e.currentTarget.blur()}
                          className="w-16 bg-white border border-black/15 rounded px-2 py-1 text-xs font-bold focus:outline-none"
                        />
                      )}
                      {receiveIsGst && <span className="text-xs font-bold">%</span>}
                    </div>

                    <div className="bg-[#DCFCE7] border border-[#16A34A]/40 rounded-lg p-3 text-center">
                      <p className="text-[10px] font-bold text-[#166534] uppercase tracking-wider">Final Amount to Collect</p>
                      <p className="text-2xl font-black text-[#166534]">₹{receiveBalanceFinalAmount.toLocaleString(undefined, { minimumFractionDigits: 2 })}</p>
                    </div>

                    <p className="text-[10px] font-bold text-[#78350F] bg-[#FEF3C7] border border-[#F59E0B]/30 rounded-lg p-2.5">
                      Confirmation marks the order Completed, creates one official invoice, and recognizes the full ₹{Number(selectedAdvance.total_amount).toLocaleString(undefined, { minimumFractionDigits: 2 })} as revenue.
                    </p>

                    <button
                      onClick={confirmReceiveBalance}
                      disabled={isFinalizing}
                      className={`w-full py-3 rounded-lg font-black text-[11px] uppercase tracking-[0.1em] flex items-center justify-center gap-2 bg-[#10B981] hover:bg-[#059669] text-white shadow-md transition-all ${
                        isFinalizing ? "opacity-60 cursor-not-allowed" : "cursor-pointer"
                      }`}
                    >
                      {isFinalizing ? (<><Loader2 className="w-4 h-4 animate-spin" /><span>Finalizing...</span></>) : (<><Check className="w-4 h-4" /><span>Confirm Final Payment</span></>)}
                    </button>
                  </div>
                )}
              </div>
            </div>
          </div>
        )}

        {/* ── Advance Orders tab ─────────────────────────────────── */}
        {activeTab === "advance" && (
          <div className="flex-1 flex flex-col max-w-[1400px] mx-auto w-full pb-8 pr-2 animate-in fade-in duration-300">
            {/* Header */}
            <div className="flex flex-col lg:flex-row justify-between items-start lg:items-center gap-4 mb-6">
              <div>
                <h2 className="text-[28px] font-black text-[#000000] tracking-tight">Advance Orders</h2>
                <p className="text-xs text-[#000000] font-semibold mt-1">Partial-payment holds — revenue is recognized only when the balance is collected.</p>
              </div>
              <div className="flex flex-wrap items-center gap-3 w-full lg:w-auto">
                <div className="flex flex-wrap items-center bg-white border border-black/10 rounded-xl p-1 gap-1 max-w-full">
                  <span className="text-[9px] font-bold text-black uppercase tracking-wider px-2">Period:</span>
                  {(["all", "today", "week", "month", "year"] as const).map((p) => (
                    <button
                      key={p}
                      onClick={() => {
                        setAdvPeriod(p);
                        setAdvStartDate("");
                        setAdvEndDate("");
                      }}
                      className={`px-3 py-1 rounded-lg text-[10px] font-bold uppercase tracking-wider transition-all cursor-pointer ${
                        advPeriod === p ? "bg-[#3F3F46] text-white shadow-sm" : "text-black hover:bg-black/5"
                      }`}
                    >
                      {p === "all" ? "All Time" : p === "today" ? "Today" : p === "week" ? "This Week" : p === "month" ? "This Month" : "This Year"}
                    </button>
                  ))}
                </div>
                <div className="flex flex-wrap items-center border rounded-xl px-3 py-1.5 gap-2 shadow-sm bg-white border-black/10 min-w-0">
                  <div className="flex items-center gap-1">
                    <span className="text-[9px] font-bold uppercase tracking-wider text-black">From:</span>
                    <input
                      type="date"
                      value={advStartDate}
                      onChange={(e) => {
                        setAdvPeriod("custom");
                        setAdvStartDate(e.target.value);
                      }}
                      className="text-xs font-bold bg-transparent border-none outline-none focus:ring-0 cursor-pointer text-black w-[115px]"
                    />
                  </div>
                  <div className="flex items-center gap-1">
                    <span className="text-[9px] font-bold uppercase tracking-wider text-black">To:</span>
                    <input
                      type="date"
                      value={advEndDate}
                      onChange={(e) => {
                        setAdvPeriod("custom");
                        setAdvEndDate(e.target.value);
                      }}
                      className="text-xs font-bold bg-transparent border-none outline-none focus:ring-0 cursor-pointer text-black w-[115px]"
                    />
                  </div>
                </div>
              </div>
            </div>

            {/* Summary cards */}
            <div className="grid grid-cols-1 sm:grid-cols-3 gap-4 mb-6">
              {(() => {
                const pending = advanceOrders.filter((a) => a.status === "PENDING" || a.status === "READY");
                const outstanding = pending.reduce((acc, a) => acc + balanceRemaining(a), 0);
                const ready = advanceOrders.filter((a) => a.status === "READY").length;
                const completed = advanceOrders.filter((a) => a.status === "COMPLETED").length;
                return (
                  <>
                    <div className="bg-white border border-black/10 rounded-xl p-4 shadow-xs flex justify-between items-center">
                      <div>
                        <p className="text-[10px] font-bold text-[#52525B] uppercase tracking-wider">Outstanding Balance</p>
                        <p className="text-xl font-black text-black">₹{outstanding.toLocaleString(undefined, { minimumFractionDigits: 2 })}</p>
                      </div>
                      <div className="w-10 h-10 rounded-lg bg-[#FEE2E2] flex items-center justify-center">
                        <IndianRupee className="w-5 h-5 text-[#DC2626]" />
                      </div>
                    </div>
                    <div className="bg-white border border-black/10 rounded-xl p-4 shadow-xs flex justify-between items-center">
                      <div>
                        <p className="text-[10px] font-bold text-[#52525B] uppercase tracking-wider">Ready For Collection</p>
                        <p className="text-xl font-black text-black">{ready}</p>
                      </div>
                      <div className="w-10 h-10 rounded-lg bg-[#DBEAFE] flex items-center justify-center">
                        <Package className="w-5 h-5 text-[#2563EB]" />
                      </div>
                    </div>
                    <div className="bg-white border border-black/10 rounded-xl p-4 shadow-xs flex justify-between items-center">
                      <div>
                        <p className="text-[10px] font-bold text-[#52525B] uppercase tracking-wider">Completed Deposits</p>
                        <p className="text-xl font-black text-black">{completed}</p>
                      </div>
                      <div className="w-10 h-10 rounded-lg bg-[#DCFCE7] flex items-center justify-center">
                        <Check className="w-5 h-5 text-[#16A34A]" />
                      </div>
                    </div>
                  </>
                );
              })()}
            </div>

            {/* Search + status filter */}
            <div className="bg-white border border-black/10 rounded-xl p-3 mb-4 flex flex-col md:flex-row gap-3 items-stretch md:items-center">
              <div className="flex-1 relative">
                <Search className="w-4 h-4 text-[#52525B] absolute left-3 top-1/2 -translate-y-1/2" />
                <input
                  type="text"
                  value={advSearchQuery}
                  onChange={(e) => setAdvSearchQuery(e.target.value)}
                  placeholder="Search by ID, customer, phone, product or status"
                  className="w-full bg-white border border-black/10 rounded-lg pl-9 pr-3 py-2 text-xs font-semibold focus:outline-none focus:border-[#3F3F46]"
                />
              </div>
              <div className="flex gap-1.5 flex-wrap">
                {(["ALL", "PENDING", "READY", "COMPLETED", "CANCELLED"] as const).map((s) => (
                  <button
                    key={s}
                    onClick={() => setAdvStatusFilter(s)}
                    className={`px-3 py-1.5 rounded-lg text-[10px] font-black uppercase tracking-wider transition-all cursor-pointer ${
                      advStatusFilter === s ? "bg-[#3F3F46] text-white" : "bg-[#F4F4F5] text-black hover:bg-black/10"
                    }`}
                  >
                    {s === "ALL" ? "All" : s.charAt(0) + s.slice(1).toLowerCase()}
                  </button>
                ))}
              </div>
            </div>

            {/* Rows */}
            <div className="bg-white border border-black/10 rounded-xl overflow-hidden">
              <div className="hidden md:grid grid-cols-[1.1fr_1.3fr_1.5fr_1.5fr_0.9fr_1.1fr_1.4fr] gap-3 px-4 py-3 border-b border-black/10 text-[10px] font-black uppercase tracking-wider text-[#52525B] bg-[#F9FAFB]">
                <span>Deposit ID</span>
                <span>Customer</span>
                <span>Product</span>
                <span>Total / Paid / Balance</span>
                <span>Delivery</span>
                <span>Status</span>
                <span className="text-right">Actions</span>
              </div>
              {(() => {
                const q = advSearchQuery.trim().toLowerCase();
                const filtered = advanceOrders.filter((a) => {
                  if (advStatusFilter !== "ALL" && a.status !== advStatusFilter) return false;
                  if (!inAdvPeriod(a.created_at)) return false;
                  if (!q) return true;
                  return (
                    a.id.toLowerCase().includes(q) ||
                    a.customer_name.toLowerCase().includes(q) ||
                    a.customer_phone.includes(q) ||
                    a.status.toLowerCase().includes(q) ||
                    a.items.some((i) => i.snapshot_name.toLowerCase().includes(q))
                  );
                });
                if (filtered.length === 0) {
                  return (
                    <div className="p-8 text-center text-xs font-bold text-[#52525B]">
                      No advance orders match the current filters.
                    </div>
                  );
                }
                return filtered.map((a) => {
                  const bal = balanceRemaining(a);
                  const statusStyles: Record<AdvanceOrderStatus, string> = {
                    PENDING: "bg-[#FEF3C7] text-[#78350F] border-[#F59E0B]/30",
                    READY: "bg-[#DBEAFE] text-[#1E3A8A] border-[#2563EB]/30",
                    COMPLETED: "bg-[#DCFCE7] text-[#166534] border-[#16A34A]/30",
                    CANCELLED: "bg-[#FEE2E2] text-[#991B1B] border-[#DC2626]/30",
                  };
                  return (
                    <div key={a.id} className="grid grid-cols-1 md:grid-cols-[1.1fr_1.3fr_1.5fr_1.5fr_0.9fr_1.1fr_1.4fr] gap-3 px-4 py-3 border-b border-black/5 items-center text-xs hover:bg-[#FAFAFA]">
                      <div>
                        <p className="font-mono font-black text-[11px] text-black">{a.id}</p>
                        <p className="text-[9px] font-bold text-[#52525B]">{new Date(a.created_at).toLocaleDateString()}</p>
                      </div>
                      <div>
                        <p className="font-black text-black">{a.customer_name}</p>
                        <p className="text-[10px] text-[#52525B]">{a.customer_phone}</p>
                      </div>
                      <div className="text-[11px]">
                        {a.items.slice(0, 2).map((i) => (
                          <p key={i.id} className="font-bold text-black truncate">
                            {i.quantity}× {i.snapshot_name}
                          </p>
                        ))}
                        {a.items.length > 2 && (
                          <p className="text-[10px] text-[#52525B]">+{a.items.length - 2} more</p>
                        )}
                      </div>
                      <div className="text-[11px]">
                        <p className="font-bold text-black">Total: ₹{Number(a.total_amount).toLocaleString(undefined, { minimumFractionDigits: 2 })}</p>
                        {Number(a.discount_amount) > 0 && (
                          <p className="text-[#B45309] font-black">
                            Discount applied: −₹{Number(a.discount_amount).toLocaleString(undefined, { maximumFractionDigits: 2 })}
                            {a.discount_type === "PERCENT" && Number(a.discount_value) ? ` (${Number(a.discount_value)}%)` : ""}
                          </p>
                        )}
                        <p className="text-[#16A34A] font-bold">Paid: ₹{Number(a.deposit_amount).toLocaleString(undefined, { minimumFractionDigits: 2 })}</p>
                        <p className="text-[#DC2626] font-bold">Balance: ₹{bal.toLocaleString(undefined, { minimumFractionDigits: 2 })}</p>
                      </div>
                      <div className="text-[11px] font-bold text-[#52525B]">
                        {a.delivery_date ? new Date(a.delivery_date).toLocaleDateString() : "—"}
                      </div>
                      <div>
                        <span className={`inline-block px-2 py-1 rounded-md text-[9px] font-black uppercase tracking-wider border ${statusStyles[a.status]}`}>
                          {a.status}
                        </span>
                        {a.status !== "COMPLETED" && a.status !== "CANCELLED" && (
                          <button
                            onClick={() => toggleAdvanceReady(a)}
                            className="block mt-1 text-[9px] font-black uppercase tracking-wider text-[#2563EB] hover:underline cursor-pointer"
                          >
                            Mark as {a.status === "READY" ? "Pending" : "Ready"}
                          </button>
                        )}
                      </div>
                      <div className="flex items-center justify-end gap-1.5 flex-nowrap">
                        <button onClick={() => openAdvanceView(a)} title="View details" className="w-8 h-8 shrink-0 rounded-lg bg-[#F4F4F5] hover:bg-[#E4E4E7] text-black flex items-center justify-center cursor-pointer">
                          <Eye className="w-4 h-4" />
                        </button>
                        {a.status !== "COMPLETED" && a.status !== "CANCELLED" && (
                          <button onClick={() => openReceiveBalance(a)} title="Receive balance" className="w-8 h-8 shrink-0 rounded-lg bg-[#10B981] hover:bg-[#059669] text-white flex items-center justify-center cursor-pointer">
                            <IndianRupee className="w-4 h-4" />
                          </button>
                        )}
                        {a.status === "COMPLETED" && a.finalized_order_id && (
                          <button onClick={() => setActiveInvoiceId(a.finalized_order_id)} title="Open invoice" className="w-8 h-8 shrink-0 rounded-lg bg-[#DBEAFE] hover:bg-[#BFDBFE] text-[#1E3A8A] flex items-center justify-center cursor-pointer">
                            <Receipt className="w-4 h-4" />
                          </button>
                        )}
                        {a.status !== "COMPLETED" && a.status !== "CANCELLED" && (
                          <button onClick={() => doCancelAdvance(a)} title="Cancel" className="w-8 h-8 shrink-0 rounded-lg bg-[#FEE2E2] hover:bg-[#FECACA] text-[#991B1B] flex items-center justify-center cursor-pointer">
                            <X className="w-4 h-4" />
                          </button>
                        )}
                        {role === "admin" && (
                          <button onClick={() => doDeleteAdvance(a)} title="Delete" className="w-8 h-8 shrink-0 rounded-lg bg-[#F4F4F5] hover:bg-[#E4E4E7] text-[#991B1B] flex items-center justify-center cursor-pointer">
                            <Trash2 className="w-4 h-4" />
                          </button>
                        )}
                      </div>
                    </div>
                  );
                });
              })()}
            </div>
          </div>
        )}

        {activeTab === "orders" && (
          <div className="flex-1 flex flex-col max-w-[1400px] mx-auto w-full pb-8 pr-2 animate-in fade-in duration-300">
            {/* Header Panel */}
            <div className="flex flex-col lg:flex-row justify-between items-start lg:items-center gap-4 mb-6">
              <div>
                <h2 className="text-[28px] font-black text-[#000000] tracking-tight">
                  Order History
                </h2>
                <p className="text-xs text-[#000000] font-semibold mt-1">
                  Manage and track past invoices
                </p>
              </div>

              {orders.length > 0 && (
                <div className="flex flex-wrap items-center gap-3 w-full lg:w-auto">
                  <div className="flex flex-wrap items-center bg-[#FFFFFF] border border-black/10 rounded-xl p-1 gap-1 max-w-full">
                    <span className="text-[9px] font-bold text-[#000000] uppercase tracking-wider px-2">
                      Period:
                    </span>
                    {(["all", "today", "week", "month", "year"] as const).map(
                      (p) => {
                        const displayLabel =
                          p === "all"
                            ? "All Time"
                            : p === "today"
                              ? "Today"
                              : p === "week"
                                ? "This Week"
                                : p === "month"
                                  ? "This Month"
                                  : "This Year";
                        const isActive = historyPeriod === p;
                        return (
                          <button
                            key={p}
                            onClick={() => {
                              setHistoryPeriod(p);
                              setHistoryStartDate("");
                              setHistoryEndDate("");
                            }}
                            className={`px-3 py-1 rounded-lg text-[10px] font-bold uppercase tracking-wider transition-all cursor-pointer ${
                              isActive
                                ? "bg-[#3F3F46] text-[#FFFFFF] shadow-sm"
                                : "text-[#000000] hover:bg-[#000000]/50"
                            }`}
                          >
                            {displayLabel}
                          </button>
                        );
                      },
                    )}
                  </div>

                  <div className="flex flex-wrap items-center border rounded-xl px-3 py-1.5 gap-2 shadow-sm bg-white border-black/10 min-w-0">
                    <div className="flex items-center gap-1">
                      <span className="text-[9px] font-bold uppercase tracking-wider text-[#000000]">
                        From:
                      </span>
                      <input
                        type="date"
                        value={historyStartDate}
                        onChange={(e) => {
                          setHistoryPeriod("custom");
                          setHistoryStartDate(e.target.value);
                        }}
                        className="text-xs font-bold bg-transparent border-none outline-none focus:ring-0 cursor-pointer text-[#000000] w-[115px]"
                      />
                    </div>
                    <div className="flex items-center gap-1">
                      <span className="text-[9px] font-bold uppercase tracking-wider text-[#000000]">
                        To:
                      </span>
                      <input
                        type="date"
                        value={historyEndDate}
                        onChange={(e) => {
                          setHistoryPeriod("custom");
                          setHistoryEndDate(e.target.value);
                        }}
                        className="text-xs font-bold bg-transparent border-none outline-none focus:ring-0 cursor-pointer text-[#000000] w-[115px]"
                      />
                    </div>
                  </div>

                  <button
                    onClick={handleExportCSV}
                    className="flex items-center gap-1.5 px-4 py-2 border-2 border-[#3F3F46] bg-transparent text-[#3F3F46] hover:bg-[#3F3F46] hover:text-[#FFFFFF] rounded-xl text-xs font-black uppercase tracking-wider transition-all duration-200 cursor-pointer shadow-sm"
                  >
                    <Download className="w-3.5 h-3.5" />
                    Export CSV
                  </button>
                </div>
              )}
            </div>

            {orders.length === 0 ? (
              <div className="flex-1 flex flex-col items-center justify-center border-2 border-dashed border-black/10 rounded-xl bg-[#FFFFFF] py-12">
                <p className="text-[#000000] font-medium">
                  No past transactions yet.
                </p>
              </div>
            ) : (
              <>
                {/* Search and Filters Bar */}
                <div className="bg-white border-2 border-black/10 rounded-xl p-4 mb-6 shadow-sm flex flex-wrap gap-4 items-center justify-between">
                  <div className="grid grid-cols-1 sm:grid-cols-2 md:grid-cols-5 gap-3 w-full">
                    <div>
                      <label className="block text-[9px] font-bold text-[#000000] uppercase tracking-wider mb-1">
                        Search Order ID
                      </label>
                      <div className="relative">
                        <Search className="w-3.5 h-3.5 text-[#000000] absolute left-3 top-1/2 -translate-y-1/2" />
                        <input
                          type="text"
                          placeholder="e.g. INV-..."
                          className="w-full bg-[#FFFFFF]/30 border border-black/10 focus:border-[#3F3F46] rounded-lg pl-8 pr-3 py-1.5 text-xs font-semibold text-[#000000] focus:outline-none"
                          value={orderSearchId}
                          onChange={(e) => setOrderSearchId(e.target.value)}
                        />
                      </div>
                    </div>
                    <div>
                      <label className="block text-[9px] font-bold text-[#000000] uppercase tracking-wider mb-1">
                        Customer Name
                      </label>
                      <input
                        type="text"
                        placeholder="Search name..."
                        className="w-full bg-[#FFFFFF]/30 border border-black/10 focus:border-[#3F3F46] rounded-lg px-3 py-1.5 text-xs font-semibold text-[#000000] focus:outline-none"
                        value={orderSearchName}
                        onChange={(e) => setOrderSearchName(e.target.value)}
                      />
                    </div>
                    <div>
                      <label className="block text-[9px] font-bold text-[#000000] uppercase tracking-wider mb-1">
                        Customer Phone
                      </label>
                      <input
                        type="text"
                        placeholder="Search phone..."
                        className="w-full bg-[#FFFFFF]/30 border border-black/10 focus:border-[#3F3F46] rounded-lg px-3 py-1.5 text-xs font-semibold text-[#000000] focus:outline-none"
                        value={orderSearchPhone}
                        onChange={(e) => setOrderSearchPhone(e.target.value)}
                      />
                    </div>
                    <div>
                      <label className="block text-[9px] font-bold text-[#000000] uppercase tracking-wider mb-1">
                        Order Source
                      </label>
                      <select
                        className="w-full bg-[#FFFFFF]/30 border border-black/10 focus:border-[#3F3F46] rounded-lg px-3 py-1.5 text-xs font-bold text-[#000000] focus:outline-none cursor-pointer"
                        value={orderFilterSource}
                        onChange={(e) => setOrderFilterSource(e.target.value)}
                      >
                        <option value="ALL">All Sources</option>
                        <option value="ONLINE">Online Orders</option>
                        <option value="OFFLINE">Offline (POS)</option>
                      </select>
                    </div>
                    <div>
                      <label className="block text-[9px] font-bold text-[#000000] uppercase tracking-wider mb-1">
                        Sort By
                      </label>
                      <select
                        className="w-full bg-[#FFFFFF]/30 border border-black/10 focus:border-[#3F3F46] rounded-lg px-3 py-1.5 text-xs font-bold text-[#000000] focus:outline-none cursor-pointer"
                        value={`${orderSortField}_${orderSortOrder}`}
                        onChange={(e) => {
                          const [f, o] = e.target.value.split("_") as [any, "asc" | "desc"];
                          setOrderSortField(f);
                          setOrderSortOrder(o);
                        }}
                      >
                        <option value="date_desc">Date: Newest First</option>
                        <option value="date_asc">Date: Oldest First</option>
                        <option value="total_desc">Total: High to Low</option>
                        <option value="total_asc">Total: Low to High</option>
                        <option value="id_asc">Order ID: A to Z</option>
                        <option value="name_asc">Customer Name: A to Z</option>
                        <option value="status_asc">Status: A to Z</option>
                      </select>
                    </div>
                  </div>
                </div>

                {(() => {
                  const filteredOrders = historyFilteredOrders;

                  if (filteredOrders.length === 0) {
                    return (
                      <div className="flex-1 flex flex-col items-center justify-center border-2 border-dashed border-black/10 rounded-xl bg-[#FFFFFF] py-12">
                        <p className="text-[#000000] font-semibold">
                          No transactions match your search filters.
                        </p>
                      </div>
                    );
                  }

                  return (
                    <div className="bg-[#FFFFFF] border-2 border-black/10 rounded-xl shadow-sm overflow-x-auto">
                      <table className="w-full text-left border-collapse">
                        <thead>
                          <tr className="bg-[#FFFFFF] border-b border-black/10 select-none">
                            <th
                              onClick={() => {
                                if (orderSortField === "id") {
                                  setOrderSortOrder((prev) => (prev === "asc" ? "desc" : "asc"));
                                } else {
                                  setOrderSortField("id");
                                  setOrderSortOrder("asc");
                                }
                              }}
                              className="p-4 text-[10px] font-bold text-[#000000] uppercase tracking-widest cursor-pointer hover:bg-black/5 transition-colors"
                            >
                              <div className="flex items-center gap-1.5">
                                <span>Order ID</span>
                                {orderSortField === "id" ? (
                                  orderSortOrder === "asc" ? (
                                    <ArrowUp className="w-3 h-3 text-[#3F3F46]" />
                                  ) : (
                                    <ArrowDown className="w-3 h-3 text-[#3F3F46]" />
                                  )
                                ) : (
                                  <ArrowUpDown className="w-3 h-3 text-black/30" />
                                )}
                              </div>
                            </th>
                            <th
                              onClick={() => {
                                if (orderSortField === "date") {
                                  setOrderSortOrder((prev) => (prev === "asc" ? "desc" : "asc"));
                                } else {
                                  setOrderSortField("date");
                                  setOrderSortOrder("desc");
                                }
                              }}
                              className="p-4 text-[10px] font-bold text-[#000000] uppercase tracking-widest cursor-pointer hover:bg-black/5 transition-colors"
                            >
                              <div className="flex items-center gap-1.5">
                                <span>Date & Time</span>
                                {orderSortField === "date" ? (
                                  orderSortOrder === "asc" ? (
                                    <ArrowUp className="w-3 h-3 text-[#3F3F46]" />
                                  ) : (
                                    <ArrowDown className="w-3 h-3 text-[#3F3F46]" />
                                  )
                                ) : (
                                  <ArrowUpDown className="w-3 h-3 text-black/30" />
                                )}
                              </div>
                            </th>
                            <th
                              onClick={() => {
                                if (orderSortField === "name") {
                                  setOrderSortOrder((prev) => (prev === "asc" ? "desc" : "asc"));
                                } else {
                                  setOrderSortField("name");
                                  setOrderSortOrder("asc");
                                }
                              }}
                              className="p-4 text-[10px] font-bold text-[#000000] uppercase tracking-widest cursor-pointer hover:bg-black/5 transition-colors"
                            >
                              <div className="flex items-center gap-1.5">
                                <span>Customer Name</span>
                                {orderSortField === "name" ? (
                                  orderSortOrder === "asc" ? (
                                    <ArrowUp className="w-3 h-3 text-[#3F3F46]" />
                                  ) : (
                                    <ArrowDown className="w-3 h-3 text-[#3F3F46]" />
                                  )
                                ) : (
                                  <ArrowUpDown className="w-3 h-3 text-black/30" />
                                )}
                              </div>
                            </th>
                            <th className="p-4 text-[10px] font-bold text-[#000000] uppercase tracking-widest">
                              Mobile Number
                            </th>
                            <th className="p-4 text-[10px] font-bold text-[#000000] uppercase tracking-widest">
                              Source
                            </th>
                            <th
                              onClick={() => {
                                if (orderSortField === "total") {
                                  setOrderSortOrder((prev) => (prev === "asc" ? "desc" : "asc"));
                                } else {
                                  setOrderSortField("total");
                                  setOrderSortOrder("desc");
                                }
                              }}
                              className="p-4 text-[10px] font-bold text-[#000000] uppercase tracking-widest cursor-pointer hover:bg-black/5 transition-colors"
                            >
                              <div className="flex items-center gap-1.5">
                                <span>Total Due</span>
                                {orderSortField === "total" ? (
                                  orderSortOrder === "asc" ? (
                                    <ArrowUp className="w-3 h-3 text-[#3F3F46]" />
                                  ) : (
                                    <ArrowDown className="w-3 h-3 text-[#3F3F46]" />
                                  )
                                ) : (
                                  <ArrowUpDown className="w-3 h-3 text-black/30" />
                                )}
                              </div>
                            </th>
                            <th
                              onClick={() => {
                                if (orderSortField === "status") {
                                  setOrderSortOrder((prev) => (prev === "asc" ? "desc" : "asc"));
                                } else {
                                  setOrderSortField("status");
                                  setOrderSortOrder("asc");
                                }
                              }}
                              className="p-4 text-[10px] font-bold text-[#000000] uppercase tracking-widest text-right cursor-pointer hover:bg-black/5 transition-colors"
                            >
                              <div className="flex items-center justify-end gap-1.5">
                                <span>Status</span>
                                {orderSortField === "status" ? (
                                  orderSortOrder === "asc" ? (
                                    <ArrowUp className="w-3 h-3 text-[#3F3F46]" />
                                  ) : (
                                    <ArrowDown className="w-3 h-3 text-[#3F3F46]" />
                                  )
                                ) : (
                                  <ArrowUpDown className="w-3 h-3 text-black/30" />
                                )}
                              </div>
                            </th>
                          </tr>
                        </thead>
                        <tbody>
                          {filteredOrders.map((order) => (
                            <tr
                              key={order.id}
                              className="border-b border-transparent hover:bg-[#FFFFFF] transition-colors"
                            >
                              <td className="p-4 text-xs font-semibold text-[#000000]">
                                {order.id}
                              </td>
                              <td className="p-4 text-xs font-bold text-[#000000] whitespace-nowrap">
                                {new Date(order.date).toLocaleDateString(
                                  "en-IN",
                                  {
                                    day: "2-digit",
                                    month: "short",
                                    year: "numeric",
                                  },
                                )}
                                <span className="block text-[10px] font-semibold text-black/60">
                                  {new Date(
                                    order.createdAt || order.date,
                                  ).toLocaleTimeString("en-IN", {
                                    hour: "2-digit",
                                    minute: "2-digit",
                                    timeZone: "Asia/Kolkata",
                                  })}
                                </span>
                              </td>
                              <td className="p-4 text-xs font-bold text-[#000000]">
                                {order.customerName}
                              </td>
                              <td className="p-4 text-xs font-mono font-bold text-[#000000]">
                                {order.customerPhone || "-"}
                              </td>
                              <td className="p-4">
                                <div className="flex flex-col items-start gap-1">
                                  <span
                                    className={`px-2 py-0.5 rounded text-[9px] font-bold tracking-widest border ${order.source === "ONLINE" ? "border-[#00A86B] text-[#00A86B] bg-[#00A86B]/10" : "border-[#27272A] text-[#27272A] bg-[#27272A]/10"}`}
                                  >
                                    {order.source}
                                  </span>
                                  <span
                                    className={`px-2 py-0.5 rounded text-[9px] font-bold tracking-widest border ${order.isGst ? "border-[#4F46E5] text-[#4F46E5] bg-[#4F46E5]/10" : "border-black/20 text-[#111827] bg-black/5"}`}
                                  >
                                    {order.isGst ? "GST" : "NON-GST"}
                                  </span>
                                </div>
                              </td>
                              <td className="p-4 text-sm font-black text-[#3F3F46]">
                                ₹{order.grandTotal.toLocaleString()}
                                {order.discount > 0 && (
                                  <span className="block text-[10px] font-black text-[#B45309] mt-0.5">
                                    Discount applied: −₹{order.discount.toLocaleString(undefined, { maximumFractionDigits: 2 })}
                                    {order.discountType === "PERCENT" && order.discountValue ? ` (${order.discountValue}%)` : ""}
                                  </span>
                                )}
                                <span className={`block text-[9px] font-bold mt-0.5 ${order.splitMode2 ? "text-[#B45309]" : "text-black/50"}`}>
                                  {order.splitMode2 ? "⇄ " : ""}{paymentSummary(order)}
                                </span>
                              </td>
                              <td className="p-4 text-right">
                                <div className="flex flex-row items-center justify-end gap-1.5">
                                  <span className="px-3 py-1 rounded bg-[#10B981]/10 text-[#10B981] text-[10px] font-bold uppercase tracking-wider hidden lg:inline-block mr-1">
                                    {order.status}
                                  </span>
                                  <button
                                    onClick={() => resendWhatsApp(order)}
                                    title="Send on WhatsApp"
                                    aria-label="Send on WhatsApp"
                                    className="flex items-center justify-center w-8 h-8 bg-[#10B981]/10 hover:bg-[#10B981]/20 text-[#10B981] rounded-md transition-colors cursor-pointer"
                                  >
                                    <svg
                                      className="w-4 h-4"
                                      viewBox="0 0 24 24"
                                      fill="currentColor"
                                    >
                                      <path d="M17.472 14.382c-.297-.149-1.758-.867-2.03-.967-.273-.099-.471-.148-.67.15-.197.297-.767.966-.94 1.164-.173.199-.347.223-.644.075-.297-.15-1.255-.463-2.39-1.475-.883-.788-1.48-1.761-1.653-2.059-.173-.297-.018-.458.13-.606.134-.133.298-.347.446-.52.149-.174.198-.298.298-.497.099-.198.05-.371-.025-.52-.075-.149-.669-1.612-.916-2.207-.242-.579-.487-.5-.669-.51a12.8 12.8 0 0 0-.57-.012c-.198 0-.52.074-.792.372-.272.297-1.04 1.016-1.04 2.479 0 1.462 1.065 2.875 1.213 3.074.149.198 2.096 3.2 5.077 4.487.709.306 1.262.489 1.694.625.712.227 1.36.195 1.871.118.571-.085 1.758-.719 2.006-1.413.248-.694.248-1.289.173-1.413-.074-.124-.272-.198-.57-.347m-5.421 7.403h-.004a9.87 9.87 0 0 1-5.031-1.378l-.361-.214-3.741.982.998-3.648-.235-.374a9.86 9.86 0 0 1-1.51-5.26c.001-5.45 4.436-9.884 9.888-9.884 2.64 0 5.122 1.03 6.988 2.898a9.825 9.825 0 0 1 2.893 6.994c-.003 5.45-4.437 9.884-9.885 9.884m8.413-18.297A11.815 11.815 0 0 0 12.05 0C5.495 0 .16 5.335.157 11.892c0 2.096.547 4.142 1.588 5.945L.057 24l6.305-1.654a11.882 11.882 0 0 0 5.683 1.448h.005c6.554 0 11.89-5.335 11.893-11.893a11.821 11.821 0 0 0-3.48-8.413Z" />
                                    </svg>
                                  </button>
                                  <button
                                    onClick={() => setActiveInvoiceId(order.id)}
                                    title="View invoice"
                                    aria-label="View invoice"
                                    className="flex items-center justify-center w-8 h-8 bg-[#3F3F46]/10 hover:bg-[#3F3F46]/20 text-[#3F3F46] rounded-md transition-colors cursor-pointer"
                                  >
                                    <svg
                                      className="w-4 h-4"
                                      fill="none"
                                      viewBox="0 0 24 24"
                                      stroke="currentColor"
                                    >
                                      <path
                                        strokeLinecap="round"
                                        strokeLinejoin="round"
                                        strokeWidth={2}
                                        d="M9 12h6m-6 4h6m2 5H7a2 2 0 01-2-2V5a2 2 0 012-2h5.586a1 1 0 01.707.293l5.414 5.414a1 1 0 01.293.707V19a2 2 0 01-2 2z"
                                      />
                                    </svg>
                                  </button>
                                  <button
                                    onClick={() => setSelectedOrder(order)}
                                    title="Order details"
                                    aria-label="Order details"
                                    className="flex items-center justify-center w-8 h-8 bg-black/5 hover:bg-black/10 text-[#000000] rounded-md transition-colors cursor-pointer"
                                  >
                                    <svg
                                      className="w-4 h-4"
                                      fill="none"
                                      viewBox="0 0 24 24"
                                      stroke="currentColor"
                                    >
                                      <path
                                        strokeLinecap="round"
                                        strokeLinejoin="round"
                                        strokeWidth={2}
                                        d="M15 12a3 3 0 11-6 0 3 3 0 016 0z"
                                      />
                                      <path
                                        strokeLinecap="round"
                                        strokeLinejoin="round"
                                        strokeWidth={2}
                                        d="M2.458 12C3.732 7.943 7.523 5 12 5c4.478 0 8.268 2.943 9.542 7-1.274 4.057-5.064 7-9.542 7-4.477 0-8.268-2.943-9.542-7z"
                                      />
                                    </svg>
                                  </button>
                                  {role === "admin" && (
                                    <button
                                      onClick={() =>
                                        handleDeleteOrder(order.id)
                                      }
                                      title="Delete order"
                                      aria-label="Delete order"
                                      className="flex items-center justify-center w-8 h-8 bg-[#DC2626]/10 hover:bg-[#DC2626]/20 text-[#DC2626] rounded-md transition-colors cursor-pointer"
                                    >
                                      <Trash2 className="w-4 h-4" />
                                    </button>
                                  )}
                                </div>
                              </td>
                            </tr>
                          ))}
                        </tbody>
                      </table>
                    </div>
                  );
                })()}
              </>
            )}
          </div>
        )}

        {role === "admin" && activeTab === "analytics" && (
          <div className="flex-1 flex flex-col max-w-[1400px] min-w-0 mx-auto w-full pb-8 pr-2">
            {/* Header Panel */}
            <div className="flex flex-col lg:flex-row justify-between items-start lg:items-center gap-4 mb-4">
              <div>
                <h2 className="text-[28px] font-black text-[#000000] tracking-tight">
                  {analyticsGstFilter === "gst"
                    ? "GST Revenue"
                    : analyticsGstFilter === "nongst"
                      ? "Non-GST Revenue"
                      : "Revenue Analytics"}
                </h2>
                <p className="text-xs text-[#000000] font-semibold mt-1">
                  {analyticsGstFilter === "gst"
                    ? "GST invoices only — taxable sales dashboard"
                    : analyticsGstFilter === "nongst"
                      ? "Non-GST bills only — retail sales dashboard"
                      : "All bills — full store & channel insights"}
                </p>
              </div>

              {/* Period Filters & Refresh Button */}
              <div className="flex flex-wrap items-center gap-3 w-full lg:w-auto">
                {analyticsSubTab !== "today" && (
                  <>
                    <div className="flex flex-wrap items-center bg-[#FFFFFF] border border-black/10 rounded-xl p-1 gap-1 max-w-full">
                      <span className="text-[9px] font-bold text-[#000000] uppercase tracking-wider px-2">
                        Period:
                      </span>
                      {(["all", "today", "week", "month", "year"] as const).map(
                        (p) => {
                          const displayLabel =
                            p === "all"
                              ? "All Time"
                              : p === "today"
                                ? "Today"
                                : p === "week"
                                  ? "This Week"
                                  : p === "month"
                                    ? "This Month"
                                    : "This Year";
                          const isActive = analyticsPeriod === p;
                          return (
                            <button
                              key={p}
                              onClick={() => {
                                setAnalyticsPeriod(p);
                                setAnalyticsStartDate("");
                                setAnalyticsEndDate("");
                              }}
                              className={`px-3 py-1 rounded-lg text-[10px] font-bold uppercase tracking-wider transition-all cursor-pointer ${
                                isActive
                                  ? "bg-[#3F3F46] text-[#FFFFFF] shadow-sm"
                                  : "text-[#000000] hover:bg-[#000000]/50"
                              }`}
                            >
                              {displayLabel}
                            </button>
                          );
                        },
                      )}
                    </div>

                    <div className="flex flex-wrap items-center border rounded-xl px-3 py-1.5 gap-2 shadow-sm bg-white border-black/10 min-w-0">
                      <div className="flex items-center gap-1">
                        <span className="text-[9px] font-bold uppercase tracking-wider text-[#000000]">
                          From:
                        </span>
                        <input
                          type="date"
                          value={analyticsStartDate}
                          onChange={(e) => {
                            setAnalyticsPeriod("custom");
                            setAnalyticsStartDate(e.target.value);
                          }}
                          className="text-xs font-bold bg-transparent border-none outline-none focus:ring-0 cursor-pointer text-[#000000] w-[115px]"
                        />
                      </div>
                      <div className="flex items-center gap-1">
                        <span className="text-[9px] font-bold uppercase tracking-wider text-[#000000]">
                          To:
                        </span>
                        <input
                          type="date"
                          value={analyticsEndDate}
                          onChange={(e) => {
                            setAnalyticsPeriod("custom");
                            setAnalyticsEndDate(e.target.value);
                          }}
                          className="text-xs font-bold bg-transparent border-none outline-none focus:ring-0 cursor-pointer text-[#000000] w-[115px]"
                        />
                      </div>
                    </div>
                  </>
                )}
              </div>
            </div>

            {/* GST / Non-GST Dashboard Switch */}
            <div className="flex items-center gap-1 bg-[#FFFFFF] border border-black/10 rounded-xl p-1 mb-6 w-full sm:w-auto sm:self-start">
              {(
                [
                  ["all", "All Bills"],
                  ["gst", "GST Invoices"],
                  ["nongst", "Non-GST Bills"],
                ] as const
              ).map(([key, label]) => {
                const isActive = analyticsGstFilter === key;
                return (
                  <button
                    key={key}
                    onClick={() => setAnalyticsGstFilter(key)}
                    className={`flex-1 sm:flex-none px-4 py-1.5 rounded-lg text-[10px] font-bold uppercase tracking-wider transition-all cursor-pointer ${
                      isActive
                        ? key === "gst"
                          ? "bg-[#3F3F46] text-white shadow-sm"
                          : key === "nongst"
                            ? "bg-[#111827] text-white shadow-sm"
                            : "bg-[#3F3F46] text-white shadow-sm"
                        : "text-[#000000] hover:bg-black/5"
                    }`}
                  >
                    {label}
                  </button>
                );
              })}
            </div>

            <p className="text-[11px] font-semibold text-[#000000]/70 -mt-3 mb-6">
              Note: Whether you pick All, GST or Non-GST bills, these figures
              show only the product value (price x qty).
            </p>

            {/* Sub Navigation Tabs */}
            <div className="flex border-b border-black/10 mb-6 gap-6 overflow-x-auto scrollbar-none pb-0.5 w-full shrink-0">
              {(["revenue", "today", "products", "coupons"] as const).map(
                (tab) => {
                  const isActive = analyticsSubTab === tab;
                  const displayLabel =
                    tab === "today"
                      ? "Today's Sales"
                      : tab === "revenue"
                        ? "Revenue"
                        : tab === "products"
                          ? "Products"
                          : "Coupons";
                  return (
                    <button
                      key={tab}
                      onClick={() => setAnalyticsSubTab(tab)}
                      className={`pb-3 text-xs font-bold uppercase tracking-wider transition-all relative cursor-pointer shrink-0 ${
                        isActive
                          ? "text-[#3F3F46]"
                          : "text-[#000000] hover:text-[#000000]"
                      }`}
                    >
                      {displayLabel}
                      {isActive && (
                        <div className="absolute bottom-0 left-0 right-0 h-0.5 bg-[#3F3F46] rounded-full" />
                      )}
                    </button>
                  );
                },
              )}
            </div>

            {/* Tab Contents */}
            {analyticsSubTab === "today" && (
              <>
                {/* Today's KPI Grid */}
                <div className="grid grid-cols-1 sm:grid-cols-3 lg:grid-cols-3 gap-4 mb-8">
                  <div className="bg-white border border-black/10 rounded-xl p-4 shadow-sm hover:shadow-md transition-all">
                    <div className="flex justify-between items-start mb-3">
                      <span className="text-[10px] font-bold uppercase tracking-wider text-[#000000]">
                        Today's Revenue
                      </span>
                      <div className="w-6 h-6 rounded-full bg-[#10B981]/10 flex items-center justify-center">
                        <IndianRupee className="w-3 h-3 text-[#10B981] animate-pulse" />
                      </div>
                    </div>
                    <div className="text-xl font-black text-[#000000] mb-1">
                      ₹{todayRevenue.toLocaleString()}
                    </div>
                    <div className="text-[9px] text-[#000000] font-semibold">
                      Completed today
                    </div>
                  </div>

                  <div className="bg-white border border-black/10 rounded-xl p-4 shadow-sm hover:shadow-md transition-all">
                    <div className="flex justify-between items-start mb-3">
                      <span className="text-[10px] font-bold uppercase tracking-wider text-[#000000]">
                        Today's Bills
                      </span>
                      <div className="w-6 h-6 rounded-full bg-tertiary/10 flex items-center justify-center">
                        <Trophy className="w-3 h-3 text-tertiary animate-swing" />
                      </div>
                    </div>
                    <div className="text-xl font-black text-[#000000] mb-1">
                      {todayOrdersCount}
                    </div>
                    <div className="text-[9px] text-[#000000] font-semibold">
                      Completed today
                    </div>
                  </div>

                  <div className="bg-white border border-black/10 rounded-xl p-4 shadow-sm hover:shadow-md transition-all">
                    <div className="flex justify-between items-start mb-3">
                      <span className="text-[10px] font-bold uppercase tracking-wider text-[#000000]">
                        Today's Items Sold
                      </span>
                      <div className="w-6 h-6 rounded-full bg-[#8B5CF6]/10 flex items-center justify-center">
                        <Package className="w-3 h-3 text-[#8B5CF6] animate-pop" />
                      </div>
                    </div>
                    <div className="text-xl font-black text-[#000000] mb-1">
                      {todayItemsSold} pcs
                    </div>
                    <div className="text-[9px] text-[#000000] font-semibold">
                      Quantity sold today
                    </div>
                  </div>
                </div>

                {/* Today's Detailed Split */}
                <div className="flex flex-col lg:grid lg:grid-cols-12 gap-6 mb-8">
                  {/* Left Side: Today's Order Source & Leaderboard */}
                  <div className="col-span-8 w-full flex flex-col gap-6">
                    {/* Today's Transactions Table */}
                    <div className="bg-white border border-black/10 rounded-xl p-6 shadow-sm flex-1">
                      <div className="flex flex-col sm:flex-row justify-between items-start sm:items-center gap-4 mb-4">
                        <h3 className="font-bold text-[#000000] text-sm">
                          Today's Transactions
                        </h3>

                        {/* Contact Search Input */}
                        <div className="flex items-center border border-black/10 bg-[#FFFFFF] rounded-lg px-3 py-1.5 gap-2 shadow-xs w-full sm:w-auto animate-in fade-in duration-200">
                          <Search className="w-3.5 h-3.5 text-[#000000]" />
                          <input
                            type="text"
                            placeholder="Search contact/invoice..."
                            className="text-xs font-semibold bg-transparent border-none outline-none focus:ring-0 text-[#000000] placeholder:text-[#000000]/50 w-full sm:w-[170px]"
                            value={analyticsSearchPhone}
                            onChange={(e) =>
                              setAnalyticsSearchPhone(e.target.value)
                            }
                          />
                        </div>
                      </div>
                      {todayOrders.length === 0 ? (
                        <div className="text-center text-[#000000] text-xs font-semibold py-12">
                          {analyticsSearchPhone
                            ? "No matching transactions found."
                            : "No orders placed today."}
                        </div>
                      ) : (
                        <div className="overflow-x-auto">
                          <table className="w-full text-left border-collapse">
                            <thead>
                              <tr className="bg-[#FFFFFF] border-b border-black/10">
                                <th className="p-3 text-[10px] font-bold text-[#000000] uppercase tracking-wider">
                                  Invoice ID
                                </th>
                                <th className="p-3 text-[10px] font-bold text-[#000000] uppercase tracking-wider">
                                  Customer No
                                </th>
                                <th className="p-3 text-[10px] font-bold text-[#000000] uppercase tracking-wider">
                                  Source
                                </th>
                                <th className="p-3 text-[10px] font-bold text-[#000000] uppercase tracking-wider text-right">
                                  Items
                                </th>
                                <th className="p-3 text-[10px] font-bold text-[#000000] uppercase tracking-wider text-right">
                                  Grand Total
                                </th>
                              </tr>
                            </thead>
                            <tbody>
                              {todayOrders.map((order) => (
                                <tr
                                  key={order.id}
                                  className="border-b border-transparent hover:bg-[#FFFFFF]/50 transition-colors"
                                >
                                  <td className="p-3 text-xs font-semibold text-[#000000]">
                                    {order.id}
                                  </td>
                                  <td className="p-3 text-xs font-mono font-bold text-[#000000]">
                                    {order.customerPhone || "-"}
                                  </td>
                                  <td className="p-3">
                                    <span
                                      className={`px-2 py-0.5 rounded text-[9px] font-bold tracking-widest border ${order.source === "ONLINE" ? "border-[#00A86B] text-[#00A86B] bg-[#00A86B]/10" : "border-[#27272A] text-[#27272A] bg-[#27272A]/10"}`}
                                    >
                                      {order.source}
                                    </span>
                                  </td>
                                  <td className="p-3 text-xs font-semibold text-[#000000] text-right">
                                    {order.items.reduce(
                                      (sum, i) =>
                                        sum +
                                        (i.name && !i.name.startsWith("GST (")
                                          ? i.qty
                                          : 0),
                                      0,
                                    )}{" "}
                                    pcs
                                  </td>
                                  <td className="p-3 text-xs font-black text-[#3F3F46] text-right">
                                    ₹{order.items
                                      .reduce(
                                        (sum, i) =>
                                          i.name && i.name.startsWith("GST (")
                                            ? sum
                                            : sum + i.price * i.qty,
                                        0,
                                      )
                                      .toLocaleString()}
                                  </td>
                                </tr>
                              ))}
                            </tbody>
                          </table>
                        </div>
                      )}
                    </div>
                  </div>

                  {/* Right Side: Channel Split & Top items */}
                  <div className="col-span-4 w-full flex flex-col gap-6">
                    {/* Today's Channel Split Card */}
                    <div className="bg-white border border-black/10 rounded-xl p-6 shadow-sm">
                      <h3 className="font-bold text-[#000000] mb-4 text-sm">
                        Today's Channel Split
                      </h3>
                      {todayOrdersCount === 0 ? (
                        <div className="text-center text-[#000000] text-xs font-semibold py-6">
                          No sales today.
                        </div>
                      ) : (
                        <div className="space-y-4">
                          <div className="flex items-center gap-3">
                            <span className="text-[10px] font-bold text-[#27272A] uppercase tracking-wider w-14">
                              Offline
                            </span>
                            <div className="flex-1 h-2.5 bg-[#F3F4F6] rounded-full overflow-hidden">
                              <div
                                className="h-full bg-[#27272A] rounded-full transition-all duration-700"
                                style={{
                                  width: `${(todayOfflineOrdersCount / todayOrdersCount) * 100}%`,
                                }}
                              />
                            </div>
                            <span className="text-[11px] font-black text-[#000000] w-12 text-right">
                              ₹{todayOfflineRevenue.toLocaleString()}
                            </span>
                          </div>
                          <div className="flex items-center gap-3">
                            <span className="text-[10px] font-bold text-[#00A86B] uppercase tracking-wider w-14">
                              Online
                            </span>
                            <div className="flex-1 h-2.5 bg-[#F3F4F6] rounded-full overflow-hidden">
                              <div
                                className="h-full bg-[#00A86B] rounded-full transition-all duration-700"
                                style={{
                                  width: `${(todayOnlineOrdersCount / todayOrdersCount) * 100}%`,
                                }}
                              />
                            </div>
                            <span className="text-[11px] font-black text-[#000000] w-12 text-right">
                              ₹{todayOnlineRevenue.toLocaleString()}
                            </span>
                          </div>
                        </div>
                      )}
                    </div>

                    {/* Today's Top Products Sold Card */}
                    <div className="bg-white border border-black/10 rounded-xl p-6 shadow-sm flex-1">
                      <h3 className="font-bold text-[#000000] text-sm mb-4">
                        Today's Top Items
                      </h3>
                      {todayTopItems.length === 0 ? (
                        <div className="text-center text-[#000000] text-xs font-semibold py-6">
                          No items sold today.
                        </div>
                      ) : (
                        <div className="space-y-4">
                          {todayTopItems.map((item, idx) => (
                            <div
                              key={item.name}
                              className="flex items-center gap-3"
                            >
                              <span className="text-[11px] font-black text-[#000000] w-4">
                                {idx + 1}
                              </span>
                              <div className="flex-1">
                                <div className="flex justify-between items-center mb-1">
                                  <span className="text-xs font-bold text-[#000000]">
                                    {item.name}
                                  </span>
                                  <span className="text-xs font-black text-[#3F3F46]">
                                    ₹{item.revenue.toLocaleString()}
                                  </span>
                                </div>
                                <div className="h-1.5 bg-[#F3F4F6] rounded-full overflow-hidden">
                                  <div
                                    className="h-full bg-[#4F46E5] rounded-full transition-all duration-700"
                                    style={{
                                      width: `${(item.revenue / todayTopItems[0].revenue) * 100}%`,
                                    }}
                                  />
                                </div>
                              </div>
                              <span className="text-[10px] text-[#000000] font-semibold w-10 text-right">
                                {item.qty} pcs
                              </span>
                            </div>
                          ))}
                        </div>
                      )}
                    </div>
                  </div>
                </div>
              </>
            )}

            {analyticsSubTab === "revenue" && (
              <>
                {/* Profit Summary — ONLY visible when viewing All Bills */}
                {analyticsGstFilter === "all" && (
                  <div className="space-y-3 mb-6">
                    <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-4 gap-4">
                      {/* Card 1: Net Earnings (GST + Non-GST - Expenses) */}
                      {(() => {
                        const netProfit =
                          gstRevenue + nonGstRevenue - analyticsExpensesTotal;
                        const positive = netProfit >= 0;
                        const accent = positive ? "#059669" : "#B91C1C";
                        return (
                          <div
                            className="rounded-2xl p-5 shadow-sm text-white hover:shadow-md transition-all"
                            style={{
                              background: `linear-gradient(135deg, ${accent}, #18181B)`,
                            }}
                          >
                            <div className="flex justify-between items-start mb-2">
                              <span className="text-[10px] font-bold uppercase tracking-wider text-white/90">
                                Net Earnings
                              </span>
                              <div className="w-8 h-8 rounded-full bg-white/15 flex items-center justify-center">
                                <PiggyBank className="w-4 h-4 text-white" />
                              </div>
                            </div>
                            <div className="text-2xl font-black text-white">
                              {positive ? "" : "− "}₹
                              {Math.abs(netProfit).toLocaleString("en-IN", {
                                minimumFractionDigits: 2,
                                maximumFractionDigits: 2,
                              })}
                            </div>
                            <div className="text-[9px] text-white/95 font-black mt-1 tracking-wide">
                              GST + Non-GST − Expenses
                            </div>
                          </div>
                        );
                      })()}

                      {/* Card 2: GST Revenue */}
                      <div className="bg-white border border-[#4F46E5]/30 rounded-2xl p-5 shadow-sm hover:shadow-md transition-all">
                        <div className="flex justify-between items-start mb-2">
                          <span className="text-[10px] font-bold uppercase tracking-wider text-[#000000]">
                            GST Sales
                          </span>
                          <div className="w-8 h-8 rounded-full bg-[#4F46E5]/10 flex items-center justify-center">
                            <IndianRupee className="w-4 h-4 text-[#4F46E5]" />
                          </div>
                        </div>
                        <div className="text-2xl font-black text-[#4F46E5]">
                          ₹
                          {gstRevenue.toLocaleString("en-IN", {
                            minimumFractionDigits: 2,
                            maximumFractionDigits: 2,
                          })}
                        </div>
                        <div className="text-[9px] text-[#000000] font-semibold mt-1">
                          {gstOrdersCount} GST invoices
                        </div>
                      </div>

                      {/* Card 3: Non-GST Revenue */}
                      <div className="bg-white border border-[#059669]/30 rounded-2xl p-5 shadow-sm hover:shadow-md transition-all">
                        <div className="flex justify-between items-start mb-2">
                          <span className="text-[10px] font-bold uppercase tracking-wider text-[#000000]">
                            Non-GST Sales
                          </span>
                          <div className="w-8 h-8 rounded-full bg-[#059669]/10 flex items-center justify-center">
                            <TrendingUp className="w-4 h-4 text-[#059669]" />
                          </div>
                        </div>
                        <div className="text-2xl font-black text-[#059669]">
                          + ₹
                          {nonGstRevenue.toLocaleString("en-IN", {
                            minimumFractionDigits: 2,
                            maximumFractionDigits: 2,
                          })}
                        </div>
                        <div className="text-[9px] text-[#000000] font-semibold mt-1">
                          {nonGstOrdersCount} retail bills
                        </div>
                      </div>

                      {/* Card 4: Total Expenses */}
                      <div className="bg-white border border-[#B91C1C]/30 rounded-2xl p-5 shadow-sm hover:shadow-md transition-all">
                        <div className="flex justify-between items-start mb-2">
                          <span className="text-[10px] font-bold uppercase tracking-wider text-[#000000]">
                            Total Expenses
                          </span>
                          <div className="w-8 h-8 rounded-full bg-[#B91C1C]/10 flex items-center justify-center">
                            <TrendingDown className="w-4 h-4 text-[#B91C1C]" />
                          </div>
                        </div>
                        <div className="text-2xl font-black text-[#B91C1C]">
                          − ₹
                          {analyticsExpensesTotal.toLocaleString("en-IN", {
                            minimumFractionDigits: 2,
                            maximumFractionDigits: 2,
                          })}
                        </div>
                        <button
                          onClick={() => setActiveTab("expenses")}
                          className="text-[9px] text-[#B91C1C] font-bold mt-1 underline underline-offset-2 cursor-pointer hover:opacity-80 block"
                        >
                          Money out — Expense Tracker
                        </button>
                      </div>
                    </div>

                    {/* Formula Calculation Banner */}
                    <div className="bg-white border border-slate-200 rounded-xl px-4 py-2.5 shadow-xs flex flex-wrap items-center justify-between gap-2 text-xs">
                      <div className="flex items-center gap-2">
                        <span className="text-[10px] font-black uppercase tracking-wider text-indigo-700 bg-indigo-50 border border-indigo-200 px-2 py-0.5 rounded-md">
                          Calculation Formula
                        </span>
                        <span className="text-slate-600 font-semibold">
                          GST (₹
                          {gstRevenue.toLocaleString("en-IN", {
                            minimumFractionDigits: 2,
                          })}
                          ) + Non-GST (₹
                          {nonGstRevenue.toLocaleString("en-IN", {
                            minimumFractionDigits: 2,
                          })}
                          ) − Expenses (₹
                          {analyticsExpensesTotal.toLocaleString("en-IN", {
                            minimumFractionDigits: 2,
                          })}
                          )
                        </span>
                      </div>
                      <div className="flex items-center gap-1.5 font-bold">
                        <span className="text-slate-500">= Net Profit:</span>
                        <span
                          className={`font-black font-mono text-sm ${
                            gstRevenue +
                              nonGstRevenue -
                              analyticsExpensesTotal >=
                            0
                              ? "text-emerald-600"
                              : "text-rose-600"
                          }`}
                        >
                          ₹
                          {(
                            gstRevenue +
                            nonGstRevenue -
                            analyticsExpensesTotal
                          ).toLocaleString("en-IN", {
                            minimumFractionDigits: 2,
                          })}
                        </span>
                      </div>
                    </div>
                  </div>
                )}

                {/* Top 5x2 KPI Grid */}
                <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-4 gap-4 mb-4">
                  {/* Row 1 */}
                  <div className="bg-white border border-black/10 rounded-xl p-4 shadow-sm hover:shadow-md transition-all">
                    <div className="flex justify-between items-start mb-3">
                      <span className="text-[10px] font-bold uppercase tracking-wider text-[#000000]">
                        Total Revenue
                      </span>
                      <div className="w-6 h-6 rounded-full bg-[#10B981]/10 flex items-center justify-center">
                        <IndianRupee className="w-3 h-3 text-[#10B981] animate-pulse" />
                      </div>
                    </div>
                    <div className="text-xl font-black text-[#000000] mb-1">
                      ₹
                      {totalRevenueAmount.toLocaleString("en-IN", {
                        minimumFractionDigits: 2,
                        maximumFractionDigits: 2,
                      })}
                    </div>
                    <div className="text-[9px] text-[#000000] font-semibold">
                      {analyticsGstFilter === "all"
                        ? `GST (₹${gstRevenue.toLocaleString("en-IN")}) + Non-GST (₹${nonGstRevenue.toLocaleString("en-IN")})`
                        : "POS + manual combined"}
                    </div>
                  </div>

                  <div className="bg-white border border-black/10 rounded-xl p-4 shadow-sm hover:shadow-md transition-all">
                    <div className="flex justify-between items-start mb-3">
                      <span className="text-[10px] font-bold uppercase tracking-wider text-[#000000]">
                        Completed Bills
                      </span>
                      <div className="w-6 h-6 rounded-full bg-[#10B981]/10 flex items-center justify-center">
                        <Trophy className="w-3 h-3 text-[#10B981] animate-swing" />
                      </div>
                    </div>
                    <div className="text-xl font-black text-[#000000] mb-1">
                      {totalOrdersCount}
                    </div>
                    <div className="text-[9px] text-[#000000] font-semibold">
                      POS + manual bills
                    </div>
                  </div>

                  <div className="bg-white border border-black/10 rounded-xl p-4 shadow-sm hover:shadow-md transition-all">
                    <div className="flex justify-between items-start mb-3">
                      <span className="text-[10px] font-bold uppercase tracking-wider text-[#000000]">
                        Offline Bills
                      </span>
                      <div className="w-6 h-6 rounded-full bg-[#06B6D4]/10 flex items-center justify-center">
                        <IndianRupee className="w-3 h-3 text-[#06B6D4] animate-bounce" />
                      </div>
                    </div>
                    <div className="text-xl font-black text-[#000000] mb-1">
                      ₹
                      {offlineRevenue.toLocaleString("en-IN", {
                        minimumFractionDigits: 2,
                        maximumFractionDigits: 2,
                      })}
                    </div>
                    <div className="text-[9px] text-[#000000] font-semibold">
                      Walk-in POS sales
                    </div>
                  </div>

                  <div className="bg-white border border-black/10 rounded-xl p-4 shadow-sm hover:shadow-md transition-all">
                    <div className="flex justify-between items-start mb-3">
                      <span className="text-[10px] font-bold uppercase tracking-wider text-[#000000]">
                        Online Bills
                      </span>
                      <div className="w-6 h-6 rounded-full bg-[#6366F1]/10 flex items-center justify-center">
                        <IndianRupee className="w-3 h-3 text-[#6366F1] animate-float" />
                      </div>
                    </div>
                    <div className="text-xl font-black text-[#000000] mb-1">
                      ₹
                      {onlineRevenue.toLocaleString("en-IN", {
                        minimumFractionDigits: 2,
                        maximumFractionDigits: 2,
                      })}
                    </div>
                    <div className="text-[9px] text-[#000000] font-semibold">
                      Online POS sales
                    </div>
                  </div>
                </div>

                <div
                  className={`grid grid-cols-1 sm:grid-cols-2 ${
                    analyticsGstFilter === "all"
                      ? "lg:grid-cols-4"
                      : "lg:grid-cols-3"
                  } gap-4 mb-8`}
                >
                  {/* Row 2 */}
                  <div className="bg-white border border-black/10 rounded-xl p-4 shadow-sm hover:shadow-md transition-all">
                    <div className="flex justify-between items-start mb-3">
                      <span className="text-[10px] font-bold uppercase tracking-wider text-[#000000]">
                        Total Offline Bills
                      </span>
                      <div className="w-6 h-6 rounded-full bg-[#27272A]/10 flex items-center justify-center">
                        <ShoppingBag className="w-3 h-3 text-[#27272A] animate-pulse" />
                      </div>
                    </div>
                    <div className="text-xl font-black text-[#000000] mb-1">
                      {offlineOrders}
                    </div>
                    <div className="text-[9px] text-[#000000] font-semibold">
                      Walk-in POS orders
                    </div>
                  </div>

                  <div className="bg-white border border-black/10 rounded-xl p-4 shadow-sm hover:shadow-md transition-all">
                    <div className="flex justify-between items-start mb-3">
                      <span className="text-[10px] font-bold uppercase tracking-wider text-[#000000]">
                        Total Online Bills
                      </span>
                      <div className="w-6 h-6 rounded-full bg-[#6366F1]/10 flex items-center justify-center">
                        <Globe className="w-3 h-3 text-[#6366F1] animate-float" />
                      </div>
                    </div>
                    <div className="text-xl font-black text-[#000000] mb-1">
                      {onlineOrders}
                    </div>
                    <div className="text-[9px] text-[#000000] font-semibold">
                      Online channel orders
                    </div>
                  </div>

                  <div className="bg-white border border-black/10 rounded-xl p-4 shadow-sm hover:shadow-md transition-all">
                    <div className="flex justify-between items-start mb-3">
                      <span className="text-[10px] font-bold uppercase tracking-wider text-[#000000]">
                        Total Items Sold
                      </span>
                      <div className="w-6 h-6 rounded-full bg-[#8B5CF6]/10 flex items-center justify-center">
                        <Package className="w-3 h-3 text-[#8B5CF6] animate-pop" />
                      </div>
                    </div>
                    <div className="text-xl font-black text-[#000000] mb-1">
                      {totalItemsSold}
                    </div>
                    <div className="text-[9px] text-[#000000] font-semibold">
                      From completed bills
                    </div>
                  </div>

                  {/* Top Product - only shown in All Bills; omitted in GST and Non-GST */}
                  {analyticsGstFilter === "all" && (
                    <div className="bg-white border border-black/10 rounded-xl p-4 shadow-sm hover:shadow-md transition-all">
                      <div className="flex justify-between items-start mb-3">
                        <span className="text-[10px] font-bold uppercase tracking-wider text-[#000000]">
                          Top Product
                        </span>
                        <div className="w-6 h-6 rounded-full bg-[#EC4899]/10 flex items-center justify-center">
                          <Trophy className="w-3 h-3 text-[#EC4899] animate-pop" />
                        </div>
                      </div>
                      <div
                        className="text-xl font-black text-[#000000] mb-1 truncate"
                        title={topProduct}
                      >
                        {topProduct}
                      </div>
                      <div className="text-[9px] text-[#000000] font-semibold">
                        Most sold item
                      </div>
                    </div>
                  )}
                </div>

                {/* Main Charts & Breakdowns */}
                <div className="flex flex-col lg:grid lg:grid-cols-12 gap-6">
                  {/* Left Chart Column */}
                  <div className="col-span-8 w-full flex flex-col gap-6">
                    {/* Monthly Revenue Trend Chart */}
                    <div className="bg-white border border-black/10 rounded-xl p-6 shadow-sm hover:shadow-md transition-all flex flex-col min-h-[300px]">
                      <div className="flex justify-between items-center mb-6">
                        <div>
                          <h3 className="font-bold text-[#000000] text-sm mb-2 flex items-center">
                            Revenue Trend This Year{" "}
                            <span className="text-[#3F3F46] font-black ml-1.5">
                              {now.getFullYear()}
                            </span>
                          </h3>
                          <div className="flex items-center gap-3">
                            <span className="text-xl font-black text-[#000000]">
                              ₹{totalYearRevenue.toLocaleString()}
                            </span>
                            {avgMonthRevenue > 0 && (
                              <span className="bg-[#FFFFFF] border border-black/10 text-[#3F3F46] px-2 py-0.5 rounded text-[10px] font-bold">
                                Avg ₹
                                {Math.round(avgMonthRevenue).toLocaleString()}
                                /mo
                              </span>
                            )}
                          </div>
                        </div>
                      </div>

                      {orders.length === 0 ? (
                        <div className="flex-1 flex items-center justify-center text-[#000000] text-sm font-semibold">
                          Process orders to see yearly revenue trend.
                        </div>
                      ) : (
                        <div className="flex-1 overflow-x-auto scrollbar-thin pb-2">
                          <div className="flex items-end justify-between px-2 gap-1 relative mt-4 min-w-[500px] h-[170px] pt-10">
                            {monthNames.map((month, i) => (
                              <div
                                key={month}
                                className="flex flex-col items-center gap-1.5 w-full group/bar relative outline-none"
                                tabIndex={0}
                              >
                                {/* Monthly sales text on top for mobile/visibility */}
                                <span className="text-[8px] font-black text-[#3F3F46] h-3 flex items-end">
                                  {monthRevenue[i] > 0
                                    ? monthRevenue[i] >= 1000
                                      ? `₹${(monthRevenue[i] / 1000).toFixed(1)}k`
                                      : `₹${monthRevenue[i]}`
                                    : ""}
                                </span>

                                {/* Tooltip */}
                                <div className="absolute bottom-full mb-2 left-1/2 -translate-x-1/2 bg-[#000000] text-white text-[10px] font-bold px-2 py-1.5 rounded-lg opacity-0 group-hover/bar:opacity-100 group-focus/bar:opacity-100 transition-all duration-200 whitespace-nowrap pointer-events-none z-10 shadow-lg">
                                  <div className="text-[9px] text-white/70 font-semibold mb-0.5">
                                    {monthNames[i]}
                                  </div>
                                  ₹{(monthRevenue[i] || 0).toLocaleString()}
                                  <div className="absolute top-full left-1/2 -translate-x-1/2 border-4 border-transparent border-t-[#000000]"></div>
                                </div>
                                <div
                                  className="w-full max-w-[24px] bg-[#4F46E5] rounded-t-sm transition-all duration-1000 group-hover/bar:bg-[#818CF8] cursor-pointer min-h-[4px]"
                                  style={{
                                    height: `${Math.max(4, (monthRevenue[i] / maxMonthRevenue) * 100)}px`,
                                  }}
                                />
                                <span className="text-[10px] font-bold text-[#000000] uppercase">
                                  {month}
                                </span>
                              </div>
                            ))}
                          </div>
                        </div>
                      )}
                    </div>

                    {/* Weekly Revenue Bar Chart */}
                    <div className="bg-white border border-black/10 rounded-xl p-6 shadow-sm hover:shadow-md transition-all flex flex-col min-h-[250px]">
                      <div className="flex justify-between items-center mb-6">
                        <div>
                          <h3 className="font-bold text-[#000000] text-sm flex items-center">
                            Revenue This Week{" "}
                            <span className="text-[#3F3F46] font-black ml-1.5">
                              (Week {currentWeekNumber} of {now.getFullYear()})
                            </span>
                          </h3>
                          <p className="text-[10px] text-[#000000] font-semibold mt-1">
                            ₹
                            {weekRevenue
                              .reduce((a, b) => a + b, 0)
                              .toLocaleString()}{" "}
                            total
                          </p>
                        </div>
                      </div>

                      {orders.length === 0 ? (
                        <div className="flex-1 flex items-center justify-center text-[#000000] text-sm font-semibold">
                          Process orders to see weekly revenue.
                        </div>
                      ) : (
                        <div className="flex-1 flex items-end justify-between px-2 gap-2">
                          {dayNames.map((day, i) => (
                            <div
                              key={day}
                              className="flex flex-col items-center gap-3 w-full group/bar relative outline-none"
                              tabIndex={0}
                            >
                              <span className="text-[9px] font-black text-[#3F3F46]">
                                {weekRevenue[i] > 0
                                  ? `₹${weekRevenue[i] >= 1000 ? (weekRevenue[i] / 1000).toFixed(1) + "k" : weekRevenue[i]}`
                                  : ""}
                              </span>

                              {/* Tooltip for exact weekly revenue */}
                              <div className="absolute bottom-[52px] mb-2 left-1/2 -translate-x-1/2 bg-[#000000] text-white text-[10px] font-bold px-2 py-1.5 rounded-lg opacity-0 group-hover/bar:opacity-100 group-focus/bar:opacity-100 transition-all duration-200 whitespace-nowrap pointer-events-none z-10 shadow-lg">
                                <div className="text-[9px] text-white/70 font-semibold mb-0.5">
                                  {dayNames[i]}
                                </div>
                                ₹{(weekRevenue[i] || 0).toLocaleString()}
                                <div className="absolute top-full left-1/2 -translate-x-1/2 border-4 border-transparent border-t-[#000000]"></div>
                              </div>

                              <div className="w-full max-w-[20px] h-32 bg-[#F3F4F6] rounded-full relative overflow-hidden cursor-pointer">
                                <div
                                  className="absolute bottom-0 w-full bg-[#4F46E5] rounded-full transition-all duration-1000 group-hover/bar:bg-[#818CF8]"
                                  style={{
                                    height: `${(weekRevenue[i] / maxWeekRevenue) * 100}%`,
                                  }}
                                />
                              </div>
                              <span className="text-[10px] font-bold text-[#000000] uppercase">
                                {day}
                              </span>
                            </div>
                          ))}
                        </div>
                      )}
                    </div>
                  </div>

                  {/* Right Column (Breakdowns) */}
                  <div className="col-span-4 w-full flex flex-col gap-6">
                    {/* Order Source Breakdown */}
                    <div className="bg-white border border-black/10 rounded-xl p-6 shadow-sm hover:shadow-md transition-all">
                      <h3 className="font-bold text-[#000000] mb-4 text-sm">
                        Order Source
                      </h3>
                      {totalOrdersCount === 0 ? (
                        <div className="text-center text-[#000000] text-sm font-semibold py-6">
                          No orders yet.
                        </div>
                      ) : (
                        <>
                          <div className="flex items-center gap-3 mb-4">
                            <span className="text-[10px] font-bold text-[#27272A] uppercase tracking-wider w-14">
                              Offline
                            </span>
                            <div className="flex-1 h-2.5 bg-[#F3F4F6] rounded-full overflow-hidden">
                              <div
                                className="h-full bg-[#27272A] rounded-full transition-all duration-700"
                                style={{
                                  width: `${(offlineOrders / totalOrdersCount) * 100}%`,
                                }}
                              />
                            </div>
                            <span className="text-[11px] font-black text-[#000000] w-8 text-right">
                              {offlineOrders}
                            </span>
                          </div>
                          <div className="flex items-center gap-3">
                            <span className="text-[10px] font-bold text-[#00A86B] uppercase tracking-wider w-14">
                              Online
                            </span>
                            <div className="flex-1 h-2.5 bg-[#F3F4F6] rounded-full overflow-hidden">
                              <div
                                className="h-full bg-[#00A86B] rounded-full transition-all duration-700"
                                style={{
                                  width: `${(onlineOrders / totalOrdersCount) * 100}%`,
                                }}
                              />
                            </div>
                            <span className="text-[11px] font-black text-[#000000] w-8 text-right">
                              {onlineOrders}
                            </span>
                          </div>
                        </>
                      )}
                    </div>

                    {/* Top Items by Revenue */}
                    <div className="bg-white border border-black/10 rounded-xl p-6 shadow-sm hover:shadow-md transition-all flex-1">
                      <h3 className="font-bold text-[#000000] text-sm mb-4">
                        Top Items by Revenue
                      </h3>
                      {topItems.length === 0 ? (
                        <div className="text-center text-[#000000] text-sm font-semibold py-6">
                          No items sold yet.
                        </div>
                      ) : (
                        <div className="space-y-4">
                          {topItems.map((item, idx) => (
                            <div
                              key={item.name}
                              className="flex items-center gap-3"
                            >
                              <span className="text-[11px] font-black text-[#000000] w-4">
                                {idx + 1}
                              </span>
                              <div className="flex-1">
                                <div className="flex justify-between items-center mb-1.5">
                                  <span className="text-xs font-bold text-[#000000]">
                                    {item.name}
                                  </span>
                                  <span className="text-xs font-black text-[#3F3F46]">
                                    ₹{item.revenue.toLocaleString()}
                                  </span>
                                </div>
                                <div className="h-1.5 bg-[#F3F4F6] rounded-full overflow-hidden">
                                  <div
                                    className="h-full bg-[#4F46E5] rounded-full transition-all duration-700"
                                    style={{
                                      width: `${(item.revenue / topItems[0].revenue) * 100}%`,
                                    }}
                                  />
                                </div>
                              </div>
                              <span className="text-[10px] text-[#000000] font-semibold w-10 text-right">
                                {item.qty} pcs
                              </span>
                            </div>
                          ))}
                        </div>
                      )}
                    </div>
                  </div>
                </div>
              </>
            )}

            {analyticsSubTab === "products" && (
              <div className="bg-white border border-black/10 rounded-xl p-6 shadow-sm">
                <p className="mb-4 text-[11px] font-bold text-[#B91C1C] bg-[#FEE2E2] border border-[#FCA5A5] rounded-lg px-3 py-2.5">
                  <span className="font-black">Note:</span> Whether you pick All, GST or Non-GST
                  bills, these figures show only the product value (price × qty). GST is not
                  included.
                </p>
                <div className="flex flex-col sm:flex-row justify-between items-start sm:items-center gap-4 mb-4">
                  <h3 className="font-bold text-[#000000] text-sm">
                    Product Sales Leaderboard
                  </h3>

                  <div className="flex flex-wrap items-center gap-2 w-full sm:w-auto">
                  {/* Product Search Input */}
                  <div className="flex items-center border border-black/10 bg-[#FFFFFF] rounded-lg px-3 py-1.5 gap-2 shadow-xs w-full sm:w-auto animate-in fade-in duration-200">
                    <Search className="w-3.5 h-3.5 text-[#000000]" />
                    <input
                      type="text"
                      placeholder="Search product..."
                      className="text-xs font-semibold bg-transparent border-none outline-none focus:ring-0 text-[#000000] placeholder:text-[#000000]/50 w-full sm:w-[180px]"
                      value={productSearchQuery}
                      onChange={(e) => setProductSearchQuery(e.target.value)}
                    />
                  </div>
                  <button
                    onClick={exportAnalyticsProductsCSV}
                    className="text-[10px] font-bold text-[#000000] bg-white hover:bg-[#F4F4F5] border border-black/10 px-3 py-2 rounded-lg uppercase tracking-wider flex items-center gap-1.5 transition-colors cursor-pointer"
                  >
                    <Download className="w-3.5 h-3.5 text-[#3F3F46]" /> Export CSV
                  </button>
                  </div>
                </div>

                {Object.keys(productSalesExGst).length === 0 ? (
                  <div className="text-center text-[#000000] text-sm font-semibold py-12">
                    No products sold in this period.
                  </div>
                ) : (
                  <div className="overflow-x-auto">
                    <table className="w-full text-left border-collapse">
                      <thead>
                        <tr className="bg-[#FFFFFF] border-b border-black/10">
                          <th className="p-3 text-[10px] font-bold text-[#000000] uppercase tracking-wider">
                            Rank
                          </th>
                          <th className="p-3 text-[10px] font-bold text-[#000000] uppercase tracking-wider">
                            Product Name
                          </th>
                          <th className="p-3 text-[10px] font-bold text-[#000000] uppercase tracking-wider text-right">
                            Qty Sold
                          </th>
                          <th className="p-3 text-[10px] font-bold text-[#000000] uppercase tracking-wider text-right">
                            Revenue
                          </th>
                          <th className="p-3 text-[10px] font-bold text-[#000000] uppercase tracking-wider">
                            Market Share
                          </th>
                        </tr>
                      </thead>
                      <tbody>
                        {Object.values(productSalesExGst).filter((item) =>
                          item.name
                            .toLowerCase()
                            .includes(productSearchQuery.toLowerCase()),
                        ).length === 0 ? (
                          <tr>
                            <td
                              colSpan={5}
                              className="text-center py-12 text-sm font-semibold text-[#000000]"
                            >
                              No matching products found.
                            </td>
                          </tr>
                        ) : (
                          Object.values(productSalesExGst)
                            .filter((item) =>
                              item.name
                                .toLowerCase()
                                .includes(productSearchQuery.toLowerCase()),
                            )
                            .sort((a, b) => b.revenue - a.revenue)
                            .map((item, idx) => {
                              const productsTotal = Object.values(productSalesExGst).reduce(
                                (acc, i) => acc + i.revenue,
                                0,
                              );
                              const share =
                                productsTotal > 0
                                  ? (item.revenue / productsTotal) * 100
                                  : 0;
                              return (
                                <tr
                                  key={item.name}
                                  className="border-b border-transparent hover:bg-[#FFFFFF]/50 transition-colors"
                                >
                                  <td className="p-3 text-xs font-black text-[#000000]">
                                    {idx + 1}
                                  </td>
                                  <td className="p-3 text-xs font-bold text-[#000000]">
                                    {item.name}
                                  </td>
                                  <td className="p-3 text-xs font-bold text-[#000000] text-right">
                                    {item.qty} pcs
                                  </td>
                                  <td className="p-3 text-xs font-black text-[#3F3F46] text-right">
                                    ₹{item.revenue.toLocaleString()}
                                  </td>
                                  <td className="p-3 w-1/4">
                                    <div className="flex items-center gap-3">
                                      <div className="flex-1 h-2 bg-[#F3F4F6] rounded-full overflow-hidden">
                                        <div
                                          className="h-full bg-[#4F46E5] rounded-full"
                                          style={{ width: `${share}%` }}
                                        />
                                      </div>
                                      <span className="text-[10px] font-bold text-[#000000] w-8">
                                        {share.toFixed(1)}%
                                      </span>
                                    </div>
                                  </td>
                                </tr>
                              );
                            })
                        )}
                      </tbody>
                    </table>
                  </div>
                )}
              </div>
            )}

            {analyticsSubTab === "coupons" && (
              <div className="flex flex-col lg:grid lg:grid-cols-3 gap-6">
                <div className="col-span-1 w-full bg-white border border-black/10 rounded-xl p-6 shadow-sm flex flex-col gap-6">
                  <h3 className="font-bold text-[#000000] text-sm">
                    Discount Summary
                  </h3>

                  <div className="p-4 bg-[#FFFFFF] border border-black/10 rounded-lg">
                    <div className="flex justify-between items-center mb-1">
                      <span className="text-[10px] font-bold uppercase tracking-wider text-[#000000]">
                        Total Discounts Given
                      </span>
                      <Percent className="w-4 h-4 text-[#3F3F46]" />
                    </div>
                    <span className="text-2xl font-black text-[#3F3F46]">
                      ₹
                      {analyticsFilteredOrders
                        .reduce((acc, o) => acc + o.discount, 0)
                        .toLocaleString()}
                    </span>
                  </div>

                  <div className="p-4 bg-[#FFFFFF] border border-black/10 rounded-lg">
                    <div className="flex justify-between items-center mb-1">
                      <span className="text-[10px] font-bold uppercase tracking-wider text-[#000000]">
                        Discounted Orders
                      </span>
                      <Calendar className="w-4 h-4 text-tertiary" />
                    </div>
                    <span className="text-2xl font-black text-[#000000]">
                      {
                        analyticsFilteredOrders.filter((o) => o.discount > 0)
                          .length
                      }
                    </span>
                  </div>

                  <div className="p-4 bg-[#FFFFFF] border border-black/10 rounded-lg">
                    <div className="flex justify-between items-center mb-1">
                      <span className="text-[10px] font-bold uppercase tracking-wider text-[#000000]">
                        Avg Discount Per Order
                      </span>
                      <IndianRupee className="w-4 h-4 text-[#10B981]" />
                    </div>
                    <span className="text-2xl font-black text-[#000000]">
                      ₹
                      {Math.round(
                        analyticsFilteredOrders.filter((o) => o.discount > 0)
                          .length > 0
                          ? analyticsFilteredOrders.reduce(
                              (acc, o) => acc + o.discount,
                              0,
                            ) /
                              analyticsFilteredOrders.filter(
                                (o) => o.discount > 0,
                              ).length
                          : 0,
                      ).toLocaleString()}
                    </span>
                  </div>
                </div>

                <div className="col-span-2 w-full bg-white border border-black/10 rounded-xl p-6 shadow-sm">
                  <div className="flex flex-col sm:flex-row justify-between items-start sm:items-center gap-4 mb-4">
                    <h3 className="font-bold text-[#000000] text-sm">
                      Promo Campaign Performance
                    </h3>

                    {/* Coupons Search Input */}
                    <div className="flex items-center border border-black/10 bg-[#FFFFFF] rounded-lg px-3 py-1.5 gap-2 shadow-xs w-full sm:w-auto animate-in fade-in duration-200">
                      <Search className="w-3.5 h-3.5 text-[#000000]" />
                      <input
                        type="text"
                        placeholder="Search code/mobile/amount..."
                        className="text-xs font-semibold bg-transparent border-none outline-none focus:ring-0 text-[#000000] placeholder:text-[#000000]/50 w-full sm:w-[220px]"
                        value={couponSearchQuery}
                        onChange={(e) => setCouponSearchQuery(e.target.value)}
                      />
                    </div>
                  </div>

                  {analyticsFilteredOrders.filter((o) => o.discount > 0)
                    .length === 0 ? (
                    <div className="text-center text-[#000000] text-sm font-semibold py-12">
                      No promotional discounts given in this period.
                    </div>
                  ) : (
                    <div className="overflow-x-auto">
                      <table className="w-full text-left border-collapse">
                        <thead>
                          <tr className="bg-[#FFFFFF] border-b border-black/10">
                            <th className="p-3 text-[10px] font-bold text-[#000000] uppercase tracking-wider">
                              Transaction ID
                            </th>
                            <th className="p-3 text-[10px] font-bold text-[#000000] uppercase tracking-wider">
                              Customer Mobile
                            </th>
                            <th className="p-3 text-[10px] font-bold text-[#000000] uppercase tracking-wider text-right">
                              Order Total
                            </th>
                            <th className="p-3 text-[10px] font-bold text-[#000000] uppercase tracking-wider text-right">
                              Discount Applied
                            </th>
                          </tr>
                        </thead>
                        <tbody>
                          {analyticsFilteredOrders
                            .filter((o) => o.discount > 0)
                            .filter((o) => {
                              const q = couponSearchQuery.toLowerCase();
                              const couponCode =
                                getCouponCodeForOrder(o).toLowerCase();
                              return (
                                o.id.toLowerCase().includes(q) ||
                                couponCode.includes(q) ||
                                (o.customerPhone || "").includes(q) ||
                                o.discount.toString().includes(q) ||
                                o.grandTotal.toString().includes(q)
                              );
                            }).length === 0 ? (
                            <tr>
                              <td
                                colSpan={4}
                                className="text-center py-12 text-sm font-semibold text-[#000000]"
                              >
                                No matching coupon performance records found.
                              </td>
                            </tr>
                          ) : (
                            analyticsFilteredOrders
                              .filter((o) => o.discount > 0)
                              .filter((o) => {
                                const q = couponSearchQuery.toLowerCase();
                                const couponCode =
                                  getCouponCodeForOrder(o).toLowerCase();
                                return (
                                  o.id.toLowerCase().includes(q) ||
                                  couponCode.includes(q) ||
                                  (o.customerPhone || "").includes(q) ||
                                  o.discount.toString().includes(q) ||
                                  o.grandTotal.toString().includes(q)
                                );
                              })
                              .map((order) => (
                                <tr
                                  key={order.id}
                                  className="border-b border-transparent hover:bg-[#FFFFFF]/50 transition-colors"
                                >
                                  <td className="p-3 text-xs font-semibold text-[#000000]">
                                    {order.id}
                                  </td>
                                  <td className="p-3 text-xs font-mono font-bold text-[#000000]">
                                    {order.customerPhone || "-"}
                                  </td>
                                  <td className="p-3 text-xs font-bold text-right text-[#000000]">
                                    ₹{order.grandTotal.toLocaleString()}
                                  </td>
                                  <td className="p-3 text-xs font-black text-[#27272A] text-right">
                                    -₹{order.discount.toLocaleString()}
                                  </td>
                                </tr>
                              ))
                          )}
                        </tbody>
                      </table>
                    </div>
                  )}
                </div>
              </div>
            )}
          </div>
        )}

        {role && activeTab === "expenses" && (
          <div className="flex-1 flex flex-col max-w-[1400px] mx-auto w-full pb-8 pr-2 animate-in fade-in duration-300">
            {/* Header */}
            <div className="flex flex-col lg:flex-row justify-between items-start lg:items-center gap-4 mb-6">
              <div>
                <h2 className="text-[28px] font-black text-[#000000] tracking-tight flex items-center gap-3">
                  <Wallet className="w-7 h-7 text-[#3F3F46]" />
                  Expense Tracker
                </h2>
                <p className="text-xs text-[#000000] font-semibold mt-1">
                  Record what the shop spends. Expenses are offset against sales
                  to show your real Net Profit on the dashboard.
                </p>
              </div>
              {/* Period filter */}
              <div className="flex flex-wrap items-center gap-1.5 bg-[#FAFAFA] border border-black/10 rounded-xl p-1">
                {(
                  [
                    ["today", "Today"],
                    ["week", "Week"],
                    ["month", "Month"],
                    ["year", "Year"],
                    ["all", "All"],
                    ["custom", "Custom"],
                  ] as [PeriodKey, string][]
                ).map(([key, label]) => (
                  <button
                    key={key}
                    onClick={() => setExpensePeriod(key)}
                    className={`px-3 py-1.5 rounded-lg text-[10px] font-bold uppercase tracking-wider transition-colors cursor-pointer ${
                      expensePeriod === key
                        ? "bg-[#3F3F46] text-white shadow-sm"
                        : "text-[#000000] hover:bg-black/5"
                    }`}
                  >
                    {label}
                  </button>
                ))}
              </div>
            </div>

            {expensePeriod === "custom" && (
              <div className="flex flex-wrap items-end gap-3 mb-6 bg-white border border-black/10 rounded-xl p-4">
                <div>
                  <label className="block text-[10px] font-bold uppercase tracking-wider text-[#000000] mb-1">
                    From
                  </label>
                  <input
                    type="date"
                    value={expenseStartDate}
                    onChange={(e) => setExpenseStartDate(e.target.value)}
                    className="bg-[#FAFAFA] border border-black/10 rounded-lg px-3 py-2 text-sm text-[#000000] focus:outline-none focus:border-[#3F3F46]"
                  />
                </div>
                <div>
                  <label className="block text-[10px] font-bold uppercase tracking-wider text-[#000000] mb-1">
                    To
                  </label>
                  <input
                    type="date"
                    value={expenseEndDate}
                    onChange={(e) => setExpenseEndDate(e.target.value)}
                    className="bg-[#FAFAFA] border border-black/10 rounded-lg px-3 py-2 text-sm text-[#000000] focus:outline-none focus:border-[#3F3F46]"
                  />
                </div>
              </div>
            )}

            {/* Summary cards */}
            <div className="grid grid-cols-1 sm:grid-cols-3 gap-4 mb-6">
              <div className="rounded-2xl p-5 shadow-sm text-white bg-gradient-to-br from-[#3F3F46] to-[#18181B]">
                <div className="flex justify-between items-start mb-2">
                  <span className="text-[10px] font-bold uppercase tracking-wider text-white/90">
                    Total Expenses
                  </span>
                  <div className="w-8 h-8 rounded-full bg-white/15 flex items-center justify-center">
                    <Coins className="w-4 h-4 text-white" />
                  </div>
                </div>
                <div className="text-2xl font-black">
                  ₹
                  {expenseStats.total.toLocaleString("en-IN", {
                    minimumFractionDigits: 2,
                    maximumFractionDigits: 2,
                  })}
                </div>
                <div className="text-[9px] text-white/80 font-semibold mt-1 uppercase tracking-wider">
                  {expensePeriod} period
                </div>
              </div>
              <div className="bg-white border border-black/10 rounded-2xl p-5 shadow-sm">
                <div className="flex justify-between items-start mb-2">
                  <span className="text-[10px] font-bold uppercase tracking-wider text-[#000000]">
                    Entries
                  </span>
                  <div className="w-8 h-8 rounded-full bg-tertiary/10 flex items-center justify-center">
                    <Receipt className="w-4 h-4 text-tertiary" />
                  </div>
                </div>
                <div className="text-2xl font-black text-[#000000]">
                  {expenseStats.count}
                </div>
                <div className="text-[9px] text-[#000000] font-semibold mt-1">
                  Expenses recorded
                </div>
              </div>
              <div className="bg-white border border-black/10 rounded-2xl p-5 shadow-sm">
                <div className="flex justify-between items-start mb-2">
                  <span className="text-[10px] font-bold uppercase tracking-wider text-[#000000]">
                    Top Category
                  </span>
                  <div className="w-8 h-8 rounded-full bg-tertiary/10 flex items-center justify-center">
                    <Tag className="w-4 h-4 text-tertiary" />
                  </div>
                </div>
                <div className="text-lg font-black text-[#000000] truncate">
                  {expenseStats.topCategory}
                </div>
                <div className="text-[9px] text-[#000000] font-semibold mt-1">
                  Highest spend
                </div>
              </div>
            </div>

            {/* Two-column: add form + category breakdown */}
            <div className="grid grid-cols-1 lg:grid-cols-5 gap-6 mb-6">
              {/* Add expense form */}
              <div
                className={`lg:col-span-2 bg-white border ${editingExpenseId ? "border-[#3F3F46]" : "border-black/10"} rounded-2xl p-5 shadow-sm h-fit`}
              >
                <h3 className="text-sm font-black text-[#000000] uppercase tracking-wider flex items-center gap-2 mb-4">
                  <span className="w-1.5 h-6 bg-[#3F3F46] rounded-full" />
                  {editingExpenseId ? "Edit Expense" : "Add Expense"}
                </h3>
                <div className="space-y-3">
                  <div>
                    <label className="block text-[10px] font-bold uppercase tracking-wider text-[#000000] mb-1">
                      What for?
                    </label>
                    <input
                      type="text"
                      value={expTitle}
                      onChange={(e) => setExpTitle(e.target.value)}
                      placeholder="e.g. October shop rent"
                      className="w-full bg-[#FAFAFA] border border-black/10 rounded-lg px-3 py-2 text-sm text-[#000000] focus:outline-none focus:border-[#3F3F46] placeholder:text-black/30"
                    />
                  </div>
                  <div className="grid grid-cols-2 gap-3">
                    <div>
                      <label className="block text-[10px] font-bold uppercase tracking-wider text-[#000000] mb-1">
                        Amount (₹)
                      </label>
                      <input
                        type="number"
                        min="0"
                        step="0.01"
                        value={expAmount}
                        onChange={(e) =>
                          setExpAmount(
                            e.target.value === ""
                              ? ""
                              : parseFloat(e.target.value),
                          )
                        }
                        placeholder="0.00"
                        className="w-full bg-[#FAFAFA] border border-black/10 rounded-lg px-3 py-2 text-sm text-[#000000] focus:outline-none focus:border-[#3F3F46] placeholder:text-black/30"
                      />
                    </div>
                    <div>
                      <label className="block text-[10px] font-bold uppercase tracking-wider text-[#000000] mb-1">
                        Date
                      </label>
                      <input
                        type="date"
                        value={expDate}
                        onChange={(e) => setExpDate(e.target.value)}
                        className="w-full bg-[#FAFAFA] border border-black/10 rounded-lg px-3 py-2 text-sm text-[#000000] focus:outline-none focus:border-[#3F3F46]"
                      />
                    </div>
                  </div>
                  <div>
                    <label className="block text-[10px] font-bold uppercase tracking-wider text-[#000000] mb-1">
                      Category
                    </label>
                    <ExpenseCategoryPicker
                      categories={expenseCategories}
                      value={expCategory}
                      usage={expenseCountByCategory}
                      canManage={role === "admin"}
                      onSelect={setExpCategory}
                      onCreated={handleExpenseCategoryCreated}
                      onRenamed={handleExpenseCategoryRenamed}
                      onDeleted={handleExpenseCategoryDeleted}
                    />
                  </div>
                  <div>
                    <label className="block text-[10px] font-bold uppercase tracking-wider text-[#000000] mb-1">
                      Paid via
                    </label>
                    <select
                      value={expPaymentMode}
                      onChange={(e) => setExpPaymentMode(e.target.value)}
                      className="w-full bg-[#FAFAFA] border border-black/10 rounded-lg px-3 py-2 text-sm text-[#000000] focus:outline-none focus:border-[#3F3F46] cursor-pointer"
                    >
                      {EXPENSE_PAYMENT_MODES.map((m) => (
                        <option key={m} value={m}>
                          {m}
                        </option>
                      ))}
                    </select>
                  </div>
                  <div>
                    <label className="block text-[10px] font-bold uppercase tracking-wider text-[#000000] mb-1">
                      Notes (optional)
                    </label>
                    <input
                      type="text"
                      value={expNotes}
                      onChange={(e) => setExpNotes(e.target.value)}
                      placeholder="Reference / supplier / bill no."
                      className="w-full bg-[#FAFAFA] border border-black/10 rounded-lg px-3 py-2 text-sm text-[#000000] focus:outline-none focus:border-[#3F3F46] placeholder:text-black/30"
                    />
                  </div>
                  <button
                    onClick={handleAddExpense}
                    disabled={isSavingExpense}
                    className="w-full mt-1 bg-[#3F3F46] hover:bg-[#27272A] disabled:opacity-60 text-white py-3 rounded-lg font-black text-[11px] uppercase tracking-[0.1em] flex items-center justify-center gap-2 transition-transform active:scale-[0.98] shadow-sm cursor-pointer"
                  >
                    {editingExpenseId ? <Check className="w-4 h-4" /> : <Plus className="w-4 h-4" />}
                    {isSavingExpense ? "Saving…" : editingExpenseId ? "Save Changes" : "Add Expense"}
                  </button>
                  {editingExpenseId && (
                    <button
                      onClick={handleCancelEditExpense}
                      disabled={isSavingExpense}
                      className="w-full border border-black/10 hover:bg-black/5 text-[#000000] py-3 rounded-lg font-black text-[11px] uppercase tracking-[0.1em] cursor-pointer"
                    >
                      Cancel
                    </button>
                  )}
                </div>
              </div>

              {/* Category breakdown */}
              <div className="lg:col-span-3 bg-white border border-black/10 rounded-2xl p-5 shadow-sm">
                <h3 className="text-sm font-black text-[#000000] uppercase tracking-wider flex items-center gap-2 mb-4">
                  <span className="w-1.5 h-6 bg-[#3F3F46] rounded-full" />
                  Spend by Category
                </h3>
                {expenseStats.categoryBreakdown.length === 0 ? (
                  <div className="py-12 text-center">
                    <div className="w-14 h-14 rounded-full bg-tertiary/10 flex items-center justify-center mx-auto mb-4">
                      <PiggyBank className="w-7 h-7 text-tertiary" />
                    </div>
                    <p className="text-sm font-bold text-[#000000]">
                      No expenses in this period yet.
                    </p>
                    <p className="text-xs font-semibold text-[#000000]/60 mt-1">
                      Add your first expense to see the breakdown.
                    </p>
                  </div>
                ) : (
                  <div className="space-y-3">
                    {expenseStats.categoryBreakdown.map((row) => {
                      const max = expenseStats.categoryBreakdown[0].amount || 1;
                      const pct = expenseStats.total
                        ? (row.amount / expenseStats.total) * 100
                        : 0;
                      return (
                        <div key={row.category}>
                          <div className="flex justify-between items-center mb-1">
                            <span className="text-xs font-bold text-[#000000] flex items-center gap-1.5">
                              <Tag className="w-3 h-3 text-tertiary" />
                              {row.category}
                            </span>
                            <span className="text-xs font-black text-[#000000]">
                              ₹
                              {row.amount.toLocaleString("en-IN", {
                                minimumFractionDigits: 2,
                                maximumFractionDigits: 2,
                              })}
                              <span className="text-[10px] font-bold text-[#000000]/50 ml-1.5">
                                {pct.toFixed(0)}%
                              </span>
                            </span>
                          </div>
                          <div className="h-2.5 bg-black/5 rounded-full overflow-hidden">
                            <div
                              className="h-full bg-[#52525B] rounded-full transition-all duration-700"
                              style={{ width: `${(row.amount / max) * 100}%` }}
                            />
                          </div>
                        </div>
                      );
                    })}
                  </div>
                )}
              </div>
            </div>

            {/* Expenses list */}
            <div className="bg-white border border-black/10 rounded-2xl shadow-sm overflow-hidden">
              <div className="flex flex-col sm:flex-row justify-between items-start sm:items-center gap-3 p-4 border-b border-black/10">
                <h3 className="text-sm font-black text-[#000000] uppercase tracking-wider flex items-center gap-2">
                  <List className="w-4 h-4 text-[#3F3F46]" />
                  Expense Log
                </h3>
                <div className="flex flex-wrap items-center gap-2">
                  <select
                    value={expenseCategoryFilter}
                    onChange={(e) => setExpenseCategoryFilter(e.target.value)}
                    className="bg-[#FAFAFA] border border-black/10 rounded-lg px-3 py-2 text-xs font-bold text-[#000000] focus:outline-none focus:border-[#3F3F46] cursor-pointer"
                  >
                    <option value="ALL">All categories</option>
                    {expenseStats.allCategories.map((c) => (
                      <option key={c} value={c}>
                        {c}
                      </option>
                    ))}
                  </select>
                  <select
                    value={`${expenseSortField}_${expenseSortOrder}`}
                    onChange={(e) => {
                      const [f, o] = e.target.value.split("_") as [any, "asc" | "desc"];
                      setExpenseSortField(f);
                      setExpenseSortOrder(o);
                    }}
                    className="bg-[#FAFAFA] border border-black/10 rounded-lg px-3 py-2 text-xs font-bold text-[#000000] focus:outline-none focus:border-[#3F3F46] cursor-pointer"
                  >
                    <option value="date_desc">Date: Newest First</option>
                    <option value="date_asc">Date: Oldest First</option>
                    <option value="amount_desc">Amount: Highest First</option>
                    <option value="amount_asc">Amount: Lowest First</option>
                    <option value="title_asc">Title: A to Z</option>
                    <option value="title_desc">Title: Z to A</option>
                    <option value="category_asc">Category: A to Z</option>
                    <option value="payment_mode_asc">Payment: A to Z</option>
                  </select>
                  <div className="relative">
                    <Search className="w-3.5 h-3.5 text-black/30 absolute left-3 top-1/2 -translate-y-1/2" />
                    <input
                      type="text"
                      value={expenseSearch}
                      onChange={(e) => setExpenseSearch(e.target.value)}
                      placeholder="Search expenses…"
                      className="bg-[#FAFAFA] border border-black/10 rounded-lg pl-8 pr-3 py-2 text-xs text-[#000000] focus:outline-none focus:border-[#3F3F46] placeholder:text-black/30 w-44"
                    />
                  </div>
                </div>
              </div>

              {expenseStats.filtered.length === 0 ? (
                <div className="py-12 text-center">
                  <div className="w-14 h-14 rounded-full bg-tertiary/10 flex items-center justify-center mx-auto mb-4">
                    <Wallet className="w-7 h-7 text-tertiary" />
                  </div>
                  <p className="text-sm font-bold text-[#000000]">
                    No expenses found.
                  </p>
                  <p className="text-xs font-semibold text-[#000000]/60 mt-1">
                    Try a different period or add a new expense.
                  </p>
                </div>
              ) : (
                <div className="overflow-x-auto">
                  <table className="w-full text-left border-collapse min-w-[720px]">
                    <thead className="bg-[#FAFAFA] border-b border-black/10 select-none">
                      <tr>
                        <th
                          onClick={() => {
                            if (expenseSortField === "date") {
                              setExpenseSortOrder((prev) => (prev === "asc" ? "desc" : "asc"));
                            } else {
                              setExpenseSortField("date");
                              setExpenseSortOrder("desc");
                            }
                          }}
                          className="p-3 text-[10px] font-black text-[#000000] uppercase tracking-wider cursor-pointer hover:bg-black/5 transition-colors"
                        >
                          <div className="flex items-center gap-1.5">
                            <span>Date</span>
                            {expenseSortField === "date" ? (
                              expenseSortOrder === "asc" ? (
                                <ArrowUp className="w-3 h-3 text-[#3F3F46]" />
                              ) : (
                                <ArrowDown className="w-3 h-3 text-[#3F3F46]" />
                              )
                            ) : (
                              <ArrowUpDown className="w-3 h-3 text-black/30" />
                            )}
                          </div>
                        </th>
                        <th
                          onClick={() => {
                            if (expenseSortField === "title") {
                              setExpenseSortOrder((prev) => (prev === "asc" ? "desc" : "asc"));
                            } else {
                              setExpenseSortField("title");
                              setExpenseSortOrder("asc");
                            }
                          }}
                          className="p-3 text-[10px] font-black text-[#000000] uppercase tracking-wider cursor-pointer hover:bg-black/5 transition-colors"
                        >
                          <div className="flex items-center gap-1.5">
                            <span>Expense</span>
                            {expenseSortField === "title" ? (
                              expenseSortOrder === "asc" ? (
                                <ArrowUp className="w-3 h-3 text-[#3F3F46]" />
                              ) : (
                                <ArrowDown className="w-3 h-3 text-[#3F3F46]" />
                              )
                            ) : (
                              <ArrowUpDown className="w-3 h-3 text-black/30" />
                            )}
                          </div>
                        </th>
                        <th
                          onClick={() => {
                            if (expenseSortField === "category") {
                              setExpenseSortOrder((prev) => (prev === "asc" ? "desc" : "asc"));
                            } else {
                              setExpenseSortField("category");
                              setExpenseSortOrder("asc");
                            }
                          }}
                          className="p-3 text-[10px] font-black text-[#000000] uppercase tracking-wider cursor-pointer hover:bg-black/5 transition-colors"
                        >
                          <div className="flex items-center gap-1.5">
                            <span>Category</span>
                            {expenseSortField === "category" ? (
                              expenseSortOrder === "asc" ? (
                                <ArrowUp className="w-3 h-3 text-[#3F3F46]" />
                              ) : (
                                <ArrowDown className="w-3 h-3 text-[#3F3F46]" />
                              )
                            ) : (
                              <ArrowUpDown className="w-3 h-3 text-black/30" />
                            )}
                          </div>
                        </th>
                        <th
                          onClick={() => {
                            if (expenseSortField === "payment_mode") {
                              setExpenseSortOrder((prev) => (prev === "asc" ? "desc" : "asc"));
                            } else {
                              setExpenseSortField("payment_mode");
                              setExpenseSortOrder("asc");
                            }
                          }}
                          className="p-3 text-[10px] font-black text-[#000000] uppercase tracking-wider cursor-pointer hover:bg-black/5 transition-colors"
                        >
                          <div className="flex items-center gap-1.5">
                            <span>Paid via</span>
                            {expenseSortField === "payment_mode" ? (
                              expenseSortOrder === "asc" ? (
                                <ArrowUp className="w-3 h-3 text-[#3F3F46]" />
                              ) : (
                                <ArrowDown className="w-3 h-3 text-[#3F3F46]" />
                              )
                            ) : (
                              <ArrowUpDown className="w-3 h-3 text-black/30" />
                            )}
                          </div>
                        </th>
                        <th
                          onClick={() => {
                            if (expenseSortField === "amount") {
                              setExpenseSortOrder((prev) => (prev === "asc" ? "desc" : "asc"));
                            } else {
                              setExpenseSortField("amount");
                              setExpenseSortOrder("desc");
                            }
                          }}
                          className="p-3 text-[10px] font-black text-[#000000] uppercase tracking-wider text-right cursor-pointer hover:bg-black/5 transition-colors"
                        >
                          <div className="flex items-center justify-end gap-1.5">
                            <span>Amount</span>
                            {expenseSortField === "amount" ? (
                              expenseSortOrder === "asc" ? (
                                <ArrowUp className="w-3 h-3 text-[#3F3F46]" />
                              ) : (
                                <ArrowDown className="w-3 h-3 text-[#3F3F46]" />
                              )
                            ) : (
                              <ArrowUpDown className="w-3 h-3 text-black/30" />
                            )}
                          </div>
                        </th>
                        {role === "admin" && (
                          <th className="p-3 text-[10px] font-black text-[#000000] uppercase tracking-wider text-center">
                            Action
                          </th>
                        )}
                      </tr>
                    </thead>
                    <tbody>
                      {expenseStats.filtered.map((e) => (
                        <tr
                          key={e.id}
                          className="border-b border-black/5 hover:bg-[#FAFAFA] transition-colors"
                        >
                          <td className="p-3 text-xs font-semibold text-[#000000] whitespace-nowrap">
                            {new Date(e.expense_date).toLocaleDateString("en-IN", {
                              day: "2-digit",
                              month: "short",
                              year: "numeric",
                            })}
                          </td>
                          <td className="p-3">
                            <p className="text-sm font-bold text-[#000000]">
                              {e.title}
                            </p>
                            {e.notes && (
                              <p className="text-[10px] text-[#000000]/50 font-semibold mt-0.5">
                                {e.notes}
                              </p>
                            )}
                          </td>
                          <td className="p-3">
                            <span className="inline-flex items-center gap-1 text-[10px] font-bold text-[#000000] bg-black/5 border border-black/10 px-2 py-1 rounded-full uppercase tracking-wider">
                              <Tag className="w-2.5 h-2.5" />
                              {e.category}
                            </span>
                          </td>
                          <td className="p-3">
                            <span className="inline-flex items-center gap-1 text-[10px] font-bold text-[#000000]/70">
                              <Banknote className="w-3 h-3" />
                              {e.payment_mode}
                            </span>
                          </td>
                          <td className="p-3 text-right text-sm font-black text-[#B91C1C] whitespace-nowrap">
                            − ₹
                            {e.amount.toLocaleString("en-IN", {
                              minimumFractionDigits: 2,
                              maximumFractionDigits: 2,
                            })}
                          </td>
                          {role === "admin" && (
                          <td className="p-3 text-center whitespace-nowrap">
                              <div className="inline-flex items-center gap-2">
                                <button
                                  onClick={() => handleStartEditExpense(e)}
                                  title="Edit expense"
                                  aria-label="Edit expense"
                                  className="inline-flex items-center justify-center w-10 h-10 bg-[#3F3F46]/10 hover:bg-[#3F3F46]/20 text-[#3F3F46] rounded-md transition-colors cursor-pointer"
                                >
                                  <Pencil className="w-4 h-4" />
                                </button>
                                <button
                                  onClick={() => handleDeleteExpense(e.id)}
                                  title="Delete expense"
                                  aria-label="Delete expense"
                                  className="inline-flex items-center justify-center w-10 h-10 bg-[#B91C1C]/10 hover:bg-[#B91C1C]/20 text-[#B91C1C] rounded-md transition-colors cursor-pointer"
                                >
                                  <Trash2 className="w-4 h-4" />
                                </button>
                              </div>
                          </td>
                          )}
                        </tr>
                      ))}
                    </tbody>
                    <tfoot>
                      <tr className="bg-[#FAFAFA] border-t border-black/10">
                        <td
                          colSpan={4}
                          className="p-3 text-[10px] font-black text-[#000000] uppercase tracking-wider text-right"
                        >
                          Total ({expensePeriod})
                        </td>
                        <td className="p-3 text-right text-sm font-black text-[#B91C1C] whitespace-nowrap">
                          − ₹
                          {expenseStats.total.toLocaleString("en-IN", {
                            minimumFractionDigits: 2,
                            maximumFractionDigits: 2,
                          })}
                        </td>
                        {role === "admin" && <td />}
                      </tr>
                    </tfoot>
                  </table>
                </div>
              )}
            </div>
          </div>
        )}

        {activeTab === "alerts" && (
          <div className="flex-1 flex flex-col max-w-[1400px] mx-auto w-full pb-8 pr-2 animate-in fade-in duration-300">
            <div className="flex flex-col lg:flex-row justify-between items-start lg:items-center gap-4 mb-6">
              <div>
                <h2 className="text-[28px] font-black text-[#000000] tracking-tight flex items-center gap-3">
                  <AlertTriangle className="w-7 h-7 text-[#D97706]" />
                  Stock Alerts
                </h2>
                <p className="text-xs text-[#000000] font-semibold mt-1">
                  Items at or below their low-stock threshold — restock before
                  they run out.
                </p>
              </div>
              <div className="flex items-center gap-2">
                {outOfStockCount > 0 && (
                  <div className="flex items-center gap-1.5 text-xs font-black text-white bg-[#DC2626] px-4 py-2 rounded-lg">
                    <PackageX className="w-3.5 h-3.5" />
                    {outOfStockCount} out of stock
                  </div>
                )}
                <div className="text-xs font-bold text-[#000000] bg-[#FFFFFF] border border-black/10 px-4 py-2 rounded-lg">
                  {lowStockItems.length} alert
                  {lowStockItems.length === 1 ? "" : "s"}
                </div>
              </div>
            </div>

            {lowStockItems.length === 0 ? (
              <div className="bg-white border border-black/10 rounded-xl p-12 text-center">
                <div className="w-14 h-14 rounded-full bg-[#10B981]/10 flex items-center justify-center mx-auto mb-4">
                  <Check className="w-7 h-7 text-[#10B981]" />
                </div>
                <p className="text-base font-bold text-[#000000]">All good.</p>
                <p className="text-xs font-semibold text-[#000000]/60 mt-1">
                  No products below their low-stock threshold.
                </p>
              </div>
            ) : (
              <div className="bg-white border border-black/10 rounded-xl overflow-hidden">
                <div className="overflow-x-auto">
                  <table className="w-full text-left border-collapse min-w-[600px]">
                    <thead className="bg-[#FAFAFA] border-b border-black/10">
                      <tr>
                        <th className="p-3 text-[10px] font-black text-[#000000] uppercase tracking-wider">
                          Product
                        </th>
                        <th className="p-3 text-[10px] font-black text-[#000000] uppercase tracking-wider text-center">
                          Stock
                        </th>
                        <th className="p-3 text-[10px] font-black text-[#000000] uppercase tracking-wider text-center">
                          Threshold
                        </th>
                        <th className="p-3 text-[10px] font-black text-[#000000] uppercase tracking-wider text-center">
                          Status
                        </th>
                      </tr>
                    </thead>
                    <tbody className="divide-y divide-black/5">
                      {lowStockItems.map((p) => {
                        const stock =
                          typeof p.stockQuantity === "number"
                            ? p.stockQuantity
                            : 0;
                        const threshold =
                          typeof p.lowStockThreshold === "number"
                            ? p.lowStockThreshold
                            : 5;
                        const isOut = stock <= 0;
                        const isLow = !isOut && stock <= threshold;
                        return (
                          <tr key={p.id} className="hover:bg-[#FAFAFA]">
                            <td className="p-3">
                              <div className="text-sm font-bold text-[#000000]">
                                {p.name}
                              </div>
                              {(p.batchNo || p.manufacturer) && (
                                <div className="text-[10px] font-semibold text-[#000000]/60 mt-0.5">
                                  {p.manufacturer}
                                  {p.manufacturer && p.batchNo ? " • " : ""}
                                  {p.batchNo ? `Batch ${p.batchNo}` : ""}
                                </div>
                              )}
                            </td>
                            <td
                              className={`p-3 text-center text-sm font-black ${isOut ? "text-[#DC2626]" : isLow ? "text-[#D97706]" : "text-[#000000]"}`}
                            >
                              {stock}
                            </td>
                            <td className="p-3 text-center text-sm font-bold text-[#000000]/70">
                              {threshold}
                            </td>
                            <td className="p-3 text-center">
                              <div className="flex flex-col gap-1 items-center">
                                {isOut && (
                                  <span className="inline-flex items-center gap-1 text-[10px] font-black uppercase tracking-wider text-white bg-[#DC2626] px-2 py-1 rounded">
                                    <PackageX className="w-3 h-3" />
                                    Out of Stock
                                  </span>
                                )}
                                {isLow && (
                                  <span className="inline-flex items-center gap-1 text-[10px] font-black uppercase tracking-wider text-[#B45309] bg-[#F59E0B]/20 px-2 py-1 rounded">
                                    Low Stock
                                  </span>
                                )}
                              </div>
                            </td>
                          </tr>
                        );
                      })}
                    </tbody>
                  </table>
                </div>
              </div>
            )}
          </div>
        )}

        {role === "admin" && activeTab === "inventory" && (
          <div className="flex-1 flex flex-col max-w-[1400px] mx-auto w-full pb-8 pr-2 animate-in fade-in duration-300">
            <div className="flex flex-col lg:flex-row justify-between items-start lg:items-center gap-4 mb-6">
              <div>
                <h2 className="text-[28px] font-black text-[#000000] tracking-tight flex items-center gap-3">
                  <Boxes className="w-7 h-7 text-[#3F3F46]" />
                  Inventory
                </h2>
                <p className="text-xs text-[#000000] font-semibold mt-1">
                  Manage products — add, edit, delete, and track stock, GST &
                  pricing.
                </p>
              </div>
              <div className="flex flex-wrap items-center gap-2 w-full lg:w-auto">
                <div className="relative flex-1 lg:flex-none">
                  <Search className="w-3.5 h-3.5 text-[#000000]/40 absolute left-3 top-1/2 -translate-y-1/2" />
                  <input
                    type="text"
                    placeholder="Search products…"
                    className="pl-9 pr-3 py-2 bg-white border border-black/10 rounded-lg text-xs font-semibold focus:outline-none focus:border-[#3F3F46] w-full lg:w-48"
                    value={inventorySearch}
                    onChange={(e) => setInventorySearch(e.target.value)}
                  />
                </div>
                <button
                  onClick={exportInventoryCSV}
                  className="text-[10px] font-bold text-[#000000] bg-white border border-black/10 hover:bg-[#FAFAFA] px-3 py-2 rounded-lg uppercase tracking-wider flex items-center gap-1.5 transition-colors cursor-pointer"
                >
                  <Download className="w-3.5 h-3.5 text-[#3F3F46]" /> Export CSV
                </button>
                <button
                  onClick={() => {
                    resetCatalogForm();
                    setEditingCatalogId(null);
                    setCatalogTargetRowId(null);
                    setShowCatalogModal(true);
                  }}
                  className="text-[10px] font-bold text-white bg-[#3F3F46] hover:bg-[#27272A] px-3 py-2 rounded-lg uppercase tracking-wider flex items-center gap-1.5 transition-colors cursor-pointer"
                >
                  <Plus className="w-3.5 h-3.5" /> Add Product
                </button>
              </div>
            </div>

            {inventoryProducts.length === 0 ? (
              <div className="bg-white border border-black/10 rounded-xl p-12 text-center">
                <div className="w-14 h-14 rounded-full bg-[#3F3F46]/10 flex items-center justify-center mx-auto mb-4">
                  <Boxes className="w-7 h-7 text-[#3F3F46]" />
                </div>
                <p className="text-base font-bold text-[#000000]">
                  No products yet.
                </p>
                <p className="text-xs font-semibold text-[#000000]/60 mt-1 mb-4">
                  Add your first product to start tracking stock and pricing.
                </p>
                <button
                  onClick={() => {
                    resetCatalogForm();
                    setEditingCatalogId(null);
                    setCatalogTargetRowId(null);
                    setShowCatalogModal(true);
                  }}
                  className="text-[10px] font-bold text-white bg-[#3F3F46] hover:bg-[#3F3F46] px-4 py-2 rounded-lg uppercase tracking-wider inline-flex items-center gap-1.5 transition-colors cursor-pointer"
                >
                  <Plus className="w-3.5 h-3.5" /> Add First Product
                </button>
              </div>
            ) : (
              <div className="bg-white border border-black/10 rounded-xl overflow-hidden">
                <div className="overflow-x-auto">
                  <table className="w-full text-left border-collapse min-w-[900px]">
                    <thead className="bg-[#FAFAFA] border-b border-black/10 select-none">
                      <tr>
                        <th
                          onClick={() => {
                            if (inventorySortField === "name") {
                              setInventorySortOrder((prev) => (prev === "asc" ? "desc" : "asc"));
                            } else {
                              setInventorySortField("name");
                              setInventorySortOrder("asc");
                            }
                          }}
                          className="p-3 text-[10px] font-black text-[#000000] uppercase tracking-wider cursor-pointer hover:bg-black/5 transition-colors"
                        >
                          <div className="flex items-center gap-1.5">
                            <span>Product</span>
                            {inventorySortField === "name" ? (
                              inventorySortOrder === "asc" ? (
                                <ArrowUp className="w-3 h-3 text-[#3F3F46]" />
                              ) : (
                                <ArrowDown className="w-3 h-3 text-[#3F3F46]" />
                              )
                            ) : (
                              <ArrowUpDown className="w-3 h-3 text-black/30" />
                            )}
                          </div>
                        </th>
                        <th
                          onClick={() => {
                            if (inventorySortField === "price") {
                              setInventorySortOrder((prev) => (prev === "asc" ? "desc" : "asc"));
                            } else {
                              setInventorySortField("price");
                              setInventorySortOrder("asc");
                            }
                          }}
                          className="p-3 text-[10px] font-black text-[#000000] uppercase tracking-wider text-right cursor-pointer hover:bg-black/5 transition-colors"
                        >
                          <div className="flex items-center justify-end gap-1.5">
                            <span>Price</span>
                            {inventorySortField === "price" ? (
                              inventorySortOrder === "asc" ? (
                                <ArrowUp className="w-3 h-3 text-[#3F3F46]" />
                              ) : (
                                <ArrowDown className="w-3 h-3 text-[#3F3F46]" />
                              )
                            ) : (
                              <ArrowUpDown className="w-3 h-3 text-black/30" />
                            )}
                          </div>
                        </th>
                        <th
                          onClick={() => {
                            if (inventorySortField === "gst") {
                              setInventorySortOrder((prev) => (prev === "asc" ? "desc" : "asc"));
                            } else {
                              setInventorySortField("gst");
                              setInventorySortOrder("desc");
                            }
                          }}
                          className="p-3 text-[10px] font-black text-[#000000] uppercase tracking-wider text-center cursor-pointer hover:bg-black/5 transition-colors"
                        >
                          <div className="flex items-center justify-center gap-1.5">
                            <span>GST %</span>
                            {inventorySortField === "gst" ? (
                              inventorySortOrder === "asc" ? (
                                <ArrowUp className="w-3 h-3 text-[#3F3F46]" />
                              ) : (
                                <ArrowDown className="w-3 h-3 text-[#3F3F46]" />
                              )
                            ) : (
                              <ArrowUpDown className="w-3 h-3 text-black/30" />
                            )}
                          </div>
                        </th>
                        <th
                          onClick={() => {
                            if (inventorySortField === "stock") {
                              setInventorySortOrder((prev) => (prev === "asc" ? "desc" : "asc"));
                            } else {
                              setInventorySortField("stock");
                              setInventorySortOrder("asc");
                            }
                          }}
                          className="p-3 text-[10px] font-black text-[#000000] uppercase tracking-wider text-center cursor-pointer hover:bg-black/5 transition-colors"
                        >
                          <div className="flex items-center justify-center gap-1.5">
                            <span>Stock</span>
                            {inventorySortField === "stock" ? (
                              inventorySortOrder === "asc" ? (
                                <ArrowUp className="w-3 h-3 text-[#3F3F46]" />
                              ) : (
                                <ArrowDown className="w-3 h-3 text-[#3F3F46]" />
                              )
                            ) : (
                              <ArrowUpDown className="w-3 h-3 text-black/30" />
                            )}
                          </div>
                        </th>
                        <th
                          onClick={() => {
                            if (inventorySortField === "brand") {
                              setInventorySortOrder((prev) => (prev === "asc" ? "desc" : "asc"));
                            } else {
                              setInventorySortField("brand");
                              setInventorySortOrder("asc");
                            }
                          }}
                          className="p-3 text-[10px] font-black text-[#000000] uppercase tracking-wider cursor-pointer hover:bg-black/5 transition-colors"
                        >
                          <div className="flex items-center gap-1.5">
                            <span>Brand / Batch</span>
                            {inventorySortField === "brand" ? (
                              inventorySortOrder === "asc" ? (
                                <ArrowUp className="w-3 h-3 text-[#3F3F46]" />
                              ) : (
                                <ArrowDown className="w-3 h-3 text-[#3F3F46]" />
                              )
                            ) : (
                              <ArrowUpDown className="w-3 h-3 text-black/30" />
                            )}
                          </div>
                        </th>
                        <th className="p-3 text-[10px] font-black text-[#000000] uppercase tracking-wider text-right">
                          Actions
                        </th>
                      </tr>
                    </thead>
                    <tbody className="divide-y divide-black/5">
                      {filteredInventory.map((p) => {
                        const stock =
                          typeof p.stockQuantity === "number"
                            ? p.stockQuantity
                            : 0;
                        const threshold =
                          typeof p.lowStockThreshold === "number"
                            ? p.lowStockThreshold
                            : 10;
                        const isLow = stock <= threshold;
                        const isExpanded = expandedProductId === p.id;
                        return (
                          <React.Fragment key={p.id}>
                            <tr
                              className="hover:bg-[#FAFAFA] cursor-pointer transition-colors"
                              onClick={() =>
                                setExpandedProductId(isExpanded ? null : p.id)
                              }
                            >
                              <td className="p-3">
                                <div className="flex items-start gap-2.5">
                                  <button
                                    type="button"
                                    onClick={(e) => {
                                      e.stopPropagation();
                                      setExpandedProductId(isExpanded ? null : p.id);
                                    }}
                                    className={`mt-0.5 w-6 h-6 rounded-md flex items-center justify-center transition-all shrink-0 cursor-pointer ${
                                      isExpanded
                                        ? "bg-[#3F3F46] text-white shadow-xs"
                                        : "bg-black/5 hover:bg-black/15 text-black/70 hover:text-black"
                                    }`}
                                    title={
                                      isExpanded
                                        ? "Click to collapse details"
                                        : "Click dropdown to open stock & pricing in detail"
                                    }
                                    aria-label="Toggle details dropdown"
                                  >
                                    <ChevronDown
                                      className={`w-3.5 h-3.5 transition-transform duration-200 ${
                                        isExpanded ? "rotate-180 text-white" : ""
                                      }`}
                                    />
                                  </button>
                                  <div className="flex-1 min-w-0">
                                    <div className="text-sm font-bold text-[#000000] flex items-center gap-2 flex-wrap">
                                      <span>{p.name}</span>
                                      {p.batches && p.batches.length > 1 && (
                                        <span className="text-[9px] bg-black/5 px-1.5 py-0.5 rounded text-black/60 font-semibold">
                                          {p.batches.length} batches
                                        </span>
                                      )}
                                      <span
                                        onClick={(e) => {
                                          e.stopPropagation();
                                          setExpandedProductId(isExpanded ? null : p.id);
                                        }}
                                        className="text-[9px] text-[#3F3F46] hover:underline font-bold cursor-pointer inline-flex items-center gap-0.5"
                                      >
                                        {isExpanded ? "▲ Hide Details" : "▼ Open in detail"}
                                      </span>
                                    </div>
                                    {combineDesc(p.desc, p.desc2) && (
                                      <div className="text-[10px] font-semibold text-[#000000]/60 mt-0.5">
                                        {combineDesc(p.desc, p.desc2)}
                                      </div>
                                    )}
                                    {p.hsnCode && (
                                      <div className="text-[9px] font-bold text-[#000000]/40 mt-0.5 uppercase tracking-wider">
                                        HSN {p.hsnCode}
                                      </div>
                                    )}
                                  </div>
                                </div>
                              </td>
                              <td className="p-3 text-right text-sm font-black text-[#000000]">
                                ₹
                                {(p.price ?? 0).toLocaleString(undefined, {
                                  minimumFractionDigits: 2,
                                })}
                              </td>
                              <td className="p-3 text-center text-sm font-bold text-[#000000]/70">
                                {p.gstRate ?? 0}%
                              </td>
                              <td className="p-3 text-center">
                                <div
                                  className={`text-sm font-black ${isLow ? "text-[#27272A]" : "text-[#000000]"}`}
                                >
                                  {stock}
                                </div>
                                <div className="text-[9px] font-semibold text-[#000000]/50">
                                  min {threshold}
                                </div>
                              </td>
                              <td className="p-3">
                                <div className="text-xs font-semibold text-[#000000]">
                                  {p.manufacturer || (
                                    <span className="text-[#000000]/40">—</span>
                                  )}
                                </div>
                                <div className="text-[10px] font-semibold text-[#000000]/50">
                                  {p.batchNo ? `Batch ${p.batchNo}` : ""}
                                </div>
                              </td>
                              <td className="p-3 text-right">
                                <div
                                  className="flex justify-end gap-1.5"
                                  onClick={(e) => e.stopPropagation()}
                                >
                                  <button
                                    onClick={() => setExpandedProductId(isExpanded ? null : p.id)}
                                    className={`text-[10px] font-bold px-2.5 py-1.5 rounded uppercase tracking-wider transition-all cursor-pointer inline-flex items-center gap-1 ${
                                      isExpanded
                                        ? "bg-[#3F3F46] text-white shadow-xs"
                                        : "text-[#3F3F46] hover:bg-[#3F3F46]/10 border border-[#3F3F46]/30"
                                    }`}
                                    title={
                                      isExpanded
                                        ? "Collapse product details"
                                        : "Drop down to open stock batches & pricing details"
                                    }
                                  >
                                    <ChevronDown
                                      className={`w-3 h-3 transition-transform duration-200 ${
                                        isExpanded ? "rotate-180" : ""
                                      }`}
                                    />
                                    {isExpanded ? "Close" : "Details"}
                                  </button>
                                  <button
                                    onClick={() => openEditCatalog(p)}
                                    className="text-[10px] font-bold text-[#3F3F46] hover:text-white hover:bg-[#3F3F46] border border-[#3F3F46]/30 px-2.5 py-1.5 rounded uppercase tracking-wider transition-colors cursor-pointer inline-flex items-center gap-1"
                                  >
                                    <Pencil className="w-3 h-3" /> Edit
                                  </button>
                                  <button
                                    onClick={() => {
                                      if (
                                        window.confirm(
                                          `Delete "${p.name}" from inventory? This cannot be undone.`,
                                        )
                                      ) {
                                        deleteFromCatalog(p.id);
                                      }
                                    }}
                                    className="text-[10px] font-bold text-[#DC2626] hover:text-white hover:bg-[#DC2626] border border-[#DC2626]/30 px-2.5 py-1.5 rounded uppercase tracking-wider transition-colors cursor-pointer inline-flex items-center gap-1"
                                  >
                                    <Trash2 className="w-3 h-3" /> Delete
                                  </button>
                                </div>
                              </td>
                            </tr>
                            {isExpanded && (
                              <tr className="bg-[#FAFAFA] border-b border-black/5">
                                <td colSpan={6} className="p-4">
                                  <div className="bg-white border border-black/10 rounded-xl p-4 shadow-sm">
                                    <div className="flex flex-col sm:flex-row items-start sm:items-center justify-between gap-3 pb-3 mb-3 border-b border-black/5">
                                      <div>
                                        <div className="flex items-center gap-2">
                                          <span className="w-2 h-2 rounded-full bg-[#3F3F46]" />
                                          <h4 className="text-xs font-black text-black uppercase tracking-wider">
                                            Product Detail & Stock Batches — {p.name}
                                          </h4>
                                        </div>
                                        <p className="text-[10px] text-black/60 font-semibold mt-0.5">
                                          HSN: {p.hsnCode || "—"} • GST Rate: {p.gstRate ?? 0}% • Available Stock: {stock} pcs • Minimum Threshold: {threshold} pcs
                                        </p>
                                      </div>
                                      <div className="flex items-center gap-2">
                                        {p.tracksSerial && (
                                          <button
                                            onClick={() => {
                                              setSerialInputs([]);
                                              openUnitsModal(p.id, p.name);
                                            }}
                                            className="text-[10px] font-bold text-[#3F3F46] bg-[#3F3F46]/10 hover:bg-[#3F3F46]/20 px-3 py-1.5 rounded-lg transition-colors cursor-pointer inline-flex items-center gap-1"
                                          >
                                            <List className="w-3 h-3" /> Manage IMEIs
                                          </button>
                                        )}
                                        <button
                                          onClick={() => {
                                            setBatchTargetProductId(p.id);
                                            resetCatalogForm();
                                            setShowBatchModal(true);
                                          }}
                                          className="text-[10px] font-bold text-white bg-[#3F3F46] hover:bg-[#27272A] px-3 py-1.5 rounded-lg transition-colors cursor-pointer inline-flex items-center gap-1 shadow-xs"
                                        >
                                          <Plus className="w-3 h-3" /> Add Batch
                                        </button>
                                        <button
                                          onClick={() => setExpandedProductId(null)}
                                          className="text-[10px] font-bold text-black/70 hover:text-black bg-black/5 hover:bg-black/10 px-2.5 py-1.5 rounded-lg transition-colors cursor-pointer"
                                        >
                                          Close
                                        </button>
                                      </div>
                                    </div>
                                    <table className="w-full text-left text-xs">
                                      <thead>
                                        <tr className="border-b border-black/5 text-[#000000]/60">
                                          <th className="py-1.5 font-semibold">
                                            Batch No
                                          </th>
                                          <th className="py-1.5 font-semibold">
                                            Arrived At
                                          </th>
                                          <th className="py-1.5 font-semibold">
                                            Brand / Supplier
                                          </th>
                                          <th className="py-1.5 font-semibold">
                                            Cost Price
                                          </th>
                                          <th className="py-1.5 font-semibold">
                                            Selling Price
                                          </th>
                                          <th className="py-1.5 font-semibold text-center">
                                            Margin
                                          </th>
                                          <th className="py-1.5 font-semibold text-right">
                                            Stock
                                          </th>
                                        </tr>
                                      </thead>
                                      <tbody>
                                        {p.batches && p.batches.length > 0 ? (
                                          p.batches.map((b: any) => {
                                            let batchArrival = b.arrived_at;
                                            if (
                                              batchArrival &&
                                              batchArrival.includes("T")
                                            ) {
                                              batchArrival =
                                                batchArrival.split("T")[0];
                                            }
                                            const cost = Number(b.cost_price) || 0;
                                            const sell = Number(b.selling_price) || 0;
                                            const margin =
                                              cost > 0
                                                ? (((sell - cost) / cost) * 100).toFixed(1) + "%"
                                                : "—";
                                            return (
                                              <tr
                                                key={b.id}
                                                className="border-b border-black/5 last:border-0"
                                              >
                                                <td className="py-1.5 font-bold">
                                                  {b.batch_no || "—"}
                                                </td>
                                                <td className="py-1.5">
                                                  {batchArrival || "—"}
                                                </td>
                                                <td className="py-1.5">
                                                  {b.manufacturer || "—"}
                                                </td>
                                                <td className="py-1.5">
                                                  ₹{cost.toLocaleString()}
                                                </td>
                                                <td className="py-1.5">
                                                  ₹{sell.toLocaleString()}
                                                </td>
                                                <td className="py-1.5 text-center font-semibold text-green-700">
                                                  {margin}
                                                </td>
                                                <td
                                                  className={`py-1.5 text-right font-black ${
                                                    b.stock_quantity > 0
                                                      ? "text-green-600"
                                                      : "text-[#27272A]"
                                                  }`}
                                                >
                                                  {b.stock_quantity} pcs
                                                </td>
                                              </tr>
                                            );
                                          })
                                        ) : (
                                          <tr>
                                            <td
                                              colSpan={7}
                                              className="py-3 text-center text-[10px] font-semibold text-black/40"
                                            >
                                              No batches available. Click "+ Add Batch" to record batch details.
                                            </td>
                                          </tr>
                                        )}
                                      </tbody>
                                    </table>
                                  </div>
                                </td>
                              </tr>
                            )}
                          </React.Fragment>
                        );
                      })}
                      {filteredInventory.length === 0 && (
                        <tr>
                          <td
                            colSpan={6}
                            className="p-8 text-center text-xs font-semibold text-[#000000]/60"
                          >
                            No products match &quot;{inventorySearch}&quot;.
                          </td>
                        </tr>
                      )}
                    </tbody>
                  </table>
                </div>
              </div>
            )}
          </div>
        )}

        {/* Order Details Modal */}
        {selectedOrder && (
          <div className="fixed inset-0 z-[100] flex items-center justify-center bg-black/60 p-4">
            <div className="bg-[#FFFFFF] rounded-2xl shadow-2xl w-full max-w-2xl overflow-hidden flex flex-col max-h-[90vh]">
              {/* Modal Header */}
              <div className="p-6 border-b border-black/10 flex justify-between items-center bg-[#FFFFFF]">
                <div>
                  <h3 className="text-xl font-bold text-[#000000]">
                    Order Details
                  </h3>
                  <p className="text-sm text-[#000000] font-medium mt-1">
                    {selectedOrder.id}
                  </p>
                </div>
                <button
                  onClick={() => setSelectedOrder(null)}
                  className="p-2 hover:bg-black/10 rounded-full transition-colors group cursor-pointer"
                >
                  <X className="w-5 h-5 text-[#000000] group-hover:text-tertiary transition-colors" />
                </button>
              </div>

              {/* Modal Body */}
              <div className="p-6 overflow-y-auto">
                <div className="grid grid-cols-2 gap-6 mb-8">
                  <div>
                    <div className="text-[10px] font-bold text-[#000000] uppercase tracking-wider mb-1">
                      Customer Name
                    </div>
                    <div className="text-sm font-semibold text-[#000000]">
                      {selectedOrder.customerName}
                    </div>
                  </div>
                  <div>
                    <div className="text-[10px] font-bold text-[#000000] uppercase tracking-wider mb-1">
                      Contact Number
                    </div>
                    <div className="text-sm font-semibold text-[#000000]">
                      {selectedOrder.customerPhone || "N/A"}
                    </div>
                  </div>
                  <div>
                    <div className="text-[10px] font-bold text-[#000000] uppercase tracking-wider mb-1">
                      Address
                    </div>
                    <div className="text-sm font-semibold text-[#000000]">
                      {selectedOrder.customerAddress || "N/A"}
                    </div>
                  </div>
                  <div>
                    <div className="text-[10px] font-bold text-[#000000] uppercase tracking-wider mb-1">
                      Order Source
                    </div>
                    <div className="text-sm font-semibold text-[#000000]">
                      {selectedOrder.source}
                    </div>
                  </div>
                  <div>
                    <div className="text-[10px] font-bold text-[#000000] uppercase tracking-wider mb-1">
                      Bill Type
                    </div>
                    <span
                      className={`inline-block text-[10px] font-black uppercase tracking-wider px-2 py-1 rounded ${selectedOrder.isGst ? "bg-[#4F46E5]/10 text-[#4F46E5]" : "bg-black/5 text-[#111827]"}`}
                    >
                      {selectedOrder.isGst ? "GST Invoice" : "Non-GST Bill"}
                    </span>
                  </div>
                  <div>
                    <div className="text-[10px] font-bold text-[#000000] uppercase tracking-wider mb-1">
                      Date & Time
                    </div>
                    <div className="text-sm font-semibold text-[#000000]">
                      {new Date(selectedOrder.date).toLocaleString()}
                    </div>
                  </div>
                </div>

                <div className="mb-4 text-[11px] font-bold text-[#000000] uppercase tracking-[0.1em] border-b border-black/10 pb-2">
                  Order Items
                </div>
                <div className="space-y-3 mb-8">
                  {selectedOrder.items.map((item, idx) => (
                    <div
                      key={idx}
                      className="flex justify-between items-center"
                    >
                      <div>
                        <div className="text-sm font-bold text-[#000000]">
                          {item.name}
                        </div>
                        {item.desc && (
                          <div className="text-[10px] text-[#000000] font-medium">
                            {item.desc}
                          </div>
                        )}
                      </div>
                      <div className="text-right">
                        <div className="text-sm font-bold text-[#000000]">
                          ₹{(item.price * item.qty).toLocaleString()}
                        </div>
                        <div className="text-[10px] text-[#000000] font-medium">
                          {item.qty} x ₹{item.price.toLocaleString()}
                        </div>
                      </div>
                    </div>
                  ))}
                </div>

                <div className="border-t border-black/10 pt-4 space-y-2">
                  <div className="flex justify-between text-sm">
                    <span className="text-[#000000] font-semibold">
                      Subtotal{selectedOrderLegacyGst ? " (before GST)" : ""}
                    </span>
                    <span className="text-[#000000] font-bold">
                      ₹{(selectedOrder.subtotal - (selectedOrderLegacyGst ? selectedOrder.gstAmount ?? 0 : 0)).toLocaleString(undefined, { minimumFractionDigits: 2, maximumFractionDigits: 2 })}
                    </span>
                  </div>
                  {selectedOrder.discount > 0 && (
                    <div className="flex justify-between text-sm">
                      <span className="text-[#000000] font-semibold">
                        Discount Applied{selectedOrder.discountType === "PERCENT" && selectedOrder.discountValue ? ` (${selectedOrder.discountValue}%)` : ""}
                      </span>
                      <span className="text-[#27272A] font-bold">
                        -₹{selectedOrder.discount.toLocaleString()}
                      </span>
                    </div>
                  )}
                  {(selectedOrder.gstAmount ?? 0) > 0 && selectedOrderLegacyGst && (
                    <div className="flex justify-between text-sm">
                      <span className="text-[#000000] font-semibold">
                        GST ({selectedOrder.gstPercentage ?? 0}%)
                      </span>
                      <span className="text-[#000000] font-bold">
                        +₹{(selectedOrder.gstAmount ?? 0).toLocaleString(undefined, { minimumFractionDigits: 2, maximumFractionDigits: 2 })}
                      </span>
                    </div>
                  )}
                  {selectedOrder.isGst && (selectedOrder.gstAmount ?? 0) > 0 && !selectedOrderLegacyGst &&
                    (["CGST", "SGST"] as const).map((tax) => (
                      <div key={tax} className="flex justify-between text-sm">
                        <span className="text-[#000000] font-semibold">
                          {tax} ({(selectedOrder.gstPercentage ?? 0) / 2}%) <span className="text-[10px] text-[#52525B]">included</span>
                        </span>
                        <span className="text-[#000000] font-bold">
                          ₹{((selectedOrder.gstAmount ?? 0) / 2).toLocaleString(undefined, { minimumFractionDigits: 2, maximumFractionDigits: 2 })}
                        </span>
                      </div>
                    ))}
                  {selectedOrder.deliveryFee > 0 && (
                    <div className="flex justify-between text-sm">
                      <span className="text-[#000000] font-semibold">
                        Delivery Fee
                      </span>
                      <span className="text-[#000000] font-bold">
                        ₹{selectedOrder.deliveryFee.toLocaleString()}
                      </span>
                    </div>
                  )}
                  <div className="flex justify-between text-lg pt-2 mt-2 border-t border-transparent">
                    <span className="text-[#000000] font-black uppercase tracking-tight">
                      Total{" "}
                    </span>
                    <span className="text-[#3F3F46] font-black">
                      ₹{selectedOrder.grandTotal.toLocaleString()}
                    </span>
                  </div>
                </div>
              </div>
            </div>
          </div>
        )}

        {/* Invoice Modal */}
        {activeInvoiceId && (
          <div className="fixed inset-0 bg-black/60 backdrop-blur-xs z-[400] flex items-center justify-center p-2 sm:p-4 animate-in fade-in duration-150">
            <div className="bg-white rounded-xl shadow-2xl w-full max-w-4xl h-[92vh] sm:h-[88vh] flex flex-col overflow-hidden border border-neutral-300 transform scale-100 animate-in zoom-in-95 duration-150">
              <div className="px-4 py-2.5 flex justify-between items-center bg-neutral-900 text-white border-b border-neutral-800 shrink-0">
                <h3 className="font-bold text-xs uppercase tracking-wider flex items-center gap-2 text-white">
                  <Printer className="w-3.5 h-3.5 text-neutral-300" />
                  <span>Invoice Preview • #{activeInvoiceId}</span>
                </h3>
                <div className="flex items-center gap-2">
                  <a
                    href={`/invoice/${activeInvoiceId}`}
                    target="_blank"
                    rel="noopener noreferrer"
                    className="text-[11px] font-semibold text-neutral-300 hover:text-white px-2.5 py-1 bg-white/10 hover:bg-white/20 rounded transition-colors"
                  >
                    Open Full Page ↗
                  </a>
                  <button
                    onClick={() => setActiveInvoiceId(null)}
                    className="w-7 h-7 flex items-center justify-center bg-white/10 hover:bg-white/20 text-white rounded transition-colors cursor-pointer"
                  >
                    <X className="w-4 h-4" />
                  </button>
                </div>
              </div>
              <div className="flex-1 w-full bg-neutral-100 overflow-hidden relative">
                <iframe
                  src={`/invoice/${activeInvoiceId}?embed=true`}
                  className="w-full h-full border-none absolute inset-0"
                  title={`Invoice ${activeInvoiceId}`}
                />
              </div>
            </div>
          </div>
        )}

        {/* Low Stock Alert Modal */}
        {showLowStockAlertModal && (
          <div className="fixed inset-0 bg-black/60 backdrop-blur-sm z-[500] flex items-center justify-center p-4 animate-in fade-in duration-200">
            <div className="bg-white rounded-2xl shadow-2xl w-full max-w-md overflow-hidden transform scale-100 animate-in zoom-in-95 duration-200 border border-black/10">
              <div className="p-6 border-b border-black/10">
                <div className="flex justify-between items-center mb-4">
                  <div className="flex items-center gap-3">
                    <div className="w-10 h-10 rounded-full bg-[#F59E0B]/15 flex items-center justify-center">
                      <AlertTriangle className="w-5 h-5 text-[#D97706]" />
                    </div>
                    <h3 className="font-black text-lg text-black tracking-tight">Stock Alert</h3>
                  </div>
                  <button
                    onClick={() => setShowLowStockAlertModal(false)}
                    className="text-black/40 hover:text-black transition-colors"
                  >
                    <X className="w-5 h-5" />
                  </button>
                </div>
                <p className="text-sm font-semibold text-black/70">
                  Some products need restocking. Please review the out-of-stock
                  and low-stock items below.
                </p>
              </div>
              <div className="max-h-[60vh] overflow-y-auto p-2 bg-gray-50/50">
                <ul className="space-y-2 p-2">
                  {lowStockAlertProducts.map((p) => {
                    const stock =
                      typeof p.stockQuantity === "number" ? p.stockQuantity : 0;
                    const threshold =
                      typeof p.lowStockThreshold === "number"
                        ? p.lowStockThreshold
                        : 5;
                    const isOut = stock <= 0;
                    return (
                      <li
                        key={p.id}
                        className="bg-white p-3 rounded-lg border border-black/5 flex justify-between items-center gap-3 shadow-sm"
                      >
                        <div className="min-w-0">
                          <span className="block text-xs font-bold text-black truncate">
                            {p.name}
                          </span>
                          <span
                            className={`inline-flex items-center gap-1 mt-1 text-[9px] font-black uppercase tracking-wider px-1.5 py-0.5 rounded ${
                              isOut
                                ? "text-white bg-[#DC2626]"
                                : "text-[#B45309] bg-[#F59E0B]/20"
                            }`}
                          >
                            {isOut ? "Out of Stock" : "Low Stock"}
                          </span>
                        </div>
                        <span
                          className={`text-xs font-black shrink-0 ${isOut ? "text-[#DC2626]" : "text-black"}`}
                        >
                          Stock: {stock}
                        </span>
                      </li>
                    );
                  })}
                </ul>
              </div>
              <div className="p-4 border-t border-black/10 bg-white">
                <button
                  onClick={() => setShowLowStockAlertModal(false)}
                  className="w-full py-3 bg-[#27272A] hover:bg-[#27272A] text-white rounded-xl font-bold text-xs uppercase tracking-wider transition-colors shadow-sm"
                >
                  Acknowledge
                </button>
              </div>
            </div>
          </div>
        )}


        {/* Classy Footer */}
        <footer className="mt-auto pt-10 pb-2 border-t border-black/10 flex flex-col md:flex-row justify-between items-center text-[10px] text-[#000000] font-semibold uppercase tracking-wider gap-4">
          <div className="text-[#000000]">
            © 2026 All Rights Reserved. RAJA MOBILES.
          </div>
          <div>
            Powered By{" "}
            <a
              href="https://www.cenexasystems.com/"
              target="_blank"
              rel="noopener noreferrer"
              className="text-[#3F3F46] hover:underline font-bold transition-all"
            >
              Cenexa Systems
            </a>{" "}
            @2026
          </div>
          <div className="italic text-tertiary font-bold tracking-[0.15em] flex items-center gap-1.5">
            <span className="w-1.5 h-1.5 bg-[#3F3F46] rounded-full"></span>
            Mobiles • Accessories • Repairs • Recharges
          </div>
        </footer>
      </main>

      {toast && (
        <div
          role="status"
          onClick={() => setToast(null)}
          className={`fixed bottom-4 left-1/2 -translate-x-1/2 z-[600] max-w-[92vw] sm:max-w-md px-4 py-3 rounded-xl shadow-xl text-sm font-bold text-white flex items-center gap-2 cursor-pointer animate-in fade-in slide-in-from-bottom-2 ${
            toast.type === "success" ? "bg-[#16A34A]" : "bg-[#DC2626]"
          }`}
        >
          {toast.type === "success" ? (
            <Check className="w-4 h-4 shrink-0" />
          ) : (
            <AlertTriangle className="w-4 h-4 shrink-0" />
          )}
          <span>{toast.message}</span>
        </div>
      )}
    </div>
  );
}
