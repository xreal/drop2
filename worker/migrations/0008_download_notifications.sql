ALTER TABLE stored_shares ADD COLUMN download_status_token_hash TEXT NOT NULL DEFAULT '';
ALTER TABLE stored_shares ADD COLUMN downloaded_at INTEGER;
