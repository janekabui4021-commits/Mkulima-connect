PRAGMA foreign_keys = ON;

CREATE TABLE IF NOT EXISTS users (
    id INTEGER PRIMARY KEY,
    name TEXT NOT NULL,
    phone TEXT UNIQUE NOT NULL,
    email TEXT UNIQUE,
    password_hash TEXT NOT NULL,
    role TEXT NOT NULL CHECK (role IN ('farmer', 'buyer', 'admin')),
    phone_verified INTEGER NOT NULL DEFAULT 0 CHECK (phone_verified IN (0, 1)),
    account_status TEXT NOT NULL DEFAULT 'active' CHECK (
        account_status IN ('active', 'suspended', 'pending', 'disabled')
    ),
    token_version INTEGER NOT NULL DEFAULT 0,
    created_at TEXT DEFAULT CURRENT_TIMESTAMP
);

CREATE TABLE IF NOT EXISTS farms (
    id INTEGER PRIMARY KEY,
    owner_id INTEGER REFERENCES users(id) ON DELETE CASCADE,
    name TEXT NOT NULL,
    county TEXT NOT NULL,
    size_acres NUMERIC,
    id_doc_url TEXT,
    rating NUMERIC DEFAULT 4.5,
    delivery_days INTEGER DEFAULT 2,
    status TEXT DEFAULT 'pending' CHECK (status IN ('pending', 'verified', 'rejected')),
    admin_suspended INTEGER NOT NULL DEFAULT 0 CHECK (admin_suspended IN (0, 1)),
    verified_at TEXT,
    latitude NUMERIC,
    longitude NUMERIC,
    farming_methods TEXT NOT NULL DEFAULT '',
    verification_level TEXT NOT NULL DEFAULT 'full' CHECK (
        verification_level IN ('unverified', 'provisional', 'full')
    ),
    farm_boundary TEXT,
    verification_video_path TEXT,
    verification_video_latitude NUMERIC,
    verification_video_longitude NUMERIC,
    verification_video_accuracy_m NUMERIC,
    verification_video_recorded_at TEXT,
    verification_code TEXT,
    verification_submitted_at TEXT,
    UNIQUE (name, county)
);

CREATE TABLE IF NOT EXISTS farmer_phone_otps (
    user_id INTEGER PRIMARY KEY REFERENCES users(id) ON DELETE CASCADE,
    phone TEXT NOT NULL,
    code_hash TEXT NOT NULL,
    expires_at TEXT NOT NULL,
    attempts INTEGER NOT NULL DEFAULT 0,
    last_sent_at TEXT NOT NULL
);

CREATE TABLE IF NOT EXISTS password_reset_otps (
    user_id INTEGER PRIMARY KEY REFERENCES users(id) ON DELETE CASCADE,
    phone TEXT NOT NULL,
    code_hash TEXT NOT NULL,
    expires_at TEXT NOT NULL,
    attempts INTEGER NOT NULL DEFAULT 0,
    last_sent_at TEXT NOT NULL
);

CREATE TABLE IF NOT EXISTS transporter_profiles (
    id INTEGER PRIMARY KEY,
    user_id INTEGER NOT NULL UNIQUE REFERENCES users(id) ON DELETE CASCADE,
    display_name TEXT NOT NULL,
    contact_phone TEXT NOT NULL,
    vehicle_type TEXT NOT NULL,
    capacity_kg NUMERIC NOT NULL CHECK (capacity_kg > 0),
    service_counties TEXT NOT NULL,
    details TEXT NOT NULL DEFAULT '',
    available INTEGER NOT NULL DEFAULT 1 CHECK (available IN (0, 1)),
    contact_consent INTEGER NOT NULL DEFAULT 0 CHECK (contact_consent IN (0, 1)),
    updated_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP
);

