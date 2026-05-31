CREATE TABLE IF NOT EXISTS stored_shares (
  share_id TEXT PRIMARY KEY,
  storage_prefix TEXT NOT NULL,
  state TEXT NOT NULL,
  created_at INTEGER NOT NULL,
  expires_at INTEGER NOT NULL,
  pin_salt TEXT NOT NULL,
  pin_hash TEXT NOT NULL,
  item_kind TEXT NOT NULL,
  display_name TEXT NOT NULL,
  plaintext_size INTEGER NOT NULL,
  manifest_object_key TEXT NOT NULL,
  chunk_count INTEGER NOT NULL,
  chunk_plaintext_size INTEGER NOT NULL,
  manifest_ciphertext_bytes INTEGER NOT NULL,
  ciphertext_bytes_total INTEGER NOT NULL,
  upload_token TEXT NOT NULL,
  download_token TEXT,
  download_token_expires_at INTEGER,
  failed_pins TEXT NOT NULL DEFAULT '{}',
  cooldown_until TEXT NOT NULL DEFAULT '{}',
  download_count INTEGER NOT NULL DEFAULT 0,
  last_access_at INTEGER
);

CREATE INDEX IF NOT EXISTS idx_stored_shares_expires
  ON stored_shares(expires_at);
