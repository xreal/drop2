ALTER TABLE stored_shares ADD COLUMN email_notify_token_hash TEXT NOT NULL DEFAULT '';
ALTER TABLE stored_shares ADD COLUMN email_recipient_count INTEGER NOT NULL DEFAULT 0;

CREATE TABLE IF NOT EXISTS email_rate_limits (
  ip_hash TEXT NOT NULL,
  bucket TEXT NOT NULL,
  message_count INTEGER NOT NULL DEFAULT 0,
  updated_at INTEGER NOT NULL,
  PRIMARY KEY (ip_hash, bucket)
);

CREATE INDEX IF NOT EXISTS idx_email_rate_limits_updated
  ON email_rate_limits(updated_at);
