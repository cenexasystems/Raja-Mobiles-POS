"use client";

import React, { useEffect, useRef, useState } from "react";
import { Check, ChevronDown, Loader2, Pencil, Plus, Trash2, X } from "lucide-react";
import { renameCategory, removeCategory } from "@/app/pos/actions";
import { Category } from "@/lib/types";

// "General" is where products land when their category is deleted, so it is locked.
export const FALLBACK_PRODUCT_CATEGORY = "General";

type Props = {
  categories: Category[];
  value: string;
  onChange: (value: string) => void;
  /** product count per category name, shown in the delete confirmation */
  usage: Record<string, number>;
  /** admins only: shows the rename / delete icons */
  canManage: boolean;
  notify: (type: "success" | "error", message: string) => void;
  onRenamed: (cat: Category, oldName: string) => void;
  onDeleted: (cat: Category, reassigned: number) => void;
};

export default function ProductCategoryInput({
  categories,
  value,
  onChange,
  usage,
  canManage,
  notify,
  onRenamed,
  onDeleted,
}: Props) {
  const [open, setOpen] = useState(false);
  const [editingId, setEditingId] = useState<string | null>(null);
  const [editName, setEditName] = useState("");
  const [deletingId, setDeletingId] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const wrapperRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    if (!open) return;
    const onDown = (e: MouseEvent | TouchEvent) => {
      if (!wrapperRef.current?.contains(e.target as Node)) {
        setOpen(false);
        setEditingId(null);
        setDeletingId(null);
      }
    };
    document.addEventListener("mousedown", onDown);
    document.addEventListener("touchstart", onDown);
    return () => {
      document.removeEventListener("mousedown", onDown);
      document.removeEventListener("touchstart", onDown);
    };
  }, [open]);

  const typed = value.trim().toLowerCase();
  const exact = categories.some((c) => c.name.toLowerCase() === typed);
  // Filter while typing; once the text matches a category exactly, show the full list again.
  const visible =
    typed && !exact
      ? categories.filter((c) => c.name.toLowerCase().includes(typed))
      : categories;
  const isNew = typed !== "" && !exact;

  const resetRow = () => {
    setEditingId(null);
    setDeletingId(null);
  };

  const saveEdit = async (cat: Category) => {
    const name = editName.trim();
    if (!name) return notify("error", "Category name can't be empty.");
    if (name === cat.name) return resetRow();
    setBusy(true);
    try {
      const res = await renameCategory(cat.id, name);
      if (!res.ok) return notify("error", res.error);
      onRenamed(res.data, cat.name);
      notify("success", `Renamed to "${res.data.name}". Products updated.`);
      resetRow();
    } catch {
      notify("error", "Could not rename the category.");
    } finally {
      setBusy(false);
    }
  };

  const confirmDelete = async (cat: Category) => {
    setBusy(true);
    try {
      const res = await removeCategory(cat.id);
      if (!res.ok) return notify("error", res.error);
      onDeleted(cat, res.data.reassigned);
      notify(
        "success",
        res.data.reassigned > 0
          ? `Deleted "${cat.name}". ${res.data.reassigned} product${res.data.reassigned === 1 ? "" : "s"} moved to ${FALLBACK_PRODUCT_CATEGORY}.`
          : `Deleted "${cat.name}".`,
      );
      resetRow();
    } catch {
      notify("error", "Could not delete the category.");
    } finally {
      setBusy(false);
    }
  };

  return (
    <div ref={wrapperRef} className="relative">
      <input
        type="text"
        autoComplete="off"
        placeholder="e.g., Phones, Chargers, Laptops"
        className="w-full bg-white border border-gray-200 hover:border-gray-300 focus:border-[#3F3F46] rounded-lg pl-3.5 pr-10 py-2.5 text-sm font-semibold text-black focus:outline-none transition-colors shadow-xs"
        value={value}
        onFocus={() => setOpen(true)}
        onChange={(e) => {
          onChange(e.target.value);
          setOpen(true);
        }}
        onKeyDown={(e) => {
          if (e.key === "Escape") setOpen(false);
        }}
      />
      <button
        type="button"
        tabIndex={-1}
        aria-label="Show categories"
        onClick={() => setOpen((o) => !o)}
        className="absolute right-0 top-0 h-full w-10 flex items-center justify-center text-black/60 cursor-pointer"
      >
        <ChevronDown className={`w-4 h-4 transition-transform ${open ? "rotate-180" : ""}`} />
      </button>

      {open && (
        <div className="absolute z-30 mt-1 w-full bg-white border border-gray-200 rounded-xl shadow-lg overflow-hidden">
          <ul className="max-h-56 overflow-y-auto overscroll-contain divide-y divide-gray-100">
            {visible.map((cat) => {
              const locked =
                !canManage || cat.name.toLowerCase() === FALLBACK_PRODUCT_CATEGORY.toLowerCase();

              if (editingId === cat.id) {
                return (
                  <li key={cat.id} className="flex items-center gap-1 p-2 bg-gray-50">
                    <input
                      autoFocus
                      type="text"
                      value={editName}
                      disabled={busy}
                      onChange={(e) => setEditName(e.target.value)}
                      onKeyDown={(e) => {
                        if (e.key === "Enter") saveEdit(cat);
                        if (e.key === "Escape") resetRow();
                      }}
                      className="flex-1 min-w-0 bg-white border border-gray-200 rounded-lg px-3 py-2 text-sm font-semibold focus:outline-none focus:border-[#3F3F46]"
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
                      onClick={resetRow}
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
                  <li key={cat.id} className="p-3 bg-gray-50">
                    <p className="text-sm font-bold text-black">Delete this category?</p>
                    <p className="text-xs text-black/60 mt-0.5">
                      {n > 0
                        ? `${n} product${n === 1 ? "" : "s"} use "${cat.name}" and will move to ${FALLBACK_PRODUCT_CATEGORY}.`
                        : `No products use "${cat.name}".`}
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
                        onClick={resetRow}
                        disabled={busy}
                        className="flex-1 h-10 rounded-lg border border-gray-200 text-xs font-black uppercase tracking-wider text-black hover:bg-black/5 cursor-pointer"
                      >
                        Cancel
                      </button>
                    </div>
                  </li>
                );
              }

              return (
                <li key={cat.id} className="flex items-center">
                  <button
                    type="button"
                    onClick={() => {
                      onChange(cat.name);
                      resetRow();
                      setOpen(false);
                    }}
                    className="flex-1 min-w-0 min-h-11 px-3.5 py-2 text-sm font-semibold text-left text-black hover:bg-gray-50 truncate cursor-pointer"
                  >
                    {cat.name}
                  </button>
                  {!locked && (
                    <>
                      <button
                        type="button"
                        aria-label={`Rename ${cat.name}`}
                        title="Rename"
                        onMouseDown={(e) => e.stopPropagation()}
                        onClick={(e) => {
                          e.stopPropagation();
                          resetRow();
                          setEditingId(cat.id);
                          setEditName(cat.name);
                        }}
                        className="w-10 h-11 flex items-center justify-center text-black/50 hover:text-[#3F3F46] hover:bg-black/5 cursor-pointer"
                      >
                        <Pencil className="w-4 h-4" />
                      </button>
                      <button
                        type="button"
                        aria-label={`Delete ${cat.name}`}
                        title="Delete"
                        onMouseDown={(e) => e.stopPropagation()}
                        onClick={(e) => {
                          e.stopPropagation();
                          resetRow();
                          setDeletingId(cat.id);
                        }}
                        className="w-10 h-11 flex items-center justify-center text-black/50 hover:text-red-600 hover:bg-red-50 cursor-pointer"
                      >
                        <Trash2 className="w-4 h-4" />
                      </button>
                    </>
                  )}
                </li>
              );
            })}
            {visible.length === 0 && !isNew && (
              <li className="px-3.5 py-3 text-xs font-semibold text-black/50">No categories yet.</li>
            )}
          </ul>
          {isNew && (
            <button
              type="button"
              onClick={() => setOpen(false)}
              className="w-full min-h-11 flex items-center gap-2 px-3.5 py-2 text-xs font-bold text-[#3F3F46] border-t border-gray-100 hover:bg-gray-50 text-left cursor-pointer"
            >
              <Plus className="w-4 h-4 shrink-0" />
              <span className="truncate">Add &ldquo;{value.trim()}&rdquo; as a new category</span>
            </button>
          )}
        </div>
      )}
    </div>
  );
}
