-- PL3 / LINE pending claims only. Apply to a backed-up D1 database after review.
-- Not part of orders, invoices, receipts, inventory reservations or payment status.
CREATE TABLE IF NOT EXISTS line_claim_images (
  scope_id TEXT NOT NULL,
  image_message_id TEXT NOT NULL,
  created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
  PRIMARY KEY(scope_id,image_message_id)
);
CREATE TABLE IF NOT EXISTS line_claim_bindings (
  scope_id TEXT NOT NULL,
  image_message_id TEXT NOT NULL,
  product_id TEXT NOT NULL,
  bound_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
  PRIMARY KEY(scope_id,image_message_id),
  FOREIGN KEY(scope_id,image_message_id) REFERENCES line_claim_images(scope_id,image_message_id)
);
CREATE TABLE IF NOT EXISTS line_claim_intents (
  id TEXT PRIMARY KEY,
  webhook_event_id TEXT NOT NULL UNIQUE,
  scope_id TEXT NOT NULL,
  image_message_id TEXT,
  user_hash TEXT NOT NULL,
  product_id TEXT NOT NULL,
  group_id TEXT NOT NULL,
  quantity INTEGER NOT NULL CHECK(quantity BETWEEN 1 AND 20),
  unit_price_twd INTEGER NOT NULL CHECK(unit_price_twd > 0),
  status TEXT NOT NULL DEFAULT 'pending' CHECK(status IN ('pending','reviewed','cancelled')),
  created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP
);
CREATE INDEX IF NOT EXISTS idx_line_claim_pending ON line_claim_intents(status,created_at);
CREATE INDEX IF NOT EXISTS idx_line_claim_product ON line_claim_intents(product_id,status);
