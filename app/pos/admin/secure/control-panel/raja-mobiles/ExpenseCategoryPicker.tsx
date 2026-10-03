"use client";

import React, { useEffect, useRef, useState } from "react";
import {
  Boxes,
  Briefcase,
  Check,
  ChevronDown,
  Loader2,
  Megaphone,
  Pencil,
  Plus,
  Receipt,
  Tag,
  Trash2,
  Truck,
  Users,
  Wrench,
  Zap,
  Home,
  Landmark,
  X,
} from "lucide-react";
import {
  createExpenseCategory,
  renameExpenseCategory,
  removeExpenseCategory,
} from "@/app/pos/actions";
import { ExpenseCategory } from "@/lib/types";

// Miscellaneous is the landing spot for deleted categories, so it is locked.
export const FALLBACK_EXPENSE_CATEGORY = "Miscellaneous";

const ICONS: [RegExp, React.ComponentType<{ className?: string }>][] = [
  [/stock|inventory|purchase/i, Boxes],
  [/rent/i, Home],
  [/salar|wage|staff/i, Users],
  [/electric|power/i, Zap],
  [/utilit|bill|water/i, Receipt],
  [/transport|freight|fuel|travel/i, Truck],
  [/market|advert|promo/i, Megaphone],
  [/repair|maint/i, Wrench],
  [/tax|fee|gst/i, Landmark],
  [/misc|other/i, Briefcase],
];

export function expenseCategoryIcon(name: string) {
  return ICONS.find(([re]) => re.test(name))?.[1] ?? Tag;
}

type Props = {
  categories: ExpenseCategory[];
  value: string;
  /** expense count per category name, shown in the delete confirmation */
  usage: Record<string, number>;
  /** admins only: shows the rename / delete icons */
  canManage: boolean;
  onSelect: (name: string) => void;
  onCreated: (cat: ExpenseCategory) => void;
  onRenamed: (cat: ExpenseCategory, oldName: string) => void;
  onDeleted: (cat: ExpenseCategory, reassigned: number) => void;
};

