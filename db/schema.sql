CREATE TYPE user_role AS ENUM ('farmer', 'buyer', 'admin');
CREATE TYPE verify_status AS ENUM ('pending', 'verified', 'rejected');
CREATE TYPE order_status AS ENUM ('pending', 'paid', 'shipped', 'delivered', 'cancelled');

CREATE TABLE users (
    id SERIAL PRIMARY KEY,
    name TEXT NOT NULL,
    phone TEXT UNIQUE NOT NULL,
    email TEXT UNIQUE,
    password_hash TEXT NOT NULL,
    role user_role NOT NULL,
    phone_verified BOOLEAN NOT NULL DEFAULT FALSE,
    account_status TEXT NOT NULL DEFAULT 'active' CHECK (
        account_status IN ('active', 'suspended', 'pending', 'disabled')
    ),
    created_at TIMESTAMPTZ DEFAULT now()
);

CREATE TABLE farms (
    id SERIAL PRIMARY KEY,
    owner_id INT REFERENCES users(id) ON DELETE CASCADE,
    name TEXT NOT NULL,
    county TEXT NOT NULL,
    size_acres NUMERIC,
    id_doc_url TEXT,
    rating NUMERIC(2, 1) DEFAULT 4.5,
    delivery_days INT DEFAULT 2,
    status verify_status DEFAULT 'pending',
    admin_suspended BOOLEAN NOT NULL DEFAULT FALSE,
    verified_at TIMESTAMPTZ,
    latitude NUMERIC(9, 6),
    longitude NUMERIC(9, 6),
    farming_methods TEXT NOT NULL DEFAULT '',
    verification_level TEXT NOT NULL DEFAULT 'full' CHECK (
        verification_level IN ('unverified', 'provisional', 'full')
    ),
    farm_boundary TEXT,
    verification_video_path TEXT,
    verification_video_latitude NUMERIC(9, 6),
    verification_video_longitude NUMERIC(9, 6),
    verification_video_accuracy_m NUMERIC,
    verification_video_recorded_at TIMESTAMPTZ,
    verification_code TEXT,
    verification_submitted_at TIMESTAMPTZ
);

CREATE TABLE farmer_phone_otps (
    user_id INT PRIMARY KEY REFERENCES users(id) ON DELETE CASCADE,
    phone TEXT NOT NULL,
    code_hash TEXT NOT NULL,
    expires_at TIMESTAMPTZ NOT NULL,
    attempts INT NOT NULL DEFAULT 0,
    last_sent_at TIMESTAMPTZ NOT NULL
);

