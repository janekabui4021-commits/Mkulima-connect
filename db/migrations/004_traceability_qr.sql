ALTER TABLE farms
    ADD COLUMN IF NOT EXISTS farming_methods TEXT NOT NULL DEFAULT '';

ALTER TABLE products
    ADD COLUMN IF NOT EXISTS trace_code TEXT;

UPDATE products
SET trace_code = md5(random()::text || clock_timestamp()::text)
WHERE trace_code IS NULL;

ALTER TABLE products
    ALTER COLUMN trace_code
        SET DEFAULT md5(random()::text || clock_timestamp()::text),
    ALTER COLUMN trace_code SET NOT NULL;

CREATE UNIQUE INDEX IF NOT EXISTS idx_products_trace_code
    ON products (trace_code);