CREATE TABLE IF NOT EXISTS transporter_messages (
    id INTEGER PRIMARY KEY,
    transporter_id INTEGER NOT NULL REFERENCES transporter_profiles(id) ON DELETE CASCADE,
    requester_id INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE,
    sender_id INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE,
    body TEXT NOT NULL,
    created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP
);

CREATE INDEX IF NOT EXISTS idx_transporter_messages_conversation
    ON transporter_messages (transporter_id, requester_id, id);

CREATE TABLE IF NOT EXISTS marketplace_settings (
    setting_key TEXT PRIMARY KEY,
    setting_value TEXT NOT NULL
);

INSERT OR IGNORE INTO marketplace_settings (setting_key, setting_value) VALUES
    ('categories', '["Vegetables","Fruits","Grains & Cereals","Legumes","Dairy","Other"]'),
    ('counties', '["Kiambu","Nakuru","Meru","Kisii","Uasin Gishu","Nyandarua","Kirinyaga"]'),
    ('marketplace_enabled', 'true'),
    ('farm_applications_enabled', 'true');

CREATE TABLE IF NOT EXISTS farmer_groups (
    id INTEGER PRIMARY KEY,
    name TEXT NOT NULL,
    county TEXT NOT NULL,
    topic TEXT NOT NULL,
    description TEXT NOT NULL DEFAULT '',
    created_by INTEGER NOT NULL REFERENCES users(id),
    admin_suspended INTEGER NOT NULL DEFAULT 0 CHECK (admin_suspended IN (0, 1)),
    created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP
);

CREATE TABLE IF NOT EXISTS farmer_group_members (
    group_id INTEGER NOT NULL REFERENCES farmer_groups(id) ON DELETE CASCADE,
    user_id INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE,
    joined_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
    PRIMARY KEY (group_id, user_id)
);

CREATE TABLE IF NOT EXISTS farmer_group_posts (
    id INTEGER PRIMARY KEY,
    group_id INTEGER NOT NULL REFERENCES farmer_groups(id) ON DELETE CASCADE,
    author_id INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE,
    post_type TEXT NOT NULL DEFAULT 'discussion' CHECK (post_type IN ('discussion', 'bulk_order')),
    body TEXT NOT NULL,
    produce_name TEXT,
    quantity NUMERIC,
    created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP
);

CREATE TABLE IF NOT EXISTS content_reports (
    id INTEGER PRIMARY KEY,
    reporter_id INTEGER NOT NULL REFERENCES users(id),
    target_type TEXT NOT NULL CHECK (target_type IN ('product', 'user', 'group')),
    target_id INTEGER NOT NULL,
    reason TEXT NOT NULL,
    status TEXT NOT NULL DEFAULT 'open' CHECK (
        status IN ('open', 'reviewed', 'actioned', 'dismissed')
    ),
    admin_note TEXT NOT NULL DEFAULT '',
    created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
    updated_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP
);

CREATE TABLE IF NOT EXISTS farm_expenses (
    id INTEGER PRIMARY KEY,
    farm_id INTEGER NOT NULL REFERENCES farms(id) ON DELETE CASCADE,
    client_id TEXT UNIQUE,
    category TEXT NOT NULL,
    amount_kes NUMERIC NOT NULL CHECK (amount_kes > 0),
    expense_date TEXT NOT NULL,
    notes TEXT NOT NULL DEFAULT '',
    created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP
);

CREATE TABLE IF NOT EXISTS notifications (
    id INTEGER PRIMARY KEY,
    user_id INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE,
    category TEXT NOT NULL,
    title TEXT NOT NULL,
    body TEXT NOT NULL,
    read_at TEXT,
    created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP
);

CREATE TABLE IF NOT EXISTS price_alerts (
    id INTEGER PRIMARY KEY,
    buyer_id INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE,
    product_id INTEGER NOT NULL REFERENCES products(id) ON DELETE CASCADE,
    target_price_kes NUMERIC NOT NULL CHECK (target_price_kes > 0),
    notified_at TEXT,
    UNIQUE (buyer_id, product_id)
);

