-- PL3 formal sync checkpoint + legacy reconciliation staging.
-- Apply ONLY to pl3-staging after backup. Does not touch PL2 or existing orders.
CREATE TABLE IF NOT EXISTS formal_sync_deliveries (
  event_id TEXT NOT NULL,
  destination TEXT NOT NULL CHECK(destination IN ('sheets','notion')),
  status TEXT NOT NULL DEFAULT 'pending' CHECK(status IN ('pending','processing','retry','delivered','conflict','dead')),
  attempts INTEGER NOT NULL DEFAULT 0,
  next_attempt_at TEXT,
  remote_id TEXT,
  remote_revision TEXT,
  last_error TEXT,
  delivered_at TEXT,
  PRIMARY KEY(event_id,destination),
  FOREIGN KEY(event_id) REFERENCES sync_outbox(id)
);
CREATE INDEX IF NOT EXISTS idx_formal_sync_due ON formal_sync_deliveries(status,next_attempt_at);
CREATE TABLE IF NOT EXISTS formal_sync_links (
  order_id TEXT NOT NULL,
  destination TEXT NOT NULL CHECK(destination IN ('sheets','notion')),
  remote_id TEXT NOT NULL,
  remote_revision TEXT NOT NULL,
  projection_hash TEXT NOT NULL,
  updated_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
  PRIMARY KEY(order_id,destination)
);
CREATE TABLE IF NOT EXISTS formal_sync_conflicts (
  id TEXT PRIMARY KEY,
  event_id TEXT NOT NULL,
  order_id TEXT NOT NULL,
  destination TEXT NOT NULL,
  reason TEXT NOT NULL,
  detected_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
  resolved_at TEXT,
  UNIQUE(event_id,destination)
);
CREATE TABLE IF NOT EXISTS pl2_legacy_import_review (
  source_system TEXT NOT NULL,
  source_record_id TEXT NOT NULL,
  source_revision TEXT,
  source_hash TEXT NOT NULL,
  amount_twd INTEGER,
  item_count INTEGER,
  quantity_total INTEGER,
  raw_status TEXT,
  review_status TEXT NOT NULL DEFAULT 'pending' CHECK(review_status IN ('pending','conflict','approved','skipped')),
  reason TEXT,
  reviewed_at TEXT,
  PRIMARY KEY(source_system,source_record_id)
);
