-- Additive isolated source archive. No FKs / writes / triggers into operational orders or outbox.
CREATE TABLE IF NOT EXISTS legacy_source_snapshots (
 snapshot_id INTEGER PRIMARY KEY AUTOINCREMENT,
 source_page_id TEXT NOT NULL,
 source_id TEXT NOT NULL,
 source_revision TEXT NOT NULL,
 content_hash TEXT NOT NULL,
 snapshot_json TEXT NOT NULL CHECK(json_valid(snapshot_json)),
 captured_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
 UNIQUE(source_page_id, source_revision, content_hash)
);
CREATE INDEX IF NOT EXISTS legacy_source_latest ON legacy_source_snapshots(source_page_id,source_revision DESC);
