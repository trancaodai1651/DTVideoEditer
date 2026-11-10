use serde::Serialize;

#[derive(Debug, thiserror::Error)]
pub enum StudioError {
    #[error("{0}")]
    Input(&'static str),
    #[error("{0}")]
    Message(String),
    #[error("Không thể đọc dữ liệu trên máy: {0}")]
    Io(#[from] std::io::Error),
    #[error("Không thể truy cập cơ sở dữ liệu: {0}")]
    Database(#[from] rusqlite::Error),
}

pub type Result<T> = std::result::Result<T, StudioError>;

#[derive(Serialize)]
#[serde(rename_all = "camelCase")]
pub struct Folder {
    pub id: i64,
    pub root: String,
    pub asset_count: u32,
}

#[derive(Debug, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct Asset {
    pub id: i64,
    pub folder_id: i64,
    pub relative_path: String,
    pub kind: String,
    pub bytes: i64,
    pub duration_ms: Option<i64>,
    pub width: Option<u32>,
    pub height: Option<u32>,
    pub codec: Option<String>,
    pub frame_rate: Option<f64>,
    pub has_thumbnail: bool,
}

#[derive(Serialize)]
#[serde(rename_all = "camelCase")]
pub struct AssetPage {
    pub items: Vec<Asset>,
    pub total: u32,
    pub page_size: u32,
}

#[derive(Serialize)]
pub struct Project {
    pub id: i64,
    pub name: String,
}

#[derive(Serialize)]
#[serde(rename_all = "camelCase")]
pub struct TimelineClip {
    pub id: i64,
    pub asset_id: i64,
    pub relative_path: String,
    pub kind: String,
    pub track: String,
    pub start_ms: i64,
    pub end_ms: i64,
    pub position_ms: i64,
    pub source_duration_ms: Option<i64>,
    pub available: bool,
}

#[derive(Serialize)]
pub struct Timeline {
    pub version: u32,
    pub clips: Vec<TimelineClip>,
}

#[derive(Clone, Debug, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct RenderJob {
    pub id: i64,
    pub project_id: i64,
    pub status: String,
    pub progress: u16,
    pub output_path: String,
    pub duration_ms: i64,
    pub error: Option<String>,
    pub created_at: String,
    pub finished_at: Option<String>,
}

#[derive(Default, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct ScanReport {
    pub indexed: usize,
    pub reused: usize,
    pub skipped: usize,
    pub partial: bool,
}

#[derive(Serialize)]
pub struct MediaTools {
    pub ffprobe: bool,
    pub ffmpeg: bool,
}
