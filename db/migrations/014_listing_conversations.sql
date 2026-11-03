CREATE TABLE IF NOT EXISTS conversations (
    id SERIAL PRIMARY KEY,
    product_id INT NOT NULL REFERENCES products(id) ON DELETE CASCADE,
    buyer_id INT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
    farmer_id INT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
    status TEXT NOT NULL DEFAULT 'active' CHECK (status IN ('active', 'archived')),
    created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
    updated_at TIMESTAMPTZ NOT NULL DEFAULT now(),
    UNIQUE (product_id, buyer_id)
);

CREATE INDEX IF NOT EXISTS idx_conversations_buyer
    ON conversations (buyer_id, updated_at);
CREATE INDEX IF NOT EXISTS idx_conversations_farmer
    ON conversations (farmer_id, updated_at);

CREATE TABLE IF NOT EXISTS conversation_messages (
    id SERIAL PRIMARY KEY,
    conversation_id INT NOT NULL REFERENCES conversations(id) ON DELETE CASCADE,
    sender_id INT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
    sender_role TEXT NOT NULL CHECK (sender_role IN ('buyer', 'farmer')),
    body TEXT NOT NULL,
    sent_via TEXT NOT NULL DEFAULT 'app' CHECK (sent_via IN ('app', 'sms')),
    provider_message_id TEXT UNIQUE,
    created_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS idx_conversation_messages_thread
    ON conversation_messages (conversation_id, id);

CREATE TABLE IF NOT EXISTS conversation_sms_codes (
    conversation_id INT PRIMARY KEY REFERENCES conversations(id) ON DELETE CASCADE,
    reply_code TEXT NOT NULL UNIQUE
);

CREATE TABLE IF NOT EXISTS conversation_blocks (
    conversation_id INT NOT NULL REFERENCES conversations(id) ON DELETE CASCADE,
    user_id INT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
    created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
    PRIMARY KEY (conversation_id, user_id)
);

CREATE TABLE IF NOT EXISTS conversation_reports (
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

CREATE INDEX IF NOT EXISTS idx_conversation_reports_status
    ON conversation_reports (status, id);