CREATE TABLE IF NOT EXISTS products (
    id INTEGER PRIMARY KEY,
    farm_id INTEGER REFERENCES farms(id) ON DELETE CASCADE,
    name TEXT NOT NULL,
    description TEXT NOT NULL DEFAULT '',
    category TEXT NOT NULL DEFAULT 'Other',
    variety TEXT NOT NULL DEFAULT 'Standard',
    unit TEXT DEFAULT 'kg',
    price_kes NUMERIC NOT NULL,
    stock NUMERIC NOT NULL,
    harvest_date TEXT,
    grade TEXT NOT NULL DEFAULT 'Grade A',
    image_url TEXT,
    preorder_enabled INTEGER NOT NULL DEFAULT 0 CHECK (preorder_enabled IN (0, 1)),
    season_tier TEXT NOT NULL DEFAULT 'in_season' CHECK (
        season_tier IN ('early', 'peak', 'late', 'in_season')
    ),
    admin_suspended INTEGER NOT NULL DEFAULT 0 CHECK (admin_suspended IN (0, 1)),
    trace_code TEXT UNIQUE,
    UNIQUE (farm_id, name, unit, variety)
);

CREATE TABLE IF NOT EXISTS buyer_favorites (
    buyer_id INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE,
    product_id INTEGER NOT NULL REFERENCES products(id) ON DELETE CASCADE,
    created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
    PRIMARY KEY (buyer_id, product_id)
);

CREATE TABLE IF NOT EXISTS orders (
    id INTEGER PRIMARY KEY,
    buyer_id INTEGER REFERENCES users(id),
    total_kes NUMERIC DEFAULT 0,
    status TEXT DEFAULT 'pending' CHECK (
        status IN ('pending', 'paid', 'shipped', 'delivered', 'cancelled')
    ),
    created_at TEXT DEFAULT CURRENT_TIMESTAMP
);

CREATE TABLE IF NOT EXISTS order_items (
    id INTEGER PRIMARY KEY,
    order_id INTEGER REFERENCES orders(id) ON DELETE CASCADE,
    product_id INTEGER REFERENCES products(id),
    qty NUMERIC NOT NULL,
    price_kes NUMERIC,
    fulfillment_status TEXT NOT NULL DEFAULT 'pending' CHECK (
        fulfillment_status IN ('pending', 'processing', 'ready', 'shipped', 'delivered', 'cancelled')
    )
);

CREATE TABLE IF NOT EXISTS payments (
    id INTEGER PRIMARY KEY,
    order_id INTEGER REFERENCES orders(id),
    checkout_request_id TEXT UNIQUE,
    mpesa_receipt TEXT,
    amount NUMERIC,
    phone TEXT,
    status TEXT DEFAULT 'initiated',
    created_at TEXT DEFAULT CURRENT_TIMESTAMP
);

CREATE TABLE IF NOT EXISTS messages (
    id INTEGER PRIMARY KEY,
    buyer_id INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE,
    farm_id INTEGER NOT NULL REFERENCES farms(id) ON DELETE CASCADE,
    sender_role TEXT NOT NULL CHECK (sender_role IN ('buyer', 'farmer')),
    body TEXT NOT NULL,
    created_at TEXT DEFAULT CURRENT_TIMESTAMP
);

CREATE INDEX IF NOT EXISTS idx_messages_conversation
    ON messages (buyer_id, farm_id, id);

CREATE TABLE IF NOT EXISTS conversations (
    id INTEGER PRIMARY KEY,
    product_id INTEGER NOT NULL REFERENCES products(id) ON DELETE CASCADE,
    buyer_id INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE,
    farmer_id INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE,
    status TEXT NOT NULL DEFAULT 'active' CHECK (status IN ('active', 'archived')),
    created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
    updated_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
    UNIQUE (product_id, buyer_id)
);

CREATE INDEX IF NOT EXISTS idx_conversations_buyer
    ON conversations (buyer_id, updated_at);
