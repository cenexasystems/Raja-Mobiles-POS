import type { Expense, ExpenseSettings } from './types';
import type { Session } from './auth';

export const DEFAULT_EXPENSE_SETTINGS: ExpenseSettings = {
  staffEditWindow: 'same_day',
  staffShowTotals: false,
};

// The shop runs on India time, so "same day" means the same IST calendar day.
const istDay = (ms: number) => new Date(ms + 5.5 * 60 * 60 * 1000).toISOString().slice(0, 10);

/**
 * Single source of truth for "may this user edit/delete this expense?".
 * Used by the server actions (enforcement) and the UI (to show/hide buttons).
 * Admin: always. Staff: only their own, and only inside the admin-configured window.
 */
export function canModifyExpense(
  expense: Pick<Expense, 'created_by' | 'created_by_role' | 'created_at'>,
  session: Session,
  settings: ExpenseSettings,
  now: number = Date.now(),
): boolean {
  if (session.role === 'admin') return true;
  if (expense.created_by_role !== 'staff' || !expense.created_by) return false;
  if (expense.created_by.trim().toLowerCase() !== session.name.trim().toLowerCase()) return false;
  const created = new Date(expense.created_at).getTime();
  if (isNaN(created)) return false;
  switch (settings.staffEditWindow) {
    case 'same_day':
      return istDay(created) === istDay(now);
    case '24h':
      return now - created <= 24 * 60 * 60 * 1000;
    case '7d':
      return now - created <= 7 * 24 * 60 * 60 * 1000;
    default:
      return false;
  }
}
