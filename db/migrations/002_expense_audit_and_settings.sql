-- Who added each expense, plus adjustable staff permissions.
-- Idempotent. dbStore also runs this lazily on first use.

ALTER TABLE expenses
  ADD COLUMN IF NOT EXISTS created_by      TEXT,
  ADD COLUMN IF NOT EXISTS created_by_role TEXT;
-- (expenses.created_at already exists and is the "added at" timestamp.)

-- Existing rows predate tracking: created_by stays NULL and shows as "—". Only admins can edit them.

CREATE TABLE IF NOT EXISTS app_settings (
  key        TEXT PRIMARY KEY,
  value      TEXT NOT NULL,
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

INSERT INTO app_settings (key, value) VALUES
  ('staff_expense_edit_window', 'same_day'),  -- same_day | 24h | 7d | never
  ('staff_expense_show_totals', 'false')      -- 'true' lets staff see totals + Spend by Category
ON CONFLICT (key) DO NOTHING;
