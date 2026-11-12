use std::{
    collections::HashMap,
    path::Path,
    sync::{Mutex, MutexGuard},
    time::Duration,
};

use rusqlite::{Connection, OptionalExtension, Row, params};

use crate::{
    model::{
        Asset, AssetPage, Folder, Project, RenderJob, Result, StudioError, Timeline, TimelineClip,
    },
    probe::Metadata,
    timeline::{
        AssetFacts, ClipEdit, TIMELINE_VERSION, TimelineSnapshot, TrackEdit, check_clip,
        check_track, check_version,
    },
};

const PAGE_SIZE: u32 = 48;
const MIGRATIONS: &[&str] = &[
    include_str!("../migrations/001_library.sql"),
    include_str!("../migrations/002_timeline_edit_points.sql"),
    include_str!("../migrations/003_publishing.sql"),
    include_str!("../migrations/004_editor_layers.sql"),
    include_str!("../migrations/005_file_grants.sql"),
    include_str!("../migrations/006_waveforms.sql"),
    include_str!("../migrations/007_filmstrips.sql"),
    include_str!("../migrations/008_lane_controls.sql"),
];
const RENDER_JOB: &str = "SELECT id, project_id, status, progress, output_path, duration_ms, error, created_at, finished_at FROM render_jobs";
const NOT_GRANTED: StudioError = StudioError::Input("Thư mục đã bị thu hồi hoặc không tồn tại.");

pub struct Store {
    connection: Mutex<Connection>,
    pub(crate) preview_generation: Mutex<()>,
}

#[derive(Clone, Copy)]
pub enum DerivedPreview {
    Waveform,
    Filmstrip,
}

impl DerivedPreview {
    fn column(self) -> &'static str {
        match self {
            Self::Waveform => "waveform",
            Self::Filmstrip => "filmstrip",
        }
    }
}

pub struct IndexEntry {
    pub relative_path: String,
    pub bytes: i64,
    pub modified: String,
    pub metadata: Option<Metadata>,
}

pub struct AssetSource {
    pub root: String,
    pub relative_path: String,
    pub kind: String,
    pub width: Option<u32>,
    pub height: Option<u32>,
    pub duration_ms: Option<i64>,
    pub thumbnail: Option<Vec<u8>>,
    pub file_only: bool,
}

pub struct RenderTask {
    pub snapshot: TimelineSnapshot,
    pub output_path: String,
}

fn decode<T: serde::de::DeserializeOwned>(row: &Row, column: usize) -> rusqlite::Result<T> {
    serde_json::from_str(&row.get::<_, String>(column)?).map_err(|error| {
        rusqlite::Error::FromSqlConversionFailure(
            column,
            rusqlite::types::Type::Text,
            Box::new(error),
        )
    })
}

fn encode(value: &impl serde::Serialize) -> Result<String> {
    serde_json::to_string(value).map_err(|_| StudioError::Input("Không thể lưu dữ liệu chỉnh sửa."))
}

fn render_job(row: &Row) -> rusqlite::Result<RenderJob> {
    Ok(RenderJob {
        id: row.get(0)?,
        project_id: row.get(1)?,
        status: row.get(2)?,
        progress: row.get(3)?,
        output_path: row.get(4)?,
        duration_ms: row.get(5)?,
        error: row.get(6)?,
        created_at: row.get(7)?,
        finished_at: row.get(8)?,
    })
}

