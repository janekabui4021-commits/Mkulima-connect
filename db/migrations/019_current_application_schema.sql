ALTER TABLE users
    ADD COLUMN IF NOT EXISTS account_status TEXT NOT NULL DEFAULT 'active'
        CHECK (account_status IN ('active', 'suspended', 'pending', 'disabled'));

ALTER TABLE farms
    ADD COLUMN IF NOT EXISTS admin_suspended BOOLEAN NOT NULL DEFAULT FALSE;

ALTER TABLE farmer_groups
    ADD COLUMN IF NOT EXISTS admin_suspended BOOLEAN NOT NULL DEFAULT FALSE;

ALTER TABLE products
    ADD COLUMN IF NOT EXISTS category TEXT NOT NULL DEFAULT 'Other',
    ADD COLUMN IF NOT EXISTS variety TEXT NOT NULL DEFAULT 'Standard',
    ADD COLUMN IF NOT EXISTS admin_suspended BOOLEAN NOT NULL DEFAULT FALSE;

CREATE UNIQUE INDEX IF NOT EXISTS idx_products_farm_name_unit_variety
    ON products (farm_id, name, unit, variety);

ALTER TABLE buyer_crop_demands
    ADD COLUMN IF NOT EXISTS variety TEXT NOT NULL DEFAULT '',
    ADD COLUMN IF NOT EXISTS request_type TEXT NOT NULL DEFAULT 'preorder'
        CHECK (request_type IN ('bulk', 'preorder')),
    ADD COLUMN IF NOT EXISTS recurrence TEXT NOT NULL DEFAULT 'one_off'
        CHECK (recurrence IN ('one_off', 'weekly', 'monthly')),
    ADD COLUMN IF NOT EXISTS needed_by DATE,
    ADD COLUMN IF NOT EXISTS delivery_location TEXT NOT NULL DEFAULT '',
    ADD COLUMN IF NOT EXISTS delivery_method TEXT NOT NULL DEFAULT 'delivery'
        CHECK (delivery_method IN ('pickup', 'delivery')),
    ADD COLUMN IF NOT EXISTS quality_notes TEXT NOT NULL DEFAULT '',
    ADD COLUMN IF NOT EXISTS buyer_name TEXT NOT NULL DEFAULT '',
    ADD COLUMN IF NOT EXISTS business_name TEXT NOT NULL DEFAULT '',
    ADD COLUMN IF NOT EXISTS buyer_phone TEXT NOT NULL DEFAULT '',
    ADD COLUMN IF NOT EXISTS buyer_email TEXT NOT NULL DEFAULT '',
    ADD COLUMN IF NOT EXISTS farm_id INT REFERENCES farms(id);

CREATE TABLE IF NOT EXISTS offtake_quotes (
    id SERIAL PRIMARY KEY,
    demand_id INT NOT NULL REFERENCES buyer_crop_demands(id) ON DELETE CASCADE,
    farmer_id INT NOT NULL REFERENCES users(id),
    farm_id INT NOT NULL REFERENCES farms(id),
    product_id INT REFERENCES products(id),
    quantity NUMERIC NOT NULL CHECK (quantity > 0),
    unit TEXT NOT NULL,
    unit_price_kes NUMERIC NOT NULL CHECK (unit_price_kes > 0),
    quality_notes TEXT NOT NULL DEFAULT '',
    delivery_location TEXT NOT NULL,
    status TEXT NOT NULL DEFAULT 'quoted' CHECK (
        status IN ('quoted', 'countered', 'accepted', 'declined',
                   'cancelled', 'fulfilled', 'expired')
    ),
    order_id INT REFERENCES orders(id),
    supersedes_quote_id INT REFERENCES offtake_quotes(id),
    expires_at TIMESTAMPTZ NOT NULL,
    created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
    updated_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS idx_offtake_quotes_demand
    ON offtake_quotes (demand_id, status, created_at);
CREATE INDEX IF NOT EXISTS idx_offtake_quotes_farmer
    ON offtake_quotes (farmer_id, status, created_at);

ALTER TABLE reviews
    ADD COLUMN IF NOT EXISTS rating NUMERIC;

CREATE TABLE IF NOT EXISTS marketplace_settings (
    setting_key TEXT PRIMARY KEY,
    setting_value TEXT NOT NULL
);

CREATE TABLE IF NOT EXISTS content_reports (
    id SERIAL PRIMARY KEY,
    reporter_id INT NOT NULL REFERENCES users(id),
    target_type TEXT NOT NULL CHECK (target_type IN ('product', 'user', 'group')),
    target_id INT NOT NULL,
    reason TEXT NOT NULL,
    status TEXT NOT NULL DEFAULT 'open' CHECK (
        status IN ('open', 'reviewed', 'actioned', 'dismissed')
    ),
    admin_note TEXT NOT NULL DEFAULT '',
    created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
    updated_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE TABLE IF NOT EXISTS admin_audit_logs (
    id SERIAL PRIMARY KEY,
    admin_id INT NOT NULL REFERENCES users(id),
    action TEXT NOT NULL,
    entity_type TEXT NOT NULL,
    entity_id INT,
    details TEXT NOT NULL DEFAULT '{}',
    created_at TIMESTAMPTZ NOT NULL DEFAULT now()
);