CREATE INDEX IF NOT EXISTS idx_conversations_farmer
    ON conversations (farmer_id, updated_at);

CREATE TABLE IF NOT EXISTS conversation_messages (
    id INTEGER PRIMARY KEY,
    conversation_id INTEGER NOT NULL REFERENCES conversations(id) ON DELETE CASCADE,
    sender_id INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE,
    sender_role TEXT NOT NULL CHECK (sender_role IN ('buyer', 'farmer')),
    body TEXT NOT NULL,
    sent_via TEXT NOT NULL DEFAULT 'app' CHECK (sent_via IN ('app', 'sms')),
    provider_message_id TEXT UNIQUE,
    created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP
);

CREATE INDEX IF NOT EXISTS idx_conversation_messages_thread
    ON conversation_messages (conversation_id, id);

CREATE TABLE IF NOT EXISTS conversation_bot_messages (
    id INTEGER PRIMARY KEY,
    conversation_id INTEGER NOT NULL REFERENCES conversations(id) ON DELETE CASCADE,
    body TEXT NOT NULL,
    created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP
);

CREATE INDEX IF NOT EXISTS idx_conversation_bot_messages_thread
    ON conversation_bot_messages (conversation_id, id);

CREATE TABLE IF NOT EXISTS conversation_blocks (
    conversation_id INTEGER NOT NULL REFERENCES conversations(id) ON DELETE CASCADE,
    user_id INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE,
    created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
    PRIMARY KEY (conversation_id, user_id)
);

CREATE TABLE IF NOT EXISTS conversation_reports (
    id INTEGER PRIMARY KEY,
    conversation_id INTEGER NOT NULL REFERENCES conversations(id) ON DELETE CASCADE,
    reporter_id INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE,
    reason TEXT NOT NULL,
    status TEXT NOT NULL DEFAULT 'open' CHECK (
        status IN ('open', 'reviewed', 'actioned', 'dismissed')
    ),
    admin_note TEXT NOT NULL DEFAULT '',
    created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
    updated_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP
);

CREATE INDEX IF NOT EXISTS idx_conversation_reports_status
    ON conversation_reports (status, id);

CREATE TABLE IF NOT EXISTS buyer_crop_demands (
    id INTEGER PRIMARY KEY,
    buyer_id INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE,
    crop_name TEXT NOT NULL,
    variety TEXT NOT NULL DEFAULT '',
    county TEXT NOT NULL,
    min_quantity NUMERIC NOT NULL CHECK (min_quantity > 0),
    unit TEXT NOT NULL,
    harvest_from TEXT,
    harvest_to TEXT,
    max_price_kes NUMERIC,
    request_type TEXT NOT NULL DEFAULT 'preorder' CHECK (
        request_type IN ('bulk', 'preorder')
    ),
    recurrence TEXT NOT NULL DEFAULT 'one_off' CHECK (
        recurrence IN ('one_off', 'weekly', 'monthly')
    ),
    needed_by TEXT,
    delivery_location TEXT NOT NULL DEFAULT '',
    delivery_method TEXT NOT NULL DEFAULT 'delivery' CHECK (
        delivery_method IN ('pickup', 'delivery')
    ),
    quality_notes TEXT NOT NULL DEFAULT '',
    buyer_name TEXT NOT NULL DEFAULT '',
    business_name TEXT NOT NULL DEFAULT '',
    buyer_phone TEXT NOT NULL DEFAULT '',
    buyer_email TEXT NOT NULL DEFAULT '',
    farm_id INTEGER REFERENCES farms(id),
    active INTEGER NOT NULL DEFAULT 1 CHECK (active IN (0, 1)),
    created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP
);

CREATE INDEX IF NOT EXISTS idx_buyer_crop_demands_match
    ON buyer_crop_demands (active, county, crop_name, unit);

