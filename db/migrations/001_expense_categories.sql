-- Expense categories (separate from the product-catalog "categories" table).
-- Idempotent: safe to run more than once. dbStore also runs this lazily on first use.

CREATE TABLE IF NOT EXISTS expense_categories (
  id         TEXT PRIMARY KEY,
  name       TEXT NOT NULL,
  sort_order INTEGER NOT NULL DEFAULT 0,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

-- Names are unique ignoring case ("rent" == "Rent").
CREATE UNIQUE INDEX IF NOT EXISTS expense_categories_name_lower_key
  ON expense_categories (LOWER(name));

-- Seed the default list.
INSERT INTO expense_categories (id, name, sort_order) VALUES
  (gen_random_uuid()::text, 'Stock Purchase',        1),
  (gen_random_uuid()::text, 'Rent',                  2),
  (gen_random_uuid()::text, 'Salaries',              3),
  (gen_random_uuid()::text, 'Utilities',             4),
  (gen_random_uuid()::text, 'Electricity',           5),
  (gen_random_uuid()::text, 'Transport',             6),
  (gen_random_uuid()::text, 'Marketing',             7),
  (gen_random_uuid()::text, 'Repairs & Maintenance', 8),
  (gen_random_uuid()::text, 'Taxes & Fees',          9),
  (gen_random_uuid()::text, 'Miscellaneous',         10)
ON CONFLICT DO NOTHING;

-- Bring in any custom categories already typed into existing expenses.
INSERT INTO expense_categories (id, name, sort_order)
SELECT gen_random_uuid()::text, c, 100
FROM (SELECT DISTINCT TRIM(category) AS c FROM expenses WHERE TRIM(category) <> '') s
ON CONFLICT DO NOTHING;
