CREATE TABLE IF NOT EXISTS pin_attempts (
  scope TEXT PRIMARY KEY,
  attempts INTEGER NOT NULL,
  window_start INTEGER NOT NULL
);

CREATE INDEX IF NOT EXISTS idx_pin_attempts_window ON pin_attempts(window_start);

DROP TABLE ip_abuse;
ALTER TABLE stored_shares DROP COLUMN failed_pins;
ALTER TABLE stored_shares DROP COLUMN cooldown_until;

CREATE INDEX IF NOT EXISTS idx_stored_shares_account_state ON stored_shares(account_id, state);
