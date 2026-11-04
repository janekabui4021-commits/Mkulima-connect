ALTER TABLE password_reset_otps
    ADD COLUMN IF NOT EXISTS email TEXT;
