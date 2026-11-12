ALTER TABLE timelines ADD COLUMN adjustments_json TEXT NOT NULL DEFAULT '[]';
CREATE TABLE luts (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    name TEXT NOT NULL CHECK (length(name) BETWEEN 1 AND 120),
    cube TEXT NOT NULL
);
-- Levels from 0.5.0 could drop a leading gap in the audio track; recompute them.
UPDATE asset_metadata SET levels = NULL;