CREATE TABLE transporter_profiles (
    id SERIAL PRIMARY KEY,
    user_id INT NOT NULL UNIQUE REFERENCES users(id) ON DELETE CASCADE,
    display_name TEXT NOT NULL,
    contact_phone TEXT NOT NULL,
    vehicle_type TEXT NOT NULL,
    capacity_kg NUMERIC NOT NULL CHECK (capacity_kg > 0),
    service_counties TEXT NOT NULL,
    details TEXT NOT NULL DEFAULT '',
    available BOOLEAN NOT NULL DEFAULT TRUE,
    contact_consent BOOLEAN NOT NULL DEFAULT FALSE,
    updated_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE TABLE transporter_messages (
    id SERIAL PRIMARY KEY,
    transporter_id INT NOT NULL REFERENCES transporter_profiles(id) ON DELETE CASCADE,
    requester_id INT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
    sender_id INT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
    body TEXT NOT NULL,
    created_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE INDEX idx_transporter_messages_conversation
    ON transporter_messages (transporter_id, requester_id, id);

CREATE TABLE products (
    id SERIAL PRIMARY KEY,
    farm_id INT REFERENCES farms(id) ON DELETE CASCADE,
    name TEXT NOT NULL,
    description TEXT NOT NULL DEFAULT '',
    category TEXT NOT NULL DEFAULT 'Other',
    variety TEXT NOT NULL DEFAULT 'Standard',
    unit TEXT DEFAULT 'kg',
    price_kes NUMERIC(10, 2) NOT NULL,
    stock NUMERIC NOT NULL,
    harvest_date DATE,
    grade TEXT NOT NULL DEFAULT 'Grade A',
    image_url TEXT,
    preorder_enabled BOOLEAN NOT NULL DEFAULT FALSE,
    season_tier TEXT NOT NULL DEFAULT 'in_season' CHECK (
        season_tier IN ('early', 'peak', 'late', 'in_season')
    ),
    admin_suspended BOOLEAN NOT NULL DEFAULT FALSE,
    trace_code TEXT NOT NULL UNIQUE
        DEFAULT md5(random()::text || clock_timestamp()::text)
);

CREATE TABLE buyer_favorites (
    buyer_id INT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
    product_id INT NOT NULL REFERENCES products(id) ON DELETE CASCADE,
    created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
    PRIMARY KEY (buyer_id, product_id)
);

CREATE TABLE farmer_groups (
    id SERIAL PRIMARY KEY,
    name TEXT NOT NULL,
    county TEXT NOT NULL,
    topic TEXT NOT NULL,
    description TEXT NOT NULL DEFAULT '',
    created_by INT NOT NULL REFERENCES users(id),
    admin_suspended BOOLEAN NOT NULL DEFAULT FALSE,
    created_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE TABLE farmer_group_members (
    group_id INT NOT NULL REFERENCES farmer_groups(id) ON DELETE CASCADE,
    user_id INT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
    joined_at TIMESTAMPTZ NOT NULL DEFAULT now(),
    PRIMARY KEY (group_id, user_id)
);

CREATE TABLE farmer_group_posts (
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

CREATE TABLE farm_expenses (
    id SERIAL PRIMARY KEY,
    farm_id INT NOT NULL REFERENCES farms(id) ON DELETE CASCADE,
    client_id TEXT UNIQUE,
    category TEXT NOT NULL,
    amount_kes NUMERIC NOT NULL CHECK (amount_kes > 0),
    expense_date DATE NOT NULL,
    notes TEXT NOT NULL DEFAULT '',
    created_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE TABLE notifications (
    id SERIAL PRIMARY KEY,
    user_id INT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
    category TEXT NOT NULL,
    title TEXT NOT NULL,
    body TEXT NOT NULL,
    read_at TIMESTAMPTZ,
    created_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE TABLE marketplace_settings (
    setting_key TEXT PRIMARY KEY,
    setting_value TEXT NOT NULL
);

CREATE TABLE content_reports (
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

CREATE TABLE price_alerts (
    id SERIAL PRIMARY KEY,
    buyer_id INT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
    product_id INT NOT NULL REFERENCES products(id) ON DELETE CASCADE,
    target_price_kes NUMERIC NOT NULL CHECK (target_price_kes > 0),
    notified_at TIMESTAMPTZ,
    UNIQUE (buyer_id, product_id)
);

CREATE TABLE orders (
    id SERIAL PRIMARY KEY,
    buyer_id INT REFERENCES users(id),
    total_kes NUMERIC(12, 2) DEFAULT 0,
    status order_status DEFAULT 'pending',
    created_at TIMESTAMPTZ DEFAULT now()
);

CREATE TABLE order_items (
    id SERIAL PRIMARY KEY,
    order_id INT REFERENCES orders(id) ON DELETE CASCADE,
    product_id INT REFERENCES products(id),
    qty NUMERIC NOT NULL,
    price_kes NUMERIC(10, 2),
    fulfillment_status TEXT NOT NULL DEFAULT 'pending' CHECK (
        fulfillment_status IN ('pending', 'processing', 'ready', 'shipped', 'delivered', 'cancelled')
    )
);

CREATE TABLE payments (
    id SERIAL PRIMARY KEY,
    order_id INT REFERENCES orders(id),
    checkout_request_id TEXT UNIQUE,
    mpesa_receipt TEXT,
    amount NUMERIC(12, 2),
    phone TEXT,
    status TEXT DEFAULT 'initiated',
    created_at TIMESTAMPTZ DEFAULT now()
);

CREATE TABLE messages (
    id SERIAL PRIMARY KEY,
    buyer_id INT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
    farm_id INT NOT NULL REFERENCES farms(id) ON DELETE CASCADE,
    sender_role TEXT NOT NULL CHECK (sender_role IN ('buyer', 'farmer')),
    body TEXT NOT NULL,
    created_at TIMESTAMPTZ DEFAULT now()
);

CREATE INDEX idx_messages_conversation ON messages (buyer_id, farm_id, id);

CREATE TABLE conversations (
    id SERIAL PRIMARY KEY,
    product_id INT NOT NULL REFERENCES products(id) ON DELETE CASCADE,
    buyer_id INT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
    farmer_id INT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
    status TEXT NOT NULL DEFAULT 'active' CHECK (status IN ('active', 'archived')),
    created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
    updated_at TIMESTAMPTZ NOT NULL DEFAULT now(),
    UNIQUE (product_id, buyer_id)
);

CREATE INDEX idx_conversations_buyer ON conversations (buyer_id, updated_at);
CREATE INDEX idx_conversations_farmer ON conversations (farmer_id, updated_at);

CREATE TABLE conversation_messages (
    id SERIAL PRIMARY KEY,
    conversation_id INT NOT NULL REFERENCES conversations(id) ON DELETE CASCADE,
    sender_id INT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
    sender_role TEXT NOT NULL CHECK (sender_role IN ('buyer', 'farmer')),
    body TEXT NOT NULL,
    sent_via TEXT NOT NULL DEFAULT 'app' CHECK (sent_via IN ('app', 'sms')),
    provider_message_id TEXT UNIQUE,
    created_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE INDEX idx_conversation_messages_thread
    ON conversation_messages (conversation_id, id);

CREATE TABLE conversation_bot_messages (
    id SERIAL PRIMARY KEY,
    conversation_id INT NOT NULL REFERENCES conversations(id) ON DELETE CASCADE,
    body TEXT NOT NULL,
    created_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE INDEX idx_conversation_bot_messages_thread
    ON conversation_bot_messages (conversation_id, id);

CREATE TABLE conversation_blocks (
    conversation_id INT NOT NULL REFERENCES conversations(id) ON DELETE CASCADE,
    user_id INT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
    created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
    PRIMARY KEY (conversation_id, user_id)
);

CREATE TABLE conversation_reports (
    id SERIAL PRIMARY KEY,
    conversation_id INT NOT NULL REFERENCES conversations(id) ON DELETE CASCADE,
    reporter_id INT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
    reason TEXT NOT NULL,
    status TEXT NOT NULL DEFAULT 'open' CHECK (
        status IN ('open', 'reviewed', 'actioned', 'dismissed')
    ),
    admin_note TEXT NOT NULL DEFAULT '',
    created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
    updated_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE INDEX idx_conversation_reports_status
    ON conversation_reports (status, id);

CREATE TABLE buyer_crop_demands (
    id SERIAL PRIMARY KEY,
    buyer_id INT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
    crop_name TEXT NOT NULL,
    variety TEXT NOT NULL DEFAULT '',
    county TEXT NOT NULL,
    min_quantity NUMERIC NOT NULL CHECK (min_quantity > 0),
    unit TEXT NOT NULL,
    request_type TEXT NOT NULL DEFAULT 'preorder' CHECK (
        request_type IN ('bulk', 'preorder')
    ),
    recurrence TEXT NOT NULL DEFAULT 'one_off' CHECK (
        recurrence IN ('one_off', 'weekly', 'monthly')
    ),
    harvest_from DATE,
    harvest_to DATE,
    needed_by DATE,
    max_price_kes NUMERIC,
    delivery_location TEXT NOT NULL DEFAULT '',
    delivery_method TEXT NOT NULL DEFAULT 'delivery' CHECK (
        delivery_method IN ('pickup', 'delivery')
    ),
    quality_notes TEXT NOT NULL DEFAULT '',
    buyer_name TEXT NOT NULL DEFAULT '',
    business_name TEXT NOT NULL DEFAULT '',
    buyer_phone TEXT NOT NULL DEFAULT '',
    buyer_email TEXT NOT NULL DEFAULT '',
    farm_id INT REFERENCES farms(id),
    active BOOLEAN NOT NULL DEFAULT TRUE,
    created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
    CHECK (harvest_to IS NULL OR harvest_from IS NULL OR harvest_to >= harvest_from),
    CHECK (max_price_kes IS NULL OR max_price_kes > 0)
);

CREATE INDEX idx_buyer_crop_demands_match
    ON buyer_crop_demands (active, county, crop_name, unit);

CREATE TABLE offtake_contracts (
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

CREATE INDEX idx_offtake_contracts_buyer
    ON offtake_contracts (buyer_id, updated_at);
CREATE INDEX idx_offtake_contracts_farmer
    ON offtake_contracts (farmer_id, updated_at);
CREATE INDEX idx_offtake_contracts_reservations
    ON offtake_contracts (product_id, status);

CREATE TABLE offtake_quotes (
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

CREATE INDEX idx_offtake_quotes_demand
    ON offtake_quotes (demand_id, status, created_at);
CREATE INDEX idx_offtake_quotes_farmer
    ON offtake_quotes (farmer_id, status, created_at);

CREATE TABLE reviews (
    id SERIAL PRIMARY KEY,
    order_item_id INT NOT NULL UNIQUE REFERENCES order_items(id) ON DELETE CASCADE,
    buyer_id INT NOT NULL REFERENCES users(id),
    farm_id INT NOT NULL REFERENCES farms(id) ON DELETE CASCADE,
    quality_rating INT NOT NULL CHECK (quality_rating BETWEEN 1 AND 5),
    delivery_speed_rating INT NOT NULL CHECK (delivery_speed_rating BETWEEN 1 AND 5),
    rating NUMERIC,
    comment TEXT NOT NULL DEFAULT '',
    created_at TIMESTAMPTZ DEFAULT now()
);

CREATE INDEX idx_reviews_farm ON reviews (farm_id, id);

CREATE TABLE admin_audit_logs (
    id SERIAL PRIMARY KEY,
    admin_id INT NOT NULL REFERENCES users(id),
    action TEXT NOT NULL,
    entity_type TEXT NOT NULL,
    entity_id INT,
    details TEXT NOT NULL DEFAULT '{}',
    created_at TIMESTAMPTZ NOT NULL DEFAULT now()
);
