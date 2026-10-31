-- PL 3.0 STAGING. Schema only: NO customer data migration.
-- All *_at_utc fields must use canonical ISO 8601 UTC with three millisecond digits, e.g. 2026-11-01T12:00:00.000Z.
PRAGMA foreign_keys = ON;

CREATE TABLE IF NOT EXISTS campaigns (
  id TEXT PRIMARY KEY,
  notion_id TEXT UNIQUE,
  campaign_code TEXT UNIQUE,
  title TEXT NOT NULL,
  lifecycle_status TEXT NOT NULL DEFAULT 'draft' CHECK (lifecycle_status IN ('draft','open','reopened','closed','cancelled')),
  public_approved INTEGER NOT NULL DEFAULT 0 CHECK (public_approved IN (0,1)),
  closes_at_utc TEXT,
  purchasing_deadline_at_utc TEXT,
  updated_at_utc TEXT NOT NULL,
  source_version TEXT
);

CREATE TABLE IF NOT EXISTS products (
  id TEXT PRIMARY KEY,
  notion_id TEXT UNIQUE,
  campaign_id TEXT NOT NULL REFERENCES campaigns(id),
  merchant_sku TEXT,
  variant_key TEXT NOT NULL DEFAULT '',
  title TEXT NOT NULL,
  variant_label TEXT,
  price_twd INTEGER NOT NULL CHECK (price_twd >= 0),
  image_url TEXT,
  official_url TEXT,
  lifecycle_status TEXT NOT NULL DEFAULT 'draft' CHECK (lifecycle_status IN ('draft','active','sold_out','closed','cancelled')),
  public_approved INTEGER NOT NULL DEFAULT 0 CHECK (public_approved IN (0,1)),
  available_units INTEGER CHECK (available_units IS NULL OR available_units >= 0),
  sort_order INTEGER NOT NULL DEFAULT 0,
  updated_at_utc TEXT NOT NULL,
  source_version TEXT,
  UNIQUE (campaign_id, merchant_sku, variant_key)
);

CREATE INDEX IF NOT EXISTS idx_campaigns_public ON campaigns(public_approved,lifecycle_status,closes_at_utc);
CREATE INDEX IF NOT EXISTS idx_products_public ON products(campaign_id,public_approved,lifecycle_status,sort_order);

-- Future private tables: created empty. NO POST endpoints or customer migrations in Stage 1.
CREATE TABLE IF NOT EXISTS orders (
  id TEXT PRIMARY KEY,
  idempotency_key_hash TEXT NOT NULL UNIQUE,
  email_normalized TEXT NOT NULL,
  campaign_id TEXT REFERENCES campaigns(id),
  order_total_twd INTEGER CHECK (order_total_twd >= 0),
  status TEXT NOT NULL DEFAULT 'pending_review',
  created_at_utc TEXT NOT NULL,
  updated_at_utc TEXT NOT NULL
);
CREATE INDEX IF NOT EXISTS idx_orders_email ON orders(email_normalized);

CREATE TABLE IF NOT EXISTS order_items (
  id TEXT PRIMARY KEY,
  order_id TEXT NOT NULL REFERENCES orders(id) ON DELETE CASCADE,
  product_id TEXT NOT NULL REFERENCES products(id),
  quantity INTEGER NOT NULL CHECK (quantity > 0),
  unit_price_twd INTEGER NOT NULL CHECK (unit_price_twd >= 0),
  UNIQUE(order_id, product_id)
);

CREATE TABLE IF NOT EXISTS otp_challenges (
  id TEXT PRIMARY KEY,
  email_normalized TEXT NOT NULL,
  code_hash TEXT NOT NULL,
  purpose TEXT NOT NULL,
  expires_at_utc TEXT NOT NULL,
  consumed_at_utc TEXT,
  attempts INTEGER NOT NULL DEFAULT 0 CHECK(attempts >= 0),
  created_at_utc TEXT NOT NULL
);
CREATE INDEX IF NOT EXISTS idx_otp_email_expires ON otp_challenges(email_normalized,expires_at_utc);

CREATE TABLE IF NOT EXISTS payment_reports (
  id TEXT PRIMARY KEY,
  order_id TEXT NOT NULL REFERENCES orders(id),
  method TEXT NOT NULL,
  reference_last_five TEXT,
  reported_amount_twd INTEGER CHECK(reported_amount_twd >= 0),
  reported_at_utc TEXT NOT NULL,
  verified_by_admin_at_utc TEXT,
  UNIQUE(order_id, reference_last_five, reported_amount_twd)
);

CREATE TABLE IF NOT EXISTS fulfillment_events (
  id TEXT PRIMARY KEY,
  order_item_id TEXT NOT NULL REFERENCES order_items(id),
  event_type TEXT NOT NULL,
  event_at_utc TEXT NOT NULL,
  event_payload_json TEXT NOT NULL DEFAULT '{}'
);

CREATE TABLE IF NOT EXISTS sync_outbox (
  id TEXT PRIMARY KEY,
  entity_type TEXT NOT NULL,
  entity_id TEXT NOT NULL,
  event_type TEXT NOT NULL,
  payload_json TEXT NOT NULL,
  attempts INTEGER NOT NULL DEFAULT 0,
  status TEXT NOT NULL DEFAULT 'pending',
  created_at_utc TEXT NOT NULL,
  processed_at_utc TEXT
);

CREATE TABLE IF NOT EXISTS sync_conflicts (
  id TEXT PRIMARY KEY,
  entity_type TEXT NOT NULL,
  entity_id TEXT NOT NULL,
  source_a TEXT NOT NULL,
  source_b TEXT NOT NULL,
  details_json TEXT NOT NULL,
  resolution_status TEXT NOT NULL DEFAULT 'pending_owner',
  created_at_utc TEXT NOT NULL,
  resolved_at_utc TEXT
);