impl Store {
    pub fn open(path: &Path) -> Result<Self> {
        let mut db = Connection::open(path)?;
        db.busy_timeout(Duration::from_secs(5))?;
        // Table rebuilds in migrations need foreign keys off, and the pragma is a
        // no-op inside a transaction, so it is switched around the migration.
        db.execute_batch("PRAGMA journal_mode = WAL; PRAGMA foreign_keys = OFF;")?;
        let tx = db.transaction_with_behavior(rusqlite::TransactionBehavior::Immediate)?;
        let version: u32 = tx.pragma_query_value(None, "user_version", |row| row.get(0))?;
        let version = version as usize;
        if version > MIGRATIONS.len() {
            return Err(StudioError::Input(
                "Cơ sở dữ liệu cần phiên bản ứng dụng mới hơn.",
            ));
        }
        for (index, sql) in MIGRATIONS.iter().enumerate().skip(version) {
            tx.execute_batch(sql)?;
            tx.pragma_update(None, "user_version", (index + 1) as u32)?;
        }
        if version < MIGRATIONS.len() && tx.prepare("PRAGMA foreign_key_check")?.exists([])? {
            return Err(StudioError::Input(
                "Không thể nâng cấp cơ sở dữ liệu mà vẫn giữ toàn vẹn dữ liệu.",
            ));
        }
        // A render cannot outlive the process that started FFmpeg.
        tx.execute(
            "UPDATE render_jobs SET status = 'failed', finished_at = strftime('%Y-%m-%dT%H:%M:%SZ', 'now'),
             error = 'Ứng dụng đã đóng trong lúc xuất video.' WHERE status = 'running'",
            [],
        )?;
        // A publish worker dies with the process too. The upload reference is kept so
        // a retry can pick the post up instead of sending it twice.
        tx.execute(
            "UPDATE publishing_jobs SET status = 'failed',
             error = 'Ứng dụng đã đóng trong lúc đăng. Kiểm tra bài trên nền tảng trước khi thử lại.'
             WHERE status = 'publishing'",
            [],
        )?;
        tx.commit()?;
        db.execute_batch("PRAGMA foreign_keys = ON;")?;
        Ok(Self {
            connection: Mutex::new(db),
            preview_generation: Mutex::new(()),
        })
    }

