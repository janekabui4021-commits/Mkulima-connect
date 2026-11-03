ALTER TABLE products
    ADD COLUMN IF NOT EXISTS grade TEXT NOT NULL DEFAULT 'Grade A';

CREATE TABLE IF NOT EXISTS buyer_crop_demands (
    id SERIAL PRIMARY KEY,
    buyer_id INT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
    crop_name TEXT NOT NULL,
    county TEXT NOT NULL,
    min_quantity NUMERIC NOT NULL CHECK (min_quantity > 0),
    unit TEXT NOT NULL,
    harvest_from DATE,
    harvest_to DATE,
    max_price_kes NUMERIC,
    active BOOLEAN NOT NULL DEFAULT TRUE,
    created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
    CHECK (harvest_to IS NULL OR harvest_from IS NULL OR harvest_to >= harvest_from),
    CHECK (max_price_kes IS NULL OR max_price_kes > 0)
);

CREATE INDEX IF NOT EXISTS idx_buyer_crop_demands_match
    ON buyer_crop_demands (active, county, crop_name, unit);

CREATE TABLE IF NOT EXISTS offtake_contracts (
    id SERIAL PRIMARY KEY,
    demand_id INT NOT NULL REFERENCES buyer_crop_demands(id),
    product_id INT NOT NULL REFERENCES products(id),
    buyer_id INT NOT NULL REFERENCES users(id),
    farmer_id INT NOT NULL REFERENCES users(id),
    quantity NUMERIC NOT NULL CHECK (quantity > 0),
    unit TEXT NOT NULL,
    unit_price_kes NUMERIC NOT NULL CHECK (unit_price_kes > 0),
    grade TEXT NOT NULL,
    harvest_date DATE NOT NULL,
    delivery_location TEXT NOT NULL,
    status TEXT NOT NULL DEFAULT 'proposed' CHECK (
        status IN ('proposed', 'confirmed', 'declined', 'cancelled', 'fulfilled', 'expired')
    ),
    expires_at TIMESTAMPTZ NOT NULL,
    created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
    updated_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS idx_offtake_contracts_buyer
    ON offtake_contracts (buyer_id, updated_at);
CREATE INDEX IF NOT EXISTS idx_offtake_contracts_farmer
    ON offtake_contracts (farmer_id, updated_at);
CREATE INDEX IF NOT EXISTS idx_offtake_contracts_reservations
    ON offtake_contracts (product_id, status);
