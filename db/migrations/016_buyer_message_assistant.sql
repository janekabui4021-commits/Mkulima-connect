CREATE TABLE IF NOT EXISTS conversation_bot_messages (
    id SERIAL PRIMARY KEY,
    conversation_id INT NOT NULL REFERENCES conversations(id) ON DELETE CASCADE,
    body TEXT NOT NULL,
    created_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS idx_conversation_bot_messages_thread
    ON conversation_bot_messages (conversation_id, id);
