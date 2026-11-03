ALTER TABLE contact_verification_codes
    ADD COLUMN IF NOT EXISTS sent_at TIMESTAMPTZ NOT NULL DEFAULT now();
