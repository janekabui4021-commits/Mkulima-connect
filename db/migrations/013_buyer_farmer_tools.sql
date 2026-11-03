CREATE TABLE IF NOT EXISTS buyer_favorites (
    buyer_id INT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
    product_id INT NOT NULL REFERENCES products(id) ON DELETE CASCADE,
    created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
    PRIMARY KEY (buyer_id, product_id)
);

CREATE TABLE IF NOT EXISTS transporter_messages (
    id SERIAL PRIMARY KEY,
    transporter_id INT NOT NULL REFERENCES transporter_profiles(id) ON DELETE CASCADE,
    requester_id INT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
    sender_id INT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
    body TEXT NOT NULL,
    created_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS idx_transporter_messages_conversation
    ON transporter_messages (transporter_id, requester_id, id);
