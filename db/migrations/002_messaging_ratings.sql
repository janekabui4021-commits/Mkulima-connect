CREATE TABLE IF NOT EXISTS messages (
    id SERIAL PRIMARY KEY,
    buyer_id INT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
    farm_id INT NOT NULL REFERENCES farms(id) ON DELETE CASCADE,
    sender_role TEXT NOT NULL CHECK (sender_role IN ('buyer', 'farmer')),
    body TEXT NOT NULL,
    created_at TIMESTAMPTZ DEFAULT now()
);

CREATE INDEX IF NOT EXISTS idx_messages_conversation ON messages (buyer_id, farm_id, id);

CREATE TABLE IF NOT EXISTS reviews (
    id SERIAL PRIMARY KEY,
    order_item_id INT NOT NULL UNIQUE REFERENCES order_items(id) ON DELETE CASCADE,
    buyer_id INT NOT NULL REFERENCES users(id),
    farm_id INT NOT NULL REFERENCES farms(id) ON DELETE CASCADE,
    quality_rating INT NOT NULL CHECK (quality_rating BETWEEN 1 AND 5),
    delivery_speed_rating INT NOT NULL CHECK (delivery_speed_rating BETWEEN 1 AND 5),
    comment TEXT NOT NULL DEFAULT '',
    created_at TIMESTAMPTZ DEFAULT now()
);

CREATE INDEX IF NOT EXISTS idx_reviews_farm ON reviews (farm_id, id);
