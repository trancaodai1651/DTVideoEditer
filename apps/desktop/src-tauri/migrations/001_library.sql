CREATE TABLE folder_grants (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    root TEXT NOT NULL UNIQUE
);

CREATE TABLE assets (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    folder_id INTEGER NOT NULL REFERENCES folder_grants(id) ON DELETE CASCADE,
    relative_path TEXT NOT NULL,
    kind TEXT NOT NULL CHECK (kind IN ('video', 'audio', 'image')),
    bytes INTEGER NOT NULL CHECK (bytes > 0),
    modified TEXT NOT NULL,
    available INTEGER NOT NULL DEFAULT 1 CHECK (available IN (0, 1)),
    UNIQUE (folder_id, relative_path)
);

CREATE INDEX assets_gallery ON assets (available, id DESC);

CREATE TABLE asset_metadata (
    asset_id INTEGER PRIMARY KEY REFERENCES assets(id) ON DELETE CASCADE,
    duration_ms INTEGER,
    width INTEGER,
    height INTEGER,
    codec TEXT,
    frame_rate REAL,
    thumbnail BLOB
);

CREATE TABLE projects (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    name TEXT NOT NULL CHECK (length(name) BETWEEN 1 AND 80)
);

CREATE TABLE timelines (
    id INTEGER PRIMARY KEY REFERENCES projects(id) ON DELETE CASCADE,
    schema_version INTEGER NOT NULL DEFAULT 1 CHECK (schema_version = 1)
);

CREATE TABLE timeline_tracks (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    timeline_id INTEGER NOT NULL REFERENCES timelines(id) ON DELETE CASCADE,
    kind TEXT NOT NULL CHECK (kind IN ('video', 'audio')),
    UNIQUE (timeline_id, kind)
);

CREATE TABLE timeline_clips (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    track_id INTEGER NOT NULL REFERENCES timeline_tracks(id) ON DELETE CASCADE,
    asset_id INTEGER NOT NULL REFERENCES assets(id) ON DELETE CASCADE,
    position INTEGER NOT NULL CHECK (position >= 0),
    UNIQUE (track_id, position)
);

CREATE INDEX timeline_clips_asset ON timeline_clips (asset_id);
