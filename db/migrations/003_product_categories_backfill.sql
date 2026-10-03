-- Product categories: make the existing `categories` table the source of truth.
-- Idempotent. dbStore also runs this lazily on first use.
-- (products.category stays a text column holding the category name; rename/delete rewrite it.)

-- "General" must always exist: it is where products land when their category is deleted.
INSERT INTO categories (id, name)
SELECT gen_random_uuid()::text, 'General'
WHERE NOT EXISTS (SELECT 1 FROM categories WHERE LOWER(name) = 'general');

-- Backfill any category already used by a product but missing from the table
-- (one row per name, ignoring upper/lower case).
INSERT INTO categories (id, name)
SELECT gen_random_uuid()::text, s.c
FROM (
  SELECT MIN(TRIM(category)) AS c
  FROM products
  WHERE category IS NOT NULL AND TRIM(category) <> ''
  GROUP BY LOWER(TRIM(category))
) s
WHERE NOT EXISTS (SELECT 1 FROM categories x WHERE LOWER(x.name) = LOWER(s.c));
