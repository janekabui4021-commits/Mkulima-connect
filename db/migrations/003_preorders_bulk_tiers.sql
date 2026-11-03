ALTER TABLE products
    ADD COLUMN IF NOT EXISTS preorder_enabled BOOLEAN NOT NULL DEFAULT FALSE,
    ADD COLUMN IF NOT EXISTS season_tier TEXT NOT NULL DEFAULT 'in_season'
        CHECK (season_tier IN ('early', 'peak', 'late', 'in_season'));
