DROP TABLE IF EXISTS farm_documents;
DROP TABLE IF EXISTS contact_verification_codes;
DROP TABLE IF EXISTS password_reset_codes;
DROP TABLE IF EXISTS phone_verification_codes;
DROP TABLE IF EXISTS push_subscriptions;

ALTER TABLE users
    DROP COLUMN IF EXISTS contact_verified,
    DROP COLUMN IF EXISTS phone_verified,
    DROP COLUMN IF EXISTS sms_notifications_enabled,
    DROP COLUMN IF EXISTS sms_consent_at,
    DROP COLUMN IF EXISTS session_version;
