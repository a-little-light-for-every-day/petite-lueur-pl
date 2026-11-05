CREATE TABLE IF NOT EXISTS pl_ops_state (
 id TEXT PRIMARY KEY CHECK(id='main'), version INTEGER NOT NULL DEFAULT 0,
 document_json TEXT NOT NULL CHECK(json_valid(document_json)), last_command_id TEXT, updated_at TEXT DEFAULT CURRENT_TIMESTAMP
);
CREATE TABLE IF NOT EXISTS pl_ops_commands (
 id TEXT PRIMARY KEY, request_hash TEXT NOT NULL, actor TEXT NOT NULL, command_type TEXT NOT NULL,
 result_json TEXT NOT NULL CHECK(json_valid(result_json)), version INTEGER NOT NULL UNIQUE, created_at TEXT DEFAULT CURRENT_TIMESTAMP
);
CREATE TABLE IF NOT EXISTS pl_ops_mail (
 id TEXT PRIMARY KEY, notice_id TEXT NOT NULL UNIQUE, snapshot_json TEXT NOT NULL CHECK(json_valid(snapshot_json)),
 status TEXT NOT NULL DEFAULT 'queued' CHECK(status IN ('queued','sending','sent','failed','unknown','void')),
 approved_by TEXT NOT NULL, approved_at TEXT NOT NULL, gmail_message_id TEXT, gmail_thread_id TEXT, error_code TEXT,
 claimed_at TEXT, sent_at TEXT, updated_at TEXT DEFAULT CURRENT_TIMESTAMP
);
CREATE TABLE IF NOT EXISTS pl_ops_attachments(id TEXT PRIMARY KEY,name TEXT NOT NULL,mime_type TEXT NOT NULL,size_bytes INTEGER NOT NULL,sha256 TEXT NOT NULL,base64_data TEXT NOT NULL,created_by TEXT NOT NULL,created_at TEXT DEFAULT CURRENT_TIMESTAMP);
CREATE TABLE IF NOT EXISTS pl_ops_entities(kind TEXT NOT NULL,id TEXT NOT NULL,document_json TEXT NOT NULL CHECK(json_valid(document_json)),updated_at TEXT DEFAULT CURRENT_TIMESTAMP,PRIMARY KEY(kind,id));
CREATE TABLE IF NOT EXISTS pl_ops_entity_history(command_id TEXT NOT NULL,kind TEXT NOT NULL,entity_id TEXT NOT NULL,version INTEGER NOT NULL,before_json TEXT,after_json TEXT,actor TEXT NOT NULL,created_at TEXT DEFAULT CURRENT_TIMESTAMP,PRIMARY KEY(command_id,kind,entity_id));
