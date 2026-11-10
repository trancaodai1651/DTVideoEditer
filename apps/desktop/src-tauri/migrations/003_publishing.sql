-- Access tokens never enter SQLite. `secret_ref` names the OS keychain entry that holds them.
CREATE TABLE connected_accounts (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    platform TEXT NOT NULL CHECK (platform IN ('threads', 'facebook', 'instagram', 'tiktok')),
    variant TEXT NOT NULL DEFAULT '' CHECK (variant IN ('', 'instagram_login', 'facebook_login')),
    remote_id TEXT NOT NULL CHECK (length(remote_id) BETWEEN 1 AND 128),
    name TEXT NOT NULL,
    secret_ref TEXT NOT NULL UNIQUE,
    expires_at INTEGER,
    created_at TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%SZ', 'now')),
    UNIQUE (platform, variant, remote_id)
);

-- One row per post to one account. `approved_at` records the native confirmation,
-- `remote_ref` keeps the container or upload id so a retry resumes instead of posting twice.
CREATE TABLE publishing_jobs (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    account_id INTEGER NOT NULL REFERENCES connected_accounts(id) ON DELETE CASCADE,
    format TEXT NOT NULL CHECK (format IN ('text', 'image', 'video', 'reel')),
    caption TEXT NOT NULL,
    title TEXT NOT NULL DEFAULT '',
    privacy TEXT NOT NULL DEFAULT '',
    media TEXT NOT NULL CHECK (media IN ('none', 'url', 'asset', 'render')),
    media_url TEXT,
    asset_id INTEGER REFERENCES assets(id) ON DELETE SET NULL,
    render_job_id INTEGER REFERENCES render_jobs(id) ON DELETE SET NULL,
    status TEXT NOT NULL DEFAULT 'draft'
        CHECK (status IN ('draft', 'publishing', 'published', 'failed', 'removed')),
    approved_at TEXT,
    remote_ref TEXT,
    remote_id TEXT,
    permalink TEXT,
    error TEXT,
    created_at TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%SZ', 'now')),
    published_at TEXT
);

CREATE INDEX publishing_jobs_account ON publishing_jobs (account_id, id DESC);