    pub(crate) fn db(&self) -> Result<MutexGuard<'_, Connection>> {
        self.connection
            .lock()
            .map_err(|_| StudioError::Input("Cơ sở dữ liệu đang lỗi. Hãy khởi động lại ứng dụng."))
    }

    pub fn grant(&self, root: &str) -> Result<i64> {
        let db = self.db()?;
        Self::grant_scope(&db, root, false)
    }

    fn grant_scope(db: &Connection, root: &str, file_only: bool) -> Result<i64> {
        db.execute(
            "INSERT OR IGNORE INTO folder_grants(root, file_only) VALUES (?1, ?2)",
            params![root, file_only],
        )?;
        db.query_row(
            "SELECT id FROM folder_grants WHERE root = ?1 AND file_only = ?2",
            params![root, file_only],
            |row| row.get(0),
        )
        .optional()?
        .ok_or(StudioError::Input(
            "Loại nguồn đã thay đổi. Hãy thu hồi quyền cũ trước.",
        ))
    }

    pub fn register_file(&self, path: &str, entry: &IndexEntry) -> Result<i64> {
        let mut db = self.db()?;
        let tx = db.transaction()?;
        let id = Self::grant_scope(&tx, path, true)?;
        Self::write_entries(&tx, id, std::slice::from_ref(entry))?;
        tx.commit()?;
        Ok(id)
    }

    pub fn folders(&self) -> Result<Vec<Folder>> {
        let db = self.db()?;
        let mut statement = db.prepare(
            "SELECT g.id, g.root, COUNT(a.id), g.file_only FROM folder_grants g
             LEFT JOIN assets a ON a.folder_id = g.id AND a.available = 1
             GROUP BY g.id ORDER BY g.id",
        )?;
        let rows = statement.query_map([], |row| {
            Ok(Folder {
                id: row.get(0)?,
                root: row.get(1)?,
                asset_count: row.get(2)?,
                file_only: row.get(3)?,
            })
        })?;
        Ok(rows.collect::<rusqlite::Result<_>>()?)
    }

    pub fn scope(&self, folder_id: i64) -> Result<(String, bool)> {
        self.db()?
            .query_row(
                "SELECT root, file_only FROM folder_grants WHERE id = ?",
                [folder_id],
                |row| Ok((row.get(0)?, row.get(1)?)),
            )
            .optional()?
            .ok_or(NOT_GRANTED)
    }

    pub fn file_grant(&self, root: &str) -> Result<Option<i64>> {
        Ok(self
            .db()?
            .query_row(
                "SELECT id FROM folder_grants WHERE root = ? AND file_only = 1",
                [root],
                |row| row.get(0),
            )
            .optional()?)
    }

    pub fn revoke(&self, folder_id: i64) -> Result<()> {
        self.db()?
            .execute("DELETE FROM folder_grants WHERE id = ?", [folder_id])?;
        Ok(())
    }

    pub fn fingerprints(
        &self,
        folder_id: i64,
        require_thumbnail: bool,
    ) -> Result<std::collections::HashMap<String, (i64, String)>> {
        let db = self.db()?;
        let mut statement = db.prepare(
            "SELECT a.relative_path, a.bytes, a.modified
             FROM assets a JOIN asset_metadata m ON m.asset_id = a.id
             WHERE a.folder_id = ?1 AND a.available = 1
             AND (?2 = 0 OR a.kind = 'audio' OR m.thumbnail IS NOT NULL)",
        )?;
        let rows = statement.query_map(params![folder_id, require_thumbnail], |row| {
            Ok((row.get(0)?, (row.get(1)?, row.get(2)?)))
        })?;
        Ok(rows.collect::<rusqlite::Result<_>>()?)
    }

    pub fn apply_scan(&self, folder_id: i64, entries: &[IndexEntry], partial: bool) -> Result<()> {
        let mut db = self.db()?;
        let tx = db.transaction()?;
        if !tx.query_row(
            "SELECT EXISTS(SELECT 1 FROM folder_grants WHERE id = ?)",
            [folder_id],
            |row| row.get::<_, bool>(0),
        )? {
            return Err(NOT_GRANTED);
        }
        if !partial {
            tx.execute(
                "UPDATE assets SET available = 0 WHERE folder_id = ?",
                [folder_id],
            )?;
        }
        Self::write_entries(&tx, folder_id, entries)?;
        tx.commit()?;
        Ok(())
    }

    fn write_entries(tx: &Connection, folder_id: i64, entries: &[IndexEntry]) -> Result<()> {
        {
            let mut unchanged = tx.prepare(
                "UPDATE assets SET available = 1 WHERE folder_id = ? AND relative_path = ?",
            )?;
            let mut asset = tx.prepare(
                "INSERT INTO assets(folder_id, relative_path, kind, bytes, modified) VALUES (?, ?, ?, ?, ?)
                 ON CONFLICT(folder_id, relative_path) DO UPDATE
                 SET kind = excluded.kind, bytes = excluded.bytes, modified = excluded.modified, available = 1
                 RETURNING id",
            )?;
            let mut metadata = tx.prepare(
                "INSERT OR REPLACE INTO asset_metadata
                 (asset_id, duration_ms, width, height, codec, frame_rate, thumbnail) VALUES (?, ?, ?, ?, ?, ?, ?)",
            )?;
            for entry in entries {
                if let Some(data) = &entry.metadata {
                    let id: i64 = asset.query_row(
                        params![
                            folder_id,
                            entry.relative_path,
                            data.kind,
                            entry.bytes,
                            entry.modified
                        ],
                        |row| row.get(0),
                    )?;
                    metadata.execute(params![
                        id,
                        data.duration_ms,
                        data.width,
                        data.height,
                        data.codec,
                        data.frame_rate,
                        data.thumbnail
                    ])?;
                } else {
                    unchanged.execute(params![folder_id, entry.relative_path])?;
                }
            }
        }
        Ok(())
    }

    pub fn assets(&self, folder_id: Option<i64>, page: u32) -> Result<AssetPage> {
        self.search_assets(folder_id, page, "", None)
    }

    pub fn search_assets(
        &self,
        folder_id: Option<i64>,
        page: u32,
        keyword: &str,
        kind: Option<&str>,
    ) -> Result<AssetPage> {
        const FILTER: &str = "a.available = 1 AND (?1 IS NULL OR a.folder_id = ?1)
            AND (?2 IS NULL OR a.kind = ?2) AND instr(lower(a.relative_path), lower(?3)) > 0";
        let keyword: String = keyword.trim().chars().take(120).collect();
        let db = self.db()?;
        let total = db.query_row(
            &format!("SELECT COUNT(*) FROM assets a WHERE {FILTER}"),
            params![folder_id, kind, keyword],
            |row| row.get(0),
        )?;
        let mut statement = db.prepare(&format!(
            "SELECT a.id, a.folder_id, a.relative_path, a.kind, a.bytes, m.duration_ms, m.width, m.height,
                    m.codec, m.frame_rate, m.thumbnail IS NOT NULL
             FROM assets a JOIN asset_metadata m ON m.asset_id = a.id
             WHERE {FILTER} ORDER BY a.id DESC LIMIT ?4 OFFSET ?5"
        ))?;
        let rows = statement.query_map(
            params![
                folder_id,
                kind,
                keyword,
                PAGE_SIZE,
                i64::from(page) * i64::from(PAGE_SIZE)
            ],
            |row| {
                Ok(Asset {
                    id: row.get(0)?,
                    folder_id: row.get(1)?,
                    relative_path: row.get(2)?,
                    kind: row.get(3)?,
                    bytes: row.get(4)?,
                    duration_ms: row.get(5)?,
                    width: row.get(6)?,
                    height: row.get(7)?,
                    codec: row.get(8)?,
                    frame_rate: row.get(9)?,
                    has_thumbnail: row.get(10)?,
                })
            },
        )?;
        Ok(AssetPage {
            items: rows.collect::<rusqlite::Result<_>>()?,
            total,
            page_size: PAGE_SIZE,
        })
    }

    pub fn source(&self, asset_id: i64, thumbnail: bool) -> Result<Option<AssetSource>> {
        Ok(self
            .db()?
            .query_row(
                "SELECT g.root, a.relative_path, a.kind, m.width, m.height, CASE WHEN ?2 THEN m.thumbnail END, m.duration_ms, g.file_only
             FROM assets a JOIN folder_grants g ON g.id = a.folder_id
             JOIN asset_metadata m ON m.asset_id = a.id
             WHERE a.id = ?1 AND a.available = 1",
                params![asset_id, thumbnail],
                |row| {
                    Ok(AssetSource {
                        root: row.get(0)?,
                        relative_path: row.get(1)?,
                        kind: row.get(2)?,
                        width: row.get(3)?,
                        height: row.get(4)?,
                        thumbnail: row.get(5)?,
                    duration_ms: row.get(6)?,
                    file_only: row.get(7)?,
                    })
                },
            )
            .optional()?)
    }

    pub fn derived_preview(
        &self,
        asset_id: i64,
        preview: DerivedPreview,
    ) -> Result<Option<Vec<u8>>> {
        Ok(self.db()?.query_row(
            &format!("SELECT m.{} FROM asset_metadata m JOIN assets a ON a.id = m.asset_id WHERE a.id = ? AND a.available = 1", preview.column()),
            [asset_id], |row| row.get::<_, Option<Vec<u8>>>(0),
        ).optional()?.flatten())
    }

    pub fn cache_derived_preview(
        &self,
        asset_id: i64,
        preview: DerivedPreview,
        bytes: &[u8],
    ) -> Result<()> {
        self.db()?.execute(
            &format!(
                "UPDATE asset_metadata SET {} = ? WHERE asset_id = ?",
                preview.column()
            ),
            params![bytes, asset_id],
        )?;
        Ok(())
    }

    pub fn projects(&self) -> Result<Vec<Project>> {
        let db = self.db()?;
        let mut statement = db.prepare("SELECT id, name FROM projects ORDER BY id DESC")?;
        let rows = statement.query_map([], |row| {
            Ok(Project {
                id: row.get(0)?,
                name: row.get(1)?,
            })
        })?;
        Ok(rows.collect::<rusqlite::Result<_>>()?)
    }

    pub fn create_project(&self, name: &str) -> Result<Project> {
        self.create_project_with_timeline(name, None)
    }

    pub fn create_project_with_timeline(
        &self,
        name: &str,
        snapshot: Option<&TimelineSnapshot>,
    ) -> Result<Project> {
        let name = name.trim();
        if name.is_empty() || name.chars().count() > 80 || name.chars().any(char::is_control) {
            return Err(StudioError::Input(
                "Tên dự án phải có từ 1 đến 80 ký tự hợp lệ.",
            ));
        }
        let mut db = self.db()?;
        let tx = db.transaction()?;
        tx.execute("INSERT INTO projects(name) VALUES (?)", [name])?;
        let id = tx.last_insert_rowid();
        tx.execute("INSERT INTO timelines(id) VALUES (?)", [id])?;
        tx.execute(
            "INSERT INTO timeline_tracks(timeline_id, kind) VALUES (?1, 'video'), (?1, 'audio')",
            [id],
        )?;
        if let Some(snapshot) = snapshot {
            Self::write_timeline(&tx, id, snapshot)?;
        }
        tx.commit()?;
        Ok(Project {
            id,
            name: name.to_owned(),
        })
    }

    pub fn timeline(&self, project_id: i64) -> Result<Timeline> {
        let db = self.db()?;
        let (titles, aspect, lanes) = db.query_row(
            "SELECT titles_json, aspect_json, lanes_json FROM timelines WHERE id = ?",
            [project_id],
            |row| Ok((decode(row, 0)?, decode(row, 1)?, decode(row, 2)?)),
        )?;
        let mut statement = db.prepare(
            "SELECT c.id, a.id, a.relative_path, a.kind, t.kind, c.start_ms, c.end_ms, c.position_ms,
                    m.duration_ms, a.available, c.layer, c.look_json, m.width, m.height, m.thumbnail IS NOT NULL
             FROM timeline_clips c JOIN timeline_tracks t ON t.id = c.track_id
             JOIN assets a ON a.id = c.asset_id JOIN asset_metadata m ON m.asset_id = a.id
             WHERE t.timeline_id = ? ORDER BY t.id, c.position_ms, c.id",
        )?;
        let rows = statement.query_map([project_id], |row| {
            Ok(TimelineClip {
                id: row.get(0)?,
                asset_id: row.get(1)?,
                relative_path: row.get(2)?,
                kind: row.get(3)?,
                track: row.get(4)?,
                start_ms: row.get(5)?,
                end_ms: row.get(6)?,
                position_ms: row.get(7)?,
                source_duration_ms: row.get(8)?,
                available: row.get(9)?,
                layer: row.get(10)?,
                look: decode(row, 11)?,
                width: row.get(12)?,
                height: row.get(13)?,
                has_thumbnail: row.get(14)?,
            })
        })?;
        Ok(Timeline {
            version: TIMELINE_VERSION,
            clips: rows.collect::<rusqlite::Result<_>>()?,
            titles,
            aspect,
            lanes,
        })
    }

    /// The saved timeline in the versioned contract the renderer consumes.
    pub fn snapshot(&self, project_id: i64) -> Result<TimelineSnapshot> {
        let mut tracks = vec![
            TrackEdit {
                kind: "video".into(),
                clips: Vec::new(),
            },
            TrackEdit {
                kind: "audio".into(),
                clips: Vec::new(),
            },
        ];
        let timeline = self.timeline(project_id)?;
        for clip in timeline.clips {
            let track = if clip.track == "audio" { 1 } else { 0 };
            tracks[track].clips.push(ClipEdit {
                asset_id: clip.asset_id,
                start_ms: clip.start_ms,
                end_ms: clip.end_ms,
                position_ms: clip.position_ms,
                layer: clip.layer,
                look: clip.look,
            });
        }
        Ok(TimelineSnapshot {
            version: TIMELINE_VERSION,
            tracks,
            titles: timeline.titles,
            aspect: timeline.aspect,
            lanes: timeline.lanes,
            export_range: None,
        })
    }

    /// Replaces the project's clips with a validated snapshot in one transaction.
    pub fn save_timeline(&self, project_id: i64, snapshot: &TimelineSnapshot) -> Result<()> {
        let mut db = self.db()?;
        let tx = db.transaction()?;
        Self::write_timeline(&tx, project_id, snapshot)?;
        tx.commit()?;
        Ok(())
    }

    fn write_timeline(
        tx: &rusqlite::Transaction<'_>,
        project_id: i64,
        snapshot: &TimelineSnapshot,
    ) -> Result<()> {
        check_version(snapshot)?;
        let tracks: HashMap<String, i64> = tx
            .prepare("SELECT kind, id FROM timeline_tracks WHERE timeline_id = ?")?
            .query_map([project_id], |row| Ok((row.get(0)?, row.get(1)?)))?
            .collect::<rusqlite::Result<_>>()?;
        if tracks.is_empty() {
            return Err(StudioError::Input("Không tìm thấy dự án."));
        }
        tx.execute(
            "UPDATE timelines SET titles_json = ?2, aspect_json = ?3, lanes_json = ?4 WHERE id = ?1",
            params![
                project_id,
                encode(&snapshot.titles)?,
                encode(&snapshot.aspect)?,
                encode(&snapshot.lanes)?
            ],
        )?;
        tx.execute(
            "DELETE FROM timeline_clips WHERE track_id IN
             (SELECT id FROM timeline_tracks WHERE timeline_id = ?)",
            [project_id],
        )?;
        {
            let mut asset = tx.prepare(
                "SELECT a.kind, m.duration_ms FROM assets a
                 JOIN asset_metadata m ON m.asset_id = a.id WHERE a.id = ?",
            )?;
            let mut insert = tx.prepare(
                "INSERT INTO timeline_clips(track_id, asset_id, start_ms, end_ms, position_ms, layer, look_json)
                 VALUES (?, ?, ?, ?, ?, ?, ?)",
            )?;
            for track in &snapshot.tracks {
                let track_id = tracks
                    .get(&track.kind)
                    .ok_or(StudioError::Input("Không tìm thấy track của dự án."))?;
                check_track(&track.clips)?;
                for clip in &track.clips {
                    let (kind, duration_ms): (String, Option<i64>) = asset
                        .query_row([clip.asset_id], |row| Ok((row.get(0)?, row.get(1)?)))
                        .optional()?
                        .ok_or(StudioError::Input(
                            "Media của clip không còn trong thư viện.",
                        ))?;
                    check_clip(
                        &track.kind,
                        clip,
                        &AssetFacts {
                            kind: &kind,
                            duration_ms,
                        },
                    )?;
                    insert.execute(params![
                        track_id,
                        clip.asset_id,
                        clip.start_ms,
                        clip.end_ms,
                        clip.position_ms,
                        clip.layer,
                        encode(&clip.look)?,
                    ])?;
                }
            }
        }
        Ok(())
    }

    pub fn create_render_job(
        &self,
        project_id: i64,
        snapshot: &TimelineSnapshot,
        output_path: &str,
    ) -> Result<RenderJob> {
        let json = serde_json::to_string(snapshot)
            .map_err(|_| StudioError::Input("Không thể lưu snapshot timeline."))?;
        let db = self.db()?;
        if db.query_row(
            "SELECT EXISTS(SELECT 1 FROM render_jobs WHERE status IN ('queued', 'running')
              AND output_path = ?1 COLLATE NOCASE)",
            [output_path],
            |row| row.get::<_, bool>(0),
        )? {
            return Err(StudioError::Input(
                "Tên tệp đã có trong hàng đợi. Hãy chọn tên khác.",
            ));
        }
        Ok(db.query_row(
            "INSERT INTO render_jobs(project_id, status, snapshot, output_path, duration_ms)
             VALUES (?, 'queued', ?, ?, ?)
             RETURNING id, project_id, status, progress, output_path, duration_ms, error, created_at, finished_at",
            params![project_id, json, output_path, snapshot.export_duration_ms()?],
            render_job,
        )?)
    }

    pub fn render_jobs(&self, project_id: i64) -> Result<Vec<RenderJob>> {
        let db = self.db()?;
        let mut statement = db.prepare(&format!(
            "{RENDER_JOB} WHERE project_id = ? ORDER BY id DESC LIMIT 8"
        ))?;
        let rows = statement.query_map([project_id], render_job)?;
        Ok(rows.collect::<rusqlite::Result<_>>()?)
    }

    pub fn render_queue(&self) -> Result<Vec<RenderJob>> {
        let db = self.db()?;
        let mut statement = db.prepare(&format!(
            "{RENDER_JOB} WHERE status IN ('queued', 'running') OR id IN
              (SELECT id FROM render_jobs ORDER BY id DESC LIMIT 50)
             ORDER BY CASE status WHEN 'running' THEN 0 WHEN 'queued' THEN 1 ELSE 2 END,
               CASE WHEN status = 'queued' THEN id ELSE -id END"
        ))?;
        let rows = statement.query_map([], render_job)?;
        Ok(rows.collect::<rusqlite::Result<_>>()?)
    }

    pub fn next_queued_render(&self) -> Result<Option<i64>> {
        Ok(self
            .db()?
            .query_row(
                "SELECT id FROM render_jobs WHERE status = 'queued' ORDER BY id LIMIT 1",
                [],
                |row| row.get(0),
            )
            .optional()?)
    }

    pub fn insert_template(&self, template: &crate::templates::Template) -> Result<i64> {
        let db = self.db()?;
        db.execute(
            "INSERT INTO editor_templates(data) VALUES (?)",
            [encode(template)?],
        )?;
        Ok(db.last_insert_rowid())
    }

    pub fn templates(&self) -> Result<Vec<crate::templates::TemplateEntry>> {
        let db = self.db()?;
        let mut statement = db.prepare("SELECT id, data FROM editor_templates ORDER BY id DESC")?;
        let rows = statement.query_map([], |row| {
            Ok(crate::templates::TemplateEntry {
                id: row.get(0)?,
                template: decode(row, 1)?,
            })
        })?;
        Ok(rows.collect::<rusqlite::Result<_>>()?)
    }

    pub fn render_job(&self, job_id: i64) -> Result<RenderJob> {
        self.db()?
            .query_row(&format!("{RENDER_JOB} WHERE id = ?"), [job_id], render_job)
            .optional()?
            .ok_or(StudioError::Input("Không tìm thấy lượt xuất video."))
    }

    pub fn render_task(&self, job_id: i64) -> Result<RenderTask> {
        let (json, output_path): (String, String) = self
            .db()?
            .query_row(
                "SELECT snapshot, output_path FROM render_jobs WHERE id = ?",
                [job_id],
                |row| Ok((row.get(0)?, row.get(1)?)),
            )
            .optional()?
            .ok_or(StudioError::Input("Không tìm thấy lượt xuất video."))?;
        let snapshot = serde_json::from_str(&json)
            .map_err(|_| StudioError::Input("Snapshot của lượt xuất không đọc được."))?;
        Ok(RenderTask {
            snapshot,
            output_path,
        })
    }

    /// Moves a job between states. `from` guards against acting on a stale status.
    pub fn set_render_status(
        &self,
        job_id: i64,
        from: &[&str],
        status: &str,
        error: Option<&str>,
    ) -> Result<bool> {
        let finished = matches!(status, "done" | "failed" | "canceled");
        let db = self.db()?;
        let current: Option<String> = db
            .query_row(
                "SELECT status FROM render_jobs WHERE id = ?",
                [job_id],
                |row| row.get(0),
            )
            .optional()?;
        if !current.is_some_and(|value| from.contains(&value.as_str())) {
            return Ok(false);
        }
        if status == "queued" && db.query_row(
            "SELECT EXISTS(SELECT 1 FROM render_jobs WHERE id <> ?1 AND status IN ('queued', 'running')
              AND output_path = (SELECT output_path FROM render_jobs WHERE id = ?1) COLLATE NOCASE)",
            [job_id], |row| row.get::<_, bool>(0),
        )? {
            return Err(StudioError::Input("Tên tệp đã có trong hàng đợi."));
        }
        db.execute(
            "UPDATE render_jobs SET status = ?2, error = ?3,
             progress = CASE ?2 WHEN 'done' THEN 1000 WHEN 'queued' THEN 0 ELSE progress END,
             finished_at = CASE WHEN ?4 THEN strftime('%Y-%m-%dT%H:%M:%SZ', 'now') END
             WHERE id = ?1",
            params![job_id, status, error, finished],
        )?;
        Ok(true)
    }

    pub fn set_render_progress(&self, job_id: i64, progress: u16) -> Result<()> {
        self.db()?.execute(
            "UPDATE render_jobs SET progress = ?2 WHERE id = ?1 AND status = 'running'",
            params![job_id, progress.min(999)],
        )?;
        Ok(())
    }
}
