CREATE TABLE IF NOT EXISTS ip_abuse (
  ip_hash TEXT PRIMARY KEY,
  failure_count INTEGER NOT NULL DEFAULT 0,
  cooldown_until INTEGER NOT NULL DEFAULT 0,
  updated_at INTEGER NOT NULL
);

CREATE INDEX IF NOT EXISTS idx_ip_abuse_cooldown
  ON ip_abuse(cooldown_until);
