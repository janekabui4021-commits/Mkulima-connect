ALTER TABLE farms
    ADD COLUMN IF NOT EXISTS latitude NUMERIC(9, 6),
    ADD COLUMN IF NOT EXISTS longitude NUMERIC(9, 6);

ALTER TABLE products
    ADD COLUMN IF NOT EXISTS image_url TEXT;

ALTER TABLE order_items
    ADD COLUMN IF NOT EXISTS fulfillment_status TEXT NOT NULL DEFAULT 'pending';

UPDATE farms
SET latitude = CASE county
        WHEN 'Kiambu' THEN -1.1714
        WHEN 'Meru' THEN -0.0467
        WHEN 'Nakuru' THEN -0.3031
        WHEN 'Kisii' THEN -0.6810
        WHEN 'Uasin Gishu' THEN 0.5143
        WHEN 'Nyandarua' THEN -0.2708
        WHEN 'Kirinyaga' THEN -0.4989
    END,
    longitude = CASE county
        WHEN 'Kiambu' THEN 36.8356
        WHEN 'Meru' THEN 37.6559
        WHEN 'Nakuru' THEN 36.0800
        WHEN 'Kisii' THEN 34.7660
        WHEN 'Uasin Gishu' THEN 35.2698
        WHEN 'Nyandarua' THEN 36.3792
        WHEN 'Kirinyaga' THEN 37.2803
    END
WHERE latitude IS NULL OR longitude IS NULL;
