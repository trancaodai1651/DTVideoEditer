-- Runs with foreign_keys = OFF inside the migration transaction (see Store::open),
-- so rebuilding a parent table does not cascade into tracks or clips.

CREATE TABLE timelines_v2 (
    id INTEGER PRIMARY KEY REFERENCES projects(id) ON DELETE CASCADE,
    schema_version INTEGER NOT NULL DEFAULT 2 CHECK (schema_version = 2)
);
INSERT INTO timelines_v2(id) SELECT id FROM timelines;
DROP TABLE timelines;
ALTER TABLE timelines_v2 RENAME TO timelines;

CREATE TABLE timeline_clips_v2 (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    track_id INTEGER NOT NULL REFERENCES timeline_tracks(id) ON DELETE CASCADE,
    asset_id INTEGER NOT NULL REFERENCES assets(id) ON DELETE CASCADE,
    start_ms INTEGER NOT NULL CHECK (start_ms >= 0),
    end_ms INTEGER NOT NULL CHECK (end_ms > start_ms),
    position_ms INTEGER NOT NULL CHECK (position_ms >= 0)
);

-- Schema 1 clips play their whole source back to back. Images get three seconds.
INSERT INTO timeline_clips_v2(id, track_id, asset_id, start_ms, end_ms, position_ms)
SELECT id, track_id, asset_id, 0, length_ms,
       COALESCE(SUM(length_ms) OVER (
           PARTITION BY track_id ORDER BY position
           ROWS BETWEEN UNBOUNDED PRECEDING AND 1 PRECEDING
       ), 0)
FROM (
    SELECT c.id, c.track_id, c.asset_id, c.position,
           CASE WHEN a.kind = 'image' THEN 3000
                ELSE MAX(COALESCE(m.duration_ms, 1000), 100) END AS length_ms
    FROM timeline_clips c
    JOIN assets a ON a.id = c.asset_id
    LEFT JOIN asset_metadata m ON m.asset_id = a.id
);

DROP TABLE timeline_clips;
ALTER TABLE timeline_clips_v2 RENAME TO timeline_clips;
CREATE INDEX timeline_clips_asset ON timeline_clips (asset_id);
CREATE INDEX timeline_clips_track ON timeline_clips (track_id, position_ms);

CREATE TABLE render_jobs (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    project_id INTEGER NOT NULL REFERENCES projects(id) ON DELETE CASCADE,
    status TEXT NOT NULL CHECK (status IN ('queued', 'running', 'done', 'failed', 'canceled')),
    progress INTEGER NOT NULL DEFAULT 0 CHECK (progress BETWEEN 0 AND 1000),
    snapshot TEXT NOT NULL,
    output_path TEXT NOT NULL,
    duration_ms INTEGER NOT NULL CHECK (duration_ms > 0),
    error TEXT,
    created_at TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%SZ', 'now')),
    finished_at TEXT
);

CREATE INDEX render_jobs_project ON render_jobs (project_id, id DESC);
