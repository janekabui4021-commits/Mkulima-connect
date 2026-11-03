CREATE TABLE IF NOT EXISTS transporter_profiles (
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
