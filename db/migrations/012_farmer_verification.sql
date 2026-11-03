ALTER TABLE farms
    ADD COLUMN IF NOT EXISTS verification_level TEXT NOT NULL DEFAULT 'full'
        CHECK (verification_level IN ('unverified', 'provisional', 'full')),
    ADD COLUMN IF NOT EXISTS farm_boundary TEXT,
    ADD COLUMN IF NOT EXISTS verification_video_path TEXT,
    ADD COLUMN IF NOT EXISTS verification_video_latitude NUMERIC(9, 6),
    ADD COLUMN IF NOT EXISTS verification_video_longitude NUMERIC(9, 6),
    ADD COLUMN IF NOT EXISTS verification_video_accuracy_m NUMERIC,
    ADD COLUMN IF NOT EXISTS verification_video_recorded_at TIMESTAMPTZ,
    ADD COLUMN IF NOT EXISTS verification_code TEXT,
    ADD COLUMN IF NOT EXISTS verification_submitted_at TIMESTAMPTZ;

ALTER TABLE users
    ADD COLUMN IF NOT EXISTS phone_verified BOOLEAN NOT NULL DEFAULT FALSE;

CREATE TABLE IF NOT EXISTS farmer_phone_otps (
    user_id INT PRIMARY KEY REFERENCES users(id) ON DELETE CASCADE,
    phone TEXT NOT NULL,
    code_hash TEXT NOT NULL,
    expires_at TIMESTAMPTZ NOT NULL,
    attempts INT NOT NULL DEFAULT 0,
    last_sent_at TIMESTAMPTZ NOT NULL
);
