-- PL3 staging-only owner session store. Apply to pl3-staging D1, never PL2 data.
-- Additive migration; no existing orders, payment reports, or sync rows changed.
CREATE TABLE IF NOT EXISTS admin_sessions (
  id TEXT PRIMARY KEY,
  token_hash TEXT NOT NULL UNIQUE,
  owner_email TEXT NOT NULL,
  created_at INTEGER NOT NULL,
  last_seen_at INTEGER NOT NULL,
  expires_at INTEGER NOT NULL,
  idle_expires_at INTEGER NOT NULL,
  revoked_at INTEGER
);
CREATE INDEX IF NOT EXISTS idx_admin_sessions_owner_expiry ON admin_sessions(owner_email, expires_at);