CREATE TABLE IF NOT EXISTS offtake_contracts (
    id INTEGER PRIMARY KEY,
    demand_id INTEGER NOT NULL REFERENCES buyer_crop_demands(id),
    product_id INTEGER NOT NULL REFERENCES products(id),
    buyer_id INTEGER NOT NULL REFERENCES users(id),
    farmer_id INTEGER NOT NULL REFERENCES users(id),
    quantity NUMERIC NOT NULL CHECK (quantity > 0),
    unit TEXT NOT NULL,
    unit_price_kes NUMERIC NOT NULL CHECK (unit_price_kes > 0),
    grade TEXT NOT NULL,
    harvest_date TEXT NOT NULL,
    delivery_location TEXT NOT NULL,
    status TEXT NOT NULL DEFAULT 'proposed' CHECK (
        status IN ('proposed', 'confirmed', 'declined', 'cancelled', 'fulfilled', 'expired')
    ),
    expires_at TEXT NOT NULL,
    created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
    updated_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP
);

CREATE INDEX IF NOT EXISTS idx_offtake_contracts_buyer
    ON offtake_contracts (buyer_id, updated_at);
CREATE INDEX IF NOT EXISTS idx_offtake_contracts_farmer
    ON offtake_contracts (farmer_id, updated_at);
CREATE INDEX IF NOT EXISTS idx_offtake_contracts_reservations
    ON offtake_contracts (product_id, status);

CREATE TABLE IF NOT EXISTS offtake_quotes (
    id INTEGER PRIMARY KEY,
    demand_id INTEGER NOT NULL REFERENCES buyer_crop_demands(id) ON DELETE CASCADE,
    farmer_id INTEGER NOT NULL REFERENCES users(id),
    farm_id INTEGER NOT NULL REFERENCES farms(id),
    product_id INTEGER REFERENCES products(id),
    quantity NUMERIC NOT NULL CHECK (quantity > 0),
    unit TEXT NOT NULL,
    unit_price_kes NUMERIC NOT NULL CHECK (unit_price_kes > 0),
    quality_notes TEXT NOT NULL DEFAULT '',
    delivery_location TEXT NOT NULL,
    status TEXT NOT NULL DEFAULT 'quoted' CHECK (
        status IN ('quoted', 'countered', 'accepted', 'declined', 'cancelled', 'fulfilled', 'expired')
    ),
    order_id INTEGER REFERENCES orders(id),
    supersedes_quote_id INTEGER REFERENCES offtake_quotes(id),
    expires_at TEXT NOT NULL,
    created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
    updated_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP
);

CREATE INDEX IF NOT EXISTS idx_offtake_quotes_demand
    ON offtake_quotes (demand_id, status, created_at);
CREATE INDEX IF NOT EXISTS idx_offtake_quotes_farmer
    ON offtake_quotes (farmer_id, status, created_at);

CREATE TABLE IF NOT EXISTS reviews (
    id INTEGER PRIMARY KEY,
    order_item_id INTEGER NOT NULL UNIQUE REFERENCES order_items(id) ON DELETE CASCADE,
    buyer_id INTEGER NOT NULL REFERENCES users(id),
    farm_id INTEGER NOT NULL REFERENCES farms(id) ON DELETE CASCADE,
    quality_rating INTEGER NOT NULL CHECK (quality_rating BETWEEN 1 AND 5),
    delivery_speed_rating INTEGER NOT NULL CHECK (delivery_speed_rating BETWEEN 1 AND 5),
    comment TEXT NOT NULL DEFAULT '',
    created_at TEXT DEFAULT CURRENT_TIMESTAMP
);

CREATE INDEX IF NOT EXISTS idx_reviews_farm ON reviews (farm_id, id);

CREATE TABLE IF NOT EXISTS admin_audit_logs (
    id INTEGER PRIMARY KEY,
    admin_id INTEGER NOT NULL REFERENCES users(id),
    action TEXT NOT NULL,
    entity_type TEXT NOT NULL,
    entity_id INTEGER,
    details TEXT NOT NULL DEFAULT '{}',
    created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP
);
