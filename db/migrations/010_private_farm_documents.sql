CREATE TABLE IF NOT EXISTS farm_documents (
    id SERIAL PRIMARY KEY,
    farm_id INT NOT NULL REFERENCES farms(id) ON DELETE CASCADE,
    uploaded_by INT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
    object_key TEXT NOT NULL UNIQUE,
    original_name TEXT NOT NULL,
    content_type TEXT NOT NULL CHECK (
        content_type IN ('application/pdf', 'image/jpeg', 'image/png')
    ),
    file_size INT NOT NULL CHECK (file_size > 0 AND file_size <= 10485760),
    uploaded_at TIMESTAMPTZ NOT NULL DEFAULT now()
);
