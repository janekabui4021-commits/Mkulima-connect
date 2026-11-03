INSERT OR IGNORE INTO users (id, name, phone, password_hash, role)
VALUES
    (1, 'Demo Buyer', '254700000001', 'x', 'buyer'),
    (2, 'Demo Admin', '254700000002', 'x', 'admin');

WITH farm_data(name, county, size_acres, rating, delivery_days, status, verified_at, latitude, longitude) AS (
    VALUES
        ('Green Acres Farm', 'Kiambu', 12, 4.8, 1, 'verified', CURRENT_TIMESTAMP, -1.1714, 36.8356),
        ('Kinoti Farm', 'Meru', 8, 4.5, 2, 'verified', CURRENT_TIMESTAMP, -0.0467, 37.6559),
        ('Rift Valley Grains', 'Nakuru', 60, 4.9, 1, 'verified', CURRENT_TIMESTAMP, -0.3031, 36.0800),
        ('Highland Dairy', 'Nakuru', 25, 4.6, 2, 'verified', CURRENT_TIMESTAMP, -0.3031, 36.0800),
        ('Meru Growers', 'Meru', 18, 4.4, 2, 'verified', CURRENT_TIMESTAMP, -0.0467, 37.6559),
        ('Meru Dairy Co-op', 'Meru', 40, 4.7, 1, 'verified', CURRENT_TIMESTAMP, -0.0467, 37.6559),
        ('Kisii Hills Farm', 'Kisii', 9, 4.3, 3, 'verified', CURRENT_TIMESTAMP, -0.6810, 34.7660),
        ('Eldoret Maize Growers', 'Uasin Gishu', 150, 4.7, 3, 'verified', CURRENT_TIMESTAMP, 0.5143, 35.2698),
        ('Ol Kalou Potato Farm', 'Nyandarua', 22, 4.5, 2, 'verified', CURRENT_TIMESTAMP, -0.2708, 36.3792),
        ('Mwea Rice Growers', 'Kirinyaga', 35, 4.8, 2, 'verified', CURRENT_TIMESTAMP, -0.4989, 37.2803),
        ('Wanjiru Estate', 'Nakuru', 14, 4.5, 2, 'pending', NULL, -0.3031, 36.0800),
        ('Mlima Fresh', 'Meru', 6, 4.5, 2, 'pending', NULL, -0.0467, 37.6559)
)
INSERT OR IGNORE INTO farms (name, county, size_acres, rating, delivery_days, status, verified_at, latitude, longitude)
SELECT name, county, size_acres, rating, delivery_days, status, verified_at, latitude, longitude
FROM farm_data;

WITH product_data(farm, name, unit, price_kes) AS (
    VALUES
        ('Green Acres Farm', 'Tomatoes', 'kg', 80),
        ('Kinoti Farm', 'Tomatoes', 'kg', 72),
        ('Rift Valley Grains', 'Tomatoes', 'kg', 85),
        ('Rift Valley Grains', 'Maize', 'kg', 55),
        ('Meru Growers', 'Maize', 'kg', 52),
        ('Eldoret Maize Growers', 'Maize', 'kg', 50),
        ('Green Acres Farm', 'Potatoes', 'kg', 45),
        ('Kinoti Farm', 'Potatoes', 'kg', 42),
        ('Ol Kalou Potato Farm', 'Potatoes', 'kg', 40),
        ('Green Acres Farm', 'Sukuma wiki', 'kg', 46),
        ('Kinoti Farm', 'Sukuma wiki', 'kg', 50),
        ('Highland Dairy', 'Fresh milk', 'litre', 60),
        ('Meru Dairy Co-op', 'Fresh milk', 'litre', 58),
        ('Kisii Hills Farm', 'Bananas', 'kg', 40),
        ('Meru Growers', 'Bananas', 'kg', 38),
        ('Mwea Rice Growers', 'Rice', 'kg', 140),
        ('Green Acres Farm', 'Onions', 'kg', 90),
        ('Green Acres Farm', 'Spinach', 'kg', 55),
        ('Kinoti Farm', 'Avocados', 'kg', 110),
        ('Kinoti Farm', 'Cabbage', 'kg', 35),
        ('Rift Valley Grains', 'Wheat', 'kg', 62),
        ('Rift Valley Grains', 'Beans', 'kg', 125),
        ('Highland Dairy', 'Yoghurt', 'litre', 160),
        ('Highland Dairy', 'Fresh cream', 'litre', 280),
        ('Meru Growers', 'Avocados', 'kg', 95),
        ('Meru Growers', 'Green peas', 'kg', 130),
        ('Meru Dairy Co-op', 'Mala', 'litre', 90),
        ('Meru Dairy Co-op', 'Fresh cream', 'litre', 270),
        ('Kisii Hills Farm', 'Avocados', 'kg', 100),
        ('Kisii Hills Farm', 'Passion fruit', 'kg', 85),
        ('Eldoret Maize Growers', 'Wheat', 'kg', 60),
        ('Eldoret Maize Growers', 'Beans', 'kg', 120),
        ('Ol Kalou Potato Farm', 'Carrots', 'kg', 50),
        ('Ol Kalou Potato Farm', 'Cabbage', 'kg', 32),
        ('Mwea Rice Growers', 'Beans', 'kg', 130),
        ('Mwea Rice Growers', 'Sweet potatoes', 'kg', 65),
        ('Wanjiru Estate', 'Tomatoes', 'kg', 78),
        ('Wanjiru Estate', 'Onions', 'kg', 88),
        ('Wanjiru Estate', 'Spinach', 'kg', 52),
        ('Mlima Fresh', 'Sukuma wiki', 'kg', 45),
        ('Mlima Fresh', 'Bananas', 'kg', 42),
        ('Mlima Fresh', 'Avocados', 'kg', 92)
)
INSERT OR IGNORE INTO products (farm_id, name, unit, price_kes, stock)
SELECT farms.id, product_data.name, product_data.unit, product_data.price_kes, 500
FROM product_data
JOIN farms ON farms.name = product_data.farm;
