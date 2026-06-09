package storage

type Migration struct {
	Version int
	Name    string
	SQL     string
}

var Migrations = []Migration{
	{
		Version: 1,
		Name:    "initial_product_store",
		SQL: `
CREATE TABLE IF NOT EXISTS schema_migrations (
    version INTEGER PRIMARY KEY,
    name TEXT NOT NULL,
    applied_at TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ', 'now'))
);

CREATE TABLE IF NOT EXISTS repos (
    id TEXT PRIMARY KEY,
    name TEXT NOT NULL,
    path TEXT NOT NULL,
    archived INTEGER NOT NULL DEFAULT 0,
    created_at TEXT NOT NULL,
    updated_at TEXT NOT NULL
);

CREATE TABLE IF NOT EXISTS tasks (
    id TEXT PRIMARY KEY,
    repo_id TEXT NOT NULL REFERENCES repos(id) ON DELETE CASCADE,
    slug TEXT NOT NULL DEFAULT '',
    title TEXT NOT NULL,
    description TEXT NOT NULL DEFAULT '',
    isolation_json TEXT,
    metadata_json TEXT,
    closed INTEGER NOT NULL DEFAULT 0,
    created_at TEXT NOT NULL,
    updated_at TEXT NOT NULL,
    last_viewed_at TEXT,
    last_event_at TEXT
);

CREATE INDEX IF NOT EXISTS idx_tasks_repo_updated ON tasks(repo_id, updated_at DESC);
CREATE INDEX IF NOT EXISTS idx_tasks_repo_last_event ON tasks(repo_id, last_event_at DESC);

CREATE TABLE IF NOT EXISTS task_previews (
    task_id TEXT PRIMARY KEY REFERENCES tasks(id) ON DELETE CASCADE,
    repo_id TEXT NOT NULL REFERENCES repos(id) ON DELETE CASCADE,
    slug TEXT NOT NULL DEFAULT '',
    title TEXT NOT NULL,
    closed INTEGER NOT NULL DEFAULT 0,
    created_at TEXT NOT NULL,
    updated_at TEXT NOT NULL,
    last_viewed_at TEXT,
    last_event_at TEXT,
    last_event_json TEXT,
    usage_json TEXT
);

CREATE INDEX IF NOT EXISTS idx_task_previews_repo_last_event ON task_previews(repo_id, last_event_at DESC);
CREATE INDEX IF NOT EXISTS idx_task_previews_repo_closed ON task_previews(repo_id, closed, last_event_at DESC);

CREATE TABLE IF NOT EXISTS task_events (
    id TEXT PRIMARY KEY,
    task_id TEXT NOT NULL REFERENCES tasks(id) ON DELETE CASCADE,
    seq INTEGER NOT NULL,
    type TEXT NOT NULL,
    status TEXT,
    source_type TEXT,
    source_label TEXT,
    created_at TEXT NOT NULL,
    payload_json TEXT,
    payload_blob_id TEXT REFERENCES blobs(id),
    UNIQUE(task_id, seq)
);

CREATE INDEX IF NOT EXISTS idx_task_events_task_seq ON task_events(task_id, seq);
CREATE INDEX IF NOT EXISTS idx_task_events_task_created ON task_events(task_id, created_at);

CREATE TABLE IF NOT EXISTS comments (
    id TEXT PRIMARY KEY,
    task_id TEXT NOT NULL REFERENCES tasks(id) ON DELETE CASCADE,
    body TEXT NOT NULL,
    anchor_json TEXT,
    created_at TEXT NOT NULL,
    updated_at TEXT NOT NULL,
    deleted_at TEXT
);

CREATE INDEX IF NOT EXISTS idx_comments_task_updated ON comments(task_id, updated_at);

CREATE TABLE IF NOT EXISTS queued_turns (
    id TEXT PRIMARY KEY,
    task_id TEXT NOT NULL REFERENCES tasks(id) ON DELETE CASCADE,
    type TEXT NOT NULL,
    input TEXT NOT NULL,
    status TEXT NOT NULL,
    payload_json TEXT,
    created_at TEXT NOT NULL,
    updated_at TEXT NOT NULL
);

CREATE INDEX IF NOT EXISTS idx_queued_turns_task_status ON queued_turns(task_id, status, updated_at);

CREATE TABLE IF NOT EXISTS runtimes (
    runtime_id TEXT PRIMARY KEY,
    kind TEXT NOT NULL,
    status TEXT NOT NULL,
    scope_json TEXT,
    started_at TEXT NOT NULL,
    updated_at TEXT NOT NULL,
    last_activity_at TEXT NOT NULL,
    payload_json TEXT
);

CREATE INDEX IF NOT EXISTS idx_runtimes_status_activity ON runtimes(status, last_activity_at DESC);

CREATE TABLE IF NOT EXISTS sessions (
    id TEXT PRIMARY KEY,
    label TEXT NOT NULL,
    trusted INTEGER NOT NULL DEFAULT 0,
    permissions_json TEXT,
    created_at TEXT NOT NULL,
    updated_at TEXT NOT NULL,
    revoked_at TEXT
);

CREATE TABLE IF NOT EXISTS devices (
    id TEXT PRIMARY KEY,
    session_id TEXT REFERENCES sessions(id) ON DELETE SET NULL,
    label TEXT NOT NULL,
    platform TEXT NOT NULL DEFAULT 'unknown',
    permissions_json TEXT,
    created_at TEXT NOT NULL,
    updated_at TEXT NOT NULL,
    revoked_at TEXT
);

CREATE TABLE IF NOT EXISTS settings (
    key TEXT PRIMARY KEY,
    value_json TEXT NOT NULL,
    updated_at TEXT NOT NULL
);

CREATE TABLE IF NOT EXISTS task_usage (
    task_id TEXT PRIMARY KEY REFERENCES tasks(id) ON DELETE CASCADE,
    usage_version INTEGER NOT NULL,
    input_tokens INTEGER NOT NULL DEFAULT 0,
    output_tokens INTEGER NOT NULL DEFAULT 0,
    total_cost_usd REAL NOT NULL DEFAULT 0,
    event_count INTEGER NOT NULL DEFAULT 0,
    duration_ms INTEGER,
    cost_by_model_json TEXT NOT NULL DEFAULT '{}',
    updated_at TEXT NOT NULL
);

CREATE TABLE IF NOT EXISTS blobs (
    id TEXT PRIMARY KEY,
    kind TEXT NOT NULL,
    content_type TEXT,
    size_bytes INTEGER NOT NULL,
    sha256 TEXT NOT NULL,
    path TEXT NOT NULL,
    created_at TEXT NOT NULL
);

CREATE INDEX IF NOT EXISTS idx_blobs_kind_created ON blobs(kind, created_at DESC);
`,
	},
	{
		Version: 2,
		Name:    "task_device_environments",
		SQL: `
CREATE TABLE IF NOT EXISTS task_device_environments (
    id TEXT NOT NULL,
    task_id TEXT NOT NULL REFERENCES tasks(id) ON DELETE CASCADE,
    device_id TEXT NOT NULL,
    worktree_dir TEXT,
    setup_complete INTEGER NOT NULL DEFAULT 0,
    merge_base_commit TEXT,
    created_at TEXT NOT NULL,
    last_used_at TEXT NOT NULL,
    PRIMARY KEY(task_id, id)
);

CREATE INDEX IF NOT EXISTS idx_task_device_environments_task_last_used
ON task_device_environments(task_id, last_used_at DESC);
`,
	},
	{
		Version: 3,
		Name:    "queued_turn_positions",
		SQL: `
ALTER TABLE queued_turns ADD COLUMN position INTEGER NOT NULL DEFAULT 0;

CREATE INDEX IF NOT EXISTS idx_queued_turns_task_position
ON queued_turns(task_id, position ASC, created_at ASC);
`,
	},
	{
		Version: 4,
		Name:    "device_token_auth",
		SQL: `
ALTER TABLE devices ADD COLUMN token_hash TEXT;
ALTER TABLE devices ADD COLUMN last_seen_at TEXT;

CREATE UNIQUE INDEX IF NOT EXISTS idx_devices_token_hash
ON devices(token_hash)
WHERE token_hash IS NOT NULL;
`,
	},
	{
		Version: 5,
		Name:    "runtime_output_chunks",
		SQL: `
CREATE TABLE IF NOT EXISTS runtime_output_chunks (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    runtime_id TEXT NOT NULL REFERENCES runtimes(runtime_id) ON DELETE CASCADE,
    stream TEXT NOT NULL,
    data TEXT NOT NULL,
    timestamp_ms INTEGER NOT NULL,
    created_at TEXT NOT NULL
);

CREATE INDEX IF NOT EXISTS idx_runtime_output_chunks_runtime
ON runtime_output_chunks(runtime_id, id ASC);
`,
	},
}
