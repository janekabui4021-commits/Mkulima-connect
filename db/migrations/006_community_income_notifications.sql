ALTER TABLE users
    ADD COLUMN IF NOT EXISTS contact_verified BOOLEAN NOT NULL DEFAULT TRUE;

CREATE TABLE IF NOT EXISTS contact_verification_codes (
    user_id INT PRIMARY KEY REFERENCES users(id) ON DELETE CASCADE,
    code_hash TEXT NOT NULL,
    expires_at TIMESTAMPTZ NOT NULL,
    attempts INT NOT NULL DEFAULT 0
);

CREATE TABLE IF NOT EXISTS farmer_groups (
    id SERIAL PRIMARY KEY,
    name TEXT NOT NULL,
    county TEXT NOT NULL,
    topic TEXT NOT NULL,
    description TEXT NOT NULL DEFAULT '',
    created_by INT NOT NULL REFERENCES users(id),
    created_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE TABLE IF NOT EXISTS farmer_group_members (
    group_id INT NOT NULL REFERENCES farmer_groups(id) ON DELETE CASCADE,
    user_id INT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
    joined_at TIMESTAMPTZ NOT NULL DEFAULT now(),
    PRIMARY KEY (group_id, user_id)
);

CREATE TABLE IF NOT EXISTS farmer_group_posts (
    id SERIAL PRIMARY KEY,
    group_id INT NOT NULL REFERENCES farmer_groups(id) ON DELETE CASCADE,
    author_id INT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
    post_type TEXT NOT NULL DEFAULT 'discussion'
        CHECK (post_type IN ('discussion', 'bulk_order')),
    body TEXT NOT NULL,
    produce_name TEXT,
    quantity NUMERIC CHECK (quantity IS NULL OR quantity > 0),
    created_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE TABLE IF NOT EXISTS farm_expenses (
    id SERIAL PRIMARY KEY,
    farm_id INT NOT NULL REFERENCES farms(id) ON DELETE CASCADE,
    client_id TEXT UNIQUE,
    category TEXT NOT NULL,
    amount_kes NUMERIC NOT NULL CHECK (amount_kes > 0),
    expense_date DATE NOT NULL,
    notes TEXT NOT NULL DEFAULT '',
    created_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE TABLE IF NOT EXISTS notifications (
    id SERIAL PRIMARY KEY,
    user_id INT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
    category TEXT NOT NULL,
    title TEXT NOT NULL,
    body TEXT NOT NULL,
    read_at TIMESTAMPTZ,
    created_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE TABLE IF NOT EXISTS price_alerts (
    id SERIAL PRIMARY KEY,
    buyer_id INT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
    product_id INT NOT NULL REFERENCES products(id) ON DELETE CASCADE,
    target_price_kes NUMERIC NOT NULL CHECK (target_price_kes > 0),
    notified_at TIMESTAMPTZ,
    UNIQUE (buyer_id, product_id)
);
