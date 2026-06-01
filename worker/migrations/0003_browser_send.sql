ALTER TABLE stored_shares ADD COLUMN expiry_mode TEXT NOT NULL DEFAULT 'legacy';
ALTER TABLE stored_shares ADD COLUMN max_downloads INTEGER NOT NULL DEFAULT 20;
ALTER TABLE stored_shares ADD COLUMN delete_after_complete INTEGER NOT NULL DEFAULT 0;
ALTER TABLE stored_shares ADD COLUMN account_id TEXT;
