CREATE TABLE IF NOT EXISTS secrets (
  id TEXT PRIMARY KEY,
  ciphertext TEXT NOT NULL,
  link_hash TEXT NOT NULL,
  key_hash TEXT NOT NULL,
  passphrase INTEGER NOT NULL,
  failed_attempts INTEGER NOT NULL DEFAULT 0,
  created_at INTEGER NOT NULL,
  expires_at INTEGER NOT NULL
);

CREATE INDEX IF NOT EXISTS idx_secrets_expires ON secrets(expires_at);

ALTER TABLE email_rate_limits RENAME TO ip_quotas;
DROP INDEX IF EXISTS idx_email_rate_limits_updated;
CREATE INDEX IF NOT EXISTS idx_ip_quotas_updated ON ip_quotas(updated_at);