export default function ExpenseCategoryPicker({
  categories,
  value,
  usage,
  canManage,
  onSelect,
  onCreated,
  onRenamed,
  onDeleted,
}: Props) {
  const [open, setOpen] = useState(false);
  const [editingId, setEditingId] = useState<string | null>(null);
  const [editName, setEditName] = useState("");
  const [deletingId, setDeletingId] = useState<string | null>(null);
  const [adding, setAdding] = useState(false);
  const [newName, setNewName] = useState("");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");
  const wrapperRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    if (!open) return;
    const onDown = (e: MouseEvent | TouchEvent) => {
      if (!wrapperRef.current?.contains(e.target as Node)) setOpen(false);
    };
    document.addEventListener("mousedown", onDown);
    document.addEventListener("touchstart", onDown);
    return () => {
      document.removeEventListener("mousedown", onDown);
      document.removeEventListener("touchstart", onDown);
    };
  }, [open]);

  const reset = () => {
    setEditingId(null);
    setDeletingId(null);
    setAdding(false);
    setNewName("");
    setError("");
  };

  const toggle = () => {
    if (open) reset();
    setOpen(!open);
  };

  const run = async (fn: () => Promise<void>) => {
    setBusy(true);
    setError("");
    try {
      await fn();
    } catch (err) {
      setError(err instanceof Error ? err.message : "Something went wrong.");
    } finally {
      setBusy(false);
    }
  };

  const saveEdit = (cat: ExpenseCategory) =>
    run(async () => {
      const name = editName.trim();
      if (!name) throw new Error("Name can't be empty.");
      if (name === cat.name) return reset();
      const res = await renameExpenseCategory(cat.id, name);
      if (!res.ok) throw new Error(res.error);
      const updated = res.data;
      onRenamed(updated, cat.name);
      reset();
    });

  const confirmDelete = (cat: ExpenseCategory) =>
    run(async () => {
      const res = await removeExpenseCategory(cat.id);
      if (!res.ok) throw new Error(res.error);
      const { reassigned } = res.data;
      onDeleted(cat, reassigned);
      reset();
    });

  const saveNew = () =>
    run(async () => {
      const name = newName.trim();
      if (!name) throw new Error("Enter a category name.");
      const res = await createExpenseCategory(name);
      if (!res.ok) throw new Error(res.error);
      const created = res.data;
      onCreated(created);
      onSelect(created.name);
      reset();
      setOpen(false);
    });

  const selectedIcon = expenseCategoryIcon(value);
  // Stop the click reaching the row / dropdown so icons never select the category.
  const stop = (e: React.SyntheticEvent) => e.stopPropagation();

  return (
    <div ref={wrapperRef} className="relative">
      <button
        type="button"
        onClick={toggle}
        aria-haspopup="listbox"
        aria-expanded={open}
        className="w-full flex items-center gap-2 bg-[#FAFAFA] border border-black/10 rounded-lg px-3 py-2 text-sm text-[#000000] focus:outline-none focus:border-[#3F3F46] cursor-pointer text-left"
      >
        {React.createElement(selectedIcon, { className: "w-4 h-4 text-[#3F3F46] shrink-0" })}
        <span className="flex-1 truncate">{value || "Select category"}</span>
        <ChevronDown
          className={`w-4 h-4 text-black/50 shrink-0 transition-transform ${open ? "rotate-180" : ""}`}
        />
      </button>

      {open && (
        <div
          role="listbox"
          className="absolute z-30 mt-1 w-full bg-white border border-black/10 rounded-xl shadow-lg overflow-hidden"
        >
          <ul className="max-h-72 overflow-y-auto divide-y divide-black/5">
            {categories.map((cat) => {
              const icon = expenseCategoryIcon(cat.name);
              const locked = !canManage || cat.name === FALLBACK_EXPENSE_CATEGORY;
              const selected = cat.name === value;

              if (editingId === cat.id) {
                return (
                  <li key={cat.id} className="flex items-center gap-1 p-2 bg-[#FAFAFA]">
                    <input
                      autoFocus
                      type="text"
                      value={editName}
                      disabled={busy}
                      onChange={(e) => setEditName(e.target.value)}
                      onKeyDown={(e) => {
                        if (e.key === "Enter") saveEdit(cat);
                        if (e.key === "Escape") reset();
                      }}
                      className="flex-1 min-w-0 bg-white border border-black/10 rounded-lg px-3 py-2 text-sm focus:outline-none focus:border-[#3F3F46]"
                    />
                    <button
                      type="button"
                      onClick={() => saveEdit(cat)}
                      disabled={busy}
                      aria-label="Save name"
                      className="w-10 h-10 flex items-center justify-center rounded-lg bg-[#3F3F46] text-white hover:bg-[#27272A] disabled:opacity-60 cursor-pointer"
                    >
                      {busy ? <Loader2 className="w-4 h-4 animate-spin" /> : <Check className="w-4 h-4" />}
                    </button>
                    <button
                      type="button"
                      onClick={reset}
                      disabled={busy}
                      aria-label="Cancel"
                      className="w-10 h-10 flex items-center justify-center rounded-lg text-black/60 hover:bg-black/5 cursor-pointer"
                    >
                      <X className="w-4 h-4" />
                    </button>
                  </li>
                );
              }

              if (deletingId === cat.id) {
                const n = usage[cat.name] || 0;
                return (
                  <li key={cat.id} className="p-3 bg-[#FAFAFA]">
                    <p className="text-sm font-bold text-[#000000]">Delete this category?</p>
                    <p className="text-xs text-black/60 mt-0.5">
                      {n > 0
                        ? `${n} expense${n === 1 ? "" : "s"} using "${cat.name}" will move to ${FALLBACK_EXPENSE_CATEGORY}.`
                        : `"${cat.name}" isn't used by any expense.`}
                    </p>
                    <div className="flex gap-2 mt-2">
                      <button
                        type="button"
                        onClick={() => confirmDelete(cat)}
                        disabled={busy}
                        className="flex-1 h-10 rounded-lg bg-red-600 hover:bg-red-700 disabled:opacity-60 text-white text-xs font-black uppercase tracking-wider flex items-center justify-center gap-1.5 cursor-pointer"
                      >
                        {busy ? <Loader2 className="w-4 h-4 animate-spin" /> : <Trash2 className="w-4 h-4" />}
                        Delete
                      </button>
                      <button
                        type="button"
                        onClick={reset}
                        disabled={busy}
                        className="flex-1 h-10 rounded-lg border border-black/10 text-xs font-black uppercase tracking-wider text-[#000000] hover:bg-black/5 cursor-pointer"
                      >
                        Cancel
                      </button>
                    </div>
                  </li>
                );
              }

              return (
                <li
                  key={cat.id}
                  role="option"
                  aria-selected={selected}
                  className={`flex items-center ${selected ? "bg-[#3F3F46]/5" : ""}`}
                >
                  <button
                    type="button"
                    onClick={() => {
                      onSelect(cat.name);
                      reset();
                      setOpen(false);
                    }}
                    className="flex-1 min-w-0 min-h-11 flex items-center gap-2 px-3 py-2 text-sm text-left hover:bg-black/5 cursor-pointer"
                  >
                    {React.createElement(icon, { className: "w-4 h-4 text-[#3F3F46] shrink-0" })}
                    <span className={`truncate ${selected ? "font-bold" : ""}`}>{cat.name}</span>
                  </button>
                  {!locked && (
                    <>
                      <button
                        type="button"
                        aria-label={`Rename ${cat.name}`}
                        title="Rename"
                        onMouseDown={stop}
                        onClick={(e) => {
                          stop(e);
                          reset();
                          setEditingId(cat.id);
                          setEditName(cat.name);
                        }}
                        className="w-11 h-11 flex items-center justify-center text-black/50 hover:text-[#3F3F46] hover:bg-black/5 cursor-pointer"
                      >
                        <Pencil className="w-4 h-4" />
                      </button>
                      <button
                        type="button"
                        aria-label={`Delete ${cat.name}`}
                        title="Delete"
                        onMouseDown={stop}
                        onClick={(e) => {
                          stop(e);
                          reset();
                          setDeletingId(cat.id);
                        }}
                        className="w-11 h-11 flex items-center justify-center text-black/50 hover:text-red-600 hover:bg-red-50 cursor-pointer"
                      >
                        <Trash2 className="w-4 h-4" />
                      </button>
                    </>
                  )}
                </li>
              );
            })}
          </ul>

          <div className="border-t border-black/10">
            {adding ? (
              <div className="flex items-center gap-1 p-2 bg-[#FAFAFA]">
                <input
                  autoFocus
                  type="text"
                  value={newName}
                  disabled={busy}
                  onChange={(e) => setNewName(e.target.value)}
                  onKeyDown={(e) => {
                    if (e.key === "Enter") saveNew();
                    if (e.key === "Escape") reset();
                  }}
                  placeholder="e.g. Festival decorations"
                  className="flex-1 min-w-0 bg-white border border-black/10 rounded-lg px-3 py-2 text-sm placeholder:text-black/30 focus:outline-none focus:border-[#3F3F46]"
                />
                <button
                  type="button"
                  onClick={saveNew}
                  disabled={busy}
                  aria-label="Add category"
                  className="w-10 h-10 flex items-center justify-center rounded-lg bg-[#3F3F46] text-white hover:bg-[#27272A] disabled:opacity-60 cursor-pointer"
                >
                  {busy ? <Loader2 className="w-4 h-4 animate-spin" /> : <Check className="w-4 h-4" />}
                </button>
                <button
                  type="button"
                  onClick={reset}
                  disabled={busy}
                  aria-label="Cancel"
                  className="w-10 h-10 flex items-center justify-center rounded-lg text-black/60 hover:bg-black/5 cursor-pointer"
                >
                  <X className="w-4 h-4" />
                </button>
              </div>
            ) : (
              <button
                type="button"
                onClick={() => {
                  reset();
                  setAdding(true);
                }}
                className="w-full min-h-11 flex items-center gap-2 px-3 py-2 text-sm font-bold text-[#3F3F46] hover:bg-black/5 cursor-pointer"
              >
                <Plus className="w-4 h-4" />
                Custom category…
              </button>
            )}
          </div>

          {error && (
            <p className="px-3 py-2 text-xs font-semibold text-red-600 bg-red-50 border-t border-red-100">
              {error}
            </p>
          )}
        </div>
      )}
    </div>
  );
}
