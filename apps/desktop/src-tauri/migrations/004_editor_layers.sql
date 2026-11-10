ALTER TABLE timeline_clips ADD COLUMN layer INTEGER NOT NULL DEFAULT 0 CHECK (layer BETWEEN 0 AND 11);
ALTER TABLE timeline_clips ADD COLUMN look_json TEXT NOT NULL DEFAULT '{}';
CREATE TABLE timelines_v3 (
    id INTEGER PRIMARY KEY REFERENCES projects(id) ON DELETE CASCADE,
    schema_version INTEGER NOT NULL DEFAULT 3 CHECK (schema_version = 3),
    titles_json TEXT NOT NULL DEFAULT '[]',
    aspect_json TEXT NOT NULL DEFAULT '"source"'
);
INSERT INTO timelines_v3(id) SELECT id FROM timelines;
DROP TABLE timelines;
ALTER TABLE timelines_v3 RENAME TO timelines;
CREATE INDEX render_jobs_queue ON render_jobs(status, id);
CREATE TABLE editor_templates (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    data TEXT NOT NULL
);
