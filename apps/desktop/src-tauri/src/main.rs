#![cfg_attr(not(debug_assertions), windows_subsystem = "windows")]

mod analysis;
mod caption_render;
mod captions;
mod catalog;
mod generative;
mod library;
mod model;
mod premiere;
mod preview;
mod probe;
mod project_file;
mod proxy;
mod publish;
mod render;
mod store;
mod templates;
mod timeline;
mod voice;

#[cfg(test)]
mod smoke;

use std::{
    path::PathBuf,
    sync::{
        Arc, Mutex,
        atomic::{AtomicBool, AtomicUsize, Ordering},
    },
};

use tauri::{AppHandle, DragDropEvent, Emitter, Manager, State, WindowEvent, http::StatusCode};
use tauri_plugin_dialog::{DialogExt, MessageDialogButtons, MessageDialogKind};

use model::{
    AssetPage, Folder, MediaTools, Project, RenderJob, Result, ScanReport, StudioError, Timeline,
};
use publish::{
    ConnectInput, DraftInput, Platform, PublishJob, PublishOptions, Publisher, RemotePost,
    SocialAccount,
};
use store::Store;
use timeline::TimelineSnapshot;

struct ActiveRender {
    job_id: i64,
    cancel: Arc<AtomicBool>,
}

struct AppState {
    store: Store,
    data_dir: PathBuf,
    scan: Mutex<()>,
    render: Mutex<Option<ActiveRender>>,
    review: Mutex<Option<preview::RenderedReview>>,
    review_generation: Mutex<()>,
    proxy_dir: PathBuf,
    proxy_generation: Mutex<()>,
    publisher: Publisher,
}

type CommandResult<T> = std::result::Result<T, String>;

fn command<T>(result: Result<T>) -> CommandResult<T> {
    result.map_err(|error| error.to_string())
}

async fn blocking<T: Send + 'static>(
    work: impl FnOnce() -> Result<T> + Send + 'static,
) -> CommandResult<T> {
    let result = tauri::async_runtime::spawn_blocking(work)
        .await
        .map_err(|_| "Tác vụ cục bộ bị gián đoạn.".to_owned())?;
    command(result)
}

#[tauri::command]
async fn pick_folder(app: AppHandle) -> CommandResult<Option<i64>> {
    blocking(move || {
        let window = app
            .get_webview_window("main")
            .ok_or(StudioError::Input("Không tìm thấy cửa sổ chính."))?;
        let Some(selected) = app
            .dialog()
            .file()
            .set_parent(&window)
            .set_title("Cấp quyền cho thư mục media")
            .blocking_pick_folder()
        else {
            return Ok(None);
        };
        let path = selected
            .into_path()
            .map_err(|_| StudioError::Input("Chỉ hỗ trợ thư mục cục bộ."))?;
        let root = library::selected_root(&path)?;
        let root = root
            .to_str()
            .ok_or(StudioError::Input("Tên thư mục không phải UTF-8 hợp lệ."))?;
        app.state::<AppState>().store.grant(root).map(Some)
    })
    .await
}

fn import_local_files(app: &AppHandle, paths: &[PathBuf]) -> Result<library::ImportedFiles> {
    let state = app.state::<AppState>();
    let _scan = state
        .scan
        .try_lock()
        .map_err(|_| StudioError::Input("Đang cập nhật thư viện. Thử lại sau."))?;
    let binary = probe::find_tool("ffprobe")
        .filter(|path| probe::tool_ready(Some(path)))
        .ok_or(StudioError::Input(
            "Cần FFprobe trong PATH để nhập media. Xem Cài đặt.",
        ))?;
    let ffmpeg = probe::find_tool("ffmpeg").filter(|path| probe::tool_ready(Some(path)));
    library::import_files(&state.store, paths, &probe::Ffprobe { binary, ffmpeg })
}

#[tauri::command]
async fn pick_media_files(app: AppHandle) -> CommandResult<Option<library::ImportedFiles>> {
    blocking(move || {
        let window = app
            .get_webview_window("main")
            .ok_or(StudioError::Input("Không tìm thấy cửa sổ chính."))?;
        let Some(files) = app
            .dialog()
            .file()
            .set_parent(&window)
            .set_title("Nhập tệp media")
            .add_filter(
                "Media",
                &[
                    "mp4", "mov", "m4v", "m4a", "webm", "mkv", "mp3", "wav", "flac", "ogg", "opus",
                    "png", "jpg", "jpeg", "webp",
                ],
            )
            .blocking_pick_files()
        else {
            return Ok(None);
        };
        let paths = files
            .into_iter()
            .filter_map(|file| file.into_path().ok())
            .collect::<Vec<_>>();
        import_local_files(&app, &paths).map(Some)
    })
    .await
}

#[derive(serde::Serialize)]
#[serde(tag = "type", rename_all = "snake_case")]
enum MediaDrop {
    Hover {
        x: f64,
        y: f64,
    },
    Left,
    Started {
        id: usize,
        x: f64,
        y: f64,
    },
    Finished {
        id: usize,
        result: CommandResult<library::ImportedFiles>,
    },
}

fn native_drop(window: &tauri::Window, event: &WindowEvent) {
    // The webview that fills a Tauri WebviewWindow reports its drop as a window event.
    let WindowEvent::DragDrop(event) = event else {
        return;
    };
    if window.label() != "main" {
        return;
    }
    let (paths, position) = match event {
        DragDropEvent::Enter { position, .. } | DragDropEvent::Over { position } => {
            let _ = window.emit(
                "studio-media-drop",
                &MediaDrop::Hover {
                    x: position.x,
                    y: position.y,
                },
            );
            return;
        }
        DragDropEvent::Leave => {
            let _ = window.emit("studio-media-drop", &MediaDrop::Left);
            return;
        }
        DragDropEvent::Drop { paths, position } if !paths.is_empty() => (paths, position),
        _ => return,
    };
    static NEXT_DROP: AtomicUsize = AtomicUsize::new(1);
    let id = NEXT_DROP.fetch_add(1, Ordering::Relaxed);
    let app = window.app_handle().clone();
    let _ = window.emit(
        "studio-media-drop",
        &MediaDrop::Started {
            id,
            x: position.x,
            y: position.y,
        },
    );
    let paths = paths.clone();
    tauri::async_runtime::spawn_blocking(move || {
        let result = command(import_local_files(&app, &paths));
        if let Some(window) = app.get_webview_window("main") {
            let _ = window.emit("studio-media-drop", &MediaDrop::Finished { id, result });
        }
    });
}

#[tauri::command]
async fn scan_folder(app: AppHandle, folder_id: i64) -> CommandResult<ScanReport> {
    blocking(move || {
        let state = app.state::<AppState>();
        let _scan = state
            .scan
            .try_lock()
            .map_err(|_| StudioError::Input("Đang quét một thư mục khác."))?;
        let binary = probe::find_tool("ffprobe")
            .filter(|path| probe::tool_ready(Some(path)))
            .ok_or(StudioError::Input(
                "Cần FFprobe trong PATH để quét media. Xem Cài đặt.",
            ))?;
        let ffmpeg = probe::find_tool("ffmpeg").filter(|path| probe::tool_ready(Some(path)));
        library::scan(&state.store, folder_id, &probe::Ffprobe { binary, ffmpeg })
    })
    .await
}

#[tauri::command]
async fn media_tools() -> CommandResult<MediaTools> {
    blocking(|| {
        Ok(MediaTools {
            ffprobe: probe::tool_ready(probe::find_tool("ffprobe").as_deref()),
            ffmpeg: probe::tool_ready(probe::find_tool("ffmpeg").as_deref()),
        })
    })
    .await
}

#[tauri::command]
fn list_folders(state: State<AppState>) -> CommandResult<Vec<Folder>> {
    command(state.store.folders())
}

#[tauri::command]
fn revoke_folder(state: State<AppState>, folder_id: i64) -> CommandResult<()> {
    let _scan = state
        .scan
        .try_lock()
        .map_err(|_| "Chờ tác vụ quét hoàn tất trước khi thu hồi.".to_owned())?;
    command(state.store.revoke(folder_id))
}

#[tauri::command]
fn list_assets(
    state: State<AppState>,
    folder_id: Option<i64>,
    page: u32,
    keyword: Option<String>,
    kind: Option<String>,
) -> CommandResult<AssetPage> {
    command(state.store.search_assets(
        folder_id,
        page,
        keyword.as_deref().unwrap_or_default(),
        kind.as_deref(),
    ))
}

#[tauri::command]
async fn list_studio_catalog(app: AppHandle) -> CommandResult<Vec<catalog::CatalogItem>> {
    blocking(move || {
        let state = app.state::<AppState>();
        let _scan = state
            .scan
            .try_lock()
            .map_err(|_| StudioError::Input("Đang cập nhật thư viện."))?;
        catalog::load(&state.store, &state.data_dir)
    })
    .await
}

fn subtitle_dialog(app: &AppHandle, save: bool) -> Result<Option<PathBuf>> {
    let window = app
        .get_webview_window("main")
        .ok_or(StudioError::Input("Không tìm thấy cửa sổ chính."))?;
    let dialog = app
        .dialog()
        .file()
        .set_parent(&window)
        .add_filter("SubRip SRT", &["srt"]);
    let selected = if save {
        dialog
            .set_title("Xuất phụ đề SRT")
            .set_file_name("phu-de.srt")
            .blocking_save_file()
    } else {
        dialog.set_title("Nhập phụ đề SRT").blocking_pick_file()
    };
    selected
        .map(|file| {
            file.into_path()
                .map_err(|_| StudioError::Input("Chỉ hỗ trợ tệp trên máy."))
        })
        .transpose()
}

#[tauri::command]
async fn import_srt(app: AppHandle) -> CommandResult<Option<Vec<captions::Cue>>> {
    blocking(move || {
        subtitle_dialog(&app, false)?
            .map(|path| captions::read(&path))
            .transpose()
    })
    .await
}

#[tauri::command]
async fn export_srt(app: AppHandle, cues: Vec<captions::Cue>) -> CommandResult<bool> {
    blocking(move || {
        let Some(mut path) = subtitle_dialog(&app, true)? else {
            return Ok(false);
        };
        if !path
            .extension()
            .is_some_and(|extension| extension.eq_ignore_ascii_case("srt"))
        {
            path.as_mut_os_string().push(".srt");
        }
        captions::write(&path, cues)?;
        Ok(true)
    })
    .await
}

#[tauri::command]
async fn transcribe_clip(
    app: AppHandle,
    clip: captions::SpeechClip,
    language: String,
    choose_model: Option<bool>,
    word_timing: Option<bool>,
) -> CommandResult<Option<Vec<captions::Cue>>> {
    blocking(move || {
        let state = app.state::<AppState>();
        let _scan = state
            .scan
            .try_lock()
            .map_err(|_| StudioError::Input("Đang cập nhật thư viện."))?;
        captions::whisper_binary()?;
        let path = if choose_model == Some(true) {
            let window = app
                .get_webview_window("main")
                .ok_or(StudioError::Input("Không tìm thấy cửa sổ chính."))?;
            let Some(selected) = app
                .dialog()
                .file()
                .set_parent(&window)
                .set_title("Chọn mô hình Whisper GGML")
                .add_filter("Mô hình Whisper", &["bin"])
                .blocking_pick_file()
            else {
                return Ok(None);
            };
            selected
                .into_path()
                .map_err(|_| StudioError::Input("Chỉ hỗ trợ mô hình trên máy."))?
        } else {
            let resources = app.path().resource_dir().ok();
            captions::default_model(resources.as_deref(), &state.data_dir, || {
                let _ = app.emit("studio-caption-progress", -1_i64);
            })?
        };
        captions::transcribe(
            &state.store,
            &clip,
            &language,
            &path,
            word_timing.unwrap_or(false),
            |done, total| {
                let _ = app.emit("studio-caption-progress", done * 100 / total);
            },
        )
        .map(Some)
    })
    .await
}

#[tauri::command]
fn list_projects(state: State<AppState>) -> CommandResult<Vec<Project>> {
    command(state.store.projects())
}

#[tauri::command]
fn create_project(state: State<AppState>, name: String) -> CommandResult<Project> {
    command(state.store.create_project(&name))
}

#[tauri::command]
fn load_timeline(state: State<AppState>, project_id: i64) -> CommandResult<Timeline> {
    command(state.store.timeline(project_id))
}

#[tauri::command]
fn save_timeline(
    state: State<AppState>,
    project_id: i64,
    snapshot: TimelineSnapshot,
) -> CommandResult<()> {
    command(state.store.save_timeline(project_id, &snapshot))
}

#[tauri::command]
fn create_edited_project(
    state: State<AppState>,
    name: String,
    snapshot: TimelineSnapshot,
) -> CommandResult<Project> {
    command(
        state
            .store
            .create_project_with_timeline(&name, Some(&snapshot)),
    )
}

#[tauri::command]
async fn save_project_file(app: AppHandle, project_id: i64) -> CommandResult<Option<String>> {
    blocking(move || {
        let state = app.state::<AppState>();
        let project = state
            .store
            .projects()?
            .into_iter()
            .find(|project| project.id == project_id)
            .ok_or(StudioError::Input("Không tìm thấy dự án."))?;
        let window = app
            .get_webview_window("main")
            .ok_or(StudioError::Input("Không tìm thấy cửa sổ chính."))?;
        let name = PathBuf::from(output_name(&project.name)).with_extension("dtedit");
        let Some(file) = app
            .dialog()
            .file()
            .set_parent(&window)
            .set_title("Lưu dự án DT Edit")
            .set_file_name(name.to_string_lossy().as_ref())
            .add_filter("Dự án DT Edit", &["dtedit"])
            .blocking_save_file()
        else {
            return Ok(None);
        };
        let path = file
            .into_path()
            .map_err(|_| StudioError::Input("Chọn tệp dự án trên máy."))?;
        let path = if path.extension().is_none() {
            path.with_extension("dtedit")
        } else {
            path
        };
        Ok(Some(
            project_file::save(&state.store, &project, &path)?
                .to_string_lossy()
                .into_owned(),
        ))
    })
    .await
}

#[tauri::command]
async fn export_premiere_xml(
    app: AppHandle,
    project_id: i64,
) -> CommandResult<Option<premiere::ExportResult>> {
    blocking(move || {
        let state = app.state::<AppState>();
        let project = state
            .store
            .projects()?
            .into_iter()
            .find(|project| project.id == project_id)
            .ok_or(StudioError::Input("Không tìm thấy dự án."))?;
        let window = app
            .get_webview_window("main")
            .ok_or(StudioError::Input("Không tìm thấy cửa sổ chính."))?;
        let name = PathBuf::from(output_name(&project.name)).with_extension("xml");
        let Some(file) = app
            .dialog()
            .file()
            .set_parent(&window)
            .set_title("Xuất timeline cho Adobe Premiere")
            .set_file_name(name.to_string_lossy().as_ref())
            .add_filter("Final Cut Pro XML", &["xml"])
            .blocking_save_file()
        else {
            return Ok(None);
        };
        let path = file
            .into_path()
            .map_err(|_| StudioError::Input("Chọn vị trí lưu trên máy."))?;
        let path = if path.extension().is_none() {
            path.with_extension("xml")
        } else {
            path
        };
        premiere::export(&state.store, &project, &path).map(Some)
    })
    .await
}

#[tauri::command]
async fn open_project_file(app: AppHandle) -> CommandResult<Option<Project>> {
    blocking(move || {
        let window = app
            .get_webview_window("main")
            .ok_or(StudioError::Input("Không tìm thấy cửa sổ chính."))?;
        let Some(file) = app
            .dialog()
            .file()
            .set_parent(&window)
            .set_title("Mở dự án DT Edit")
            .add_filter("Dự án DT Edit", &["dtedit"])
            .blocking_pick_file()
        else {
            return Ok(None);
        };
        let path = file
            .into_path()
            .map_err(|_| StudioError::Input("Chọn tệp dự án trên máy."))?;
        project_file::open(&app.state::<AppState>().store, &path).map(Some)
    })
    .await
}

#[tauri::command]
async fn prepare_proxy(app: AppHandle, asset_id: i64) -> CommandResult<()> {
    blocking(move || {
        let state = app.state::<AppState>();
        let _building = state
            .proxy_generation
            .lock()
            .map_err(|_| StudioError::Input("Tác vụ tạo proxy bị gián đoạn."))?;
        proxy::build(&state.store, &state.proxy_dir, asset_id)
    })
    .await
}

#[tauri::command]
fn proxy_status(state: State<AppState>, asset_id: i64) -> bool {
    proxy::ready(&state.store, &state.proxy_dir, asset_id).is_some()
}

const RENDER_BUSY: StudioError = StudioError::Input("Đang xuất một video khác.");

/// Drains queued snapshots one at a time, oldest first.
fn launch_render(app: &AppHandle) -> Result<()> {
    let state = app.state::<AppState>();
    let mut active = state.render.lock().map_err(|_| RENDER_BUSY)?;
    if active.is_some() {
        return Ok(());
    }
    let Some(job_id) = state.store.next_queued_render()? else {
        return Ok(());
    };
    let cancel = Arc::new(AtomicBool::new(false));
    *active = Some(ActiveRender {
        job_id,
        cancel: Arc::clone(&cancel),
    });
    drop(active);
    let app = app.clone();
    std::thread::spawn(move || {
        let state = app.state::<AppState>();
        let mut id = job_id;
        let mut cancel = cancel;
        loop {
            let (status, error) = match render::execute(&state.store, id, &cancel) {
                Ok(render::Outcome::Done) => ("done", None),
                Ok(render::Outcome::Canceled) => ("canceled", None),
                Err(error) => ("failed", Some(error.to_string())),
            };
            let _ =
                state
                    .store
                    .set_render_status(id, &["queued", "running"], status, error.as_deref());
            let Ok(mut active) = state.render.lock() else {
                break;
            };
            let Ok(Some(next)) = state.store.next_queued_render() else {
                *active = None;
                break;
            };
            id = next;
            cancel = Arc::new(AtomicBool::new(false));
            *active = Some(ActiveRender {
                job_id: id,
                cancel: Arc::clone(&cancel),
            });
        }
    });
    Ok(())
}

fn output_name(project: &str) -> String {
    let name: String = project
        .chars()
        .map(|c| {
            if c.is_control() || r#"<>:"/\|?*"#.contains(c) {
                '_'
            } else {
                c
            }
        })
        .collect();
    format!("{}.mp4", name.trim().trim_end_matches('.'))
}

#[tauri::command]
async fn start_render(
    app: AppHandle,
    project_id: i64,
    queue_only: Option<bool>,
    export_range: Option<timeline::ExportRange>,
) -> CommandResult<Option<RenderJob>> {
    blocking(move || {
        let state = app.state::<AppState>();
        let project = state
            .store
            .projects()?
            .into_iter()
            .find(|project| project.id == project_id)
            .ok_or(StudioError::Input("Không tìm thấy dự án."))?;
        let mut snapshot = state.store.snapshot(project_id)?;
        snapshot.export_range = export_range;
        if snapshot.export_duration_ms()? == 0 {
            return Err(StudioError::Input("Thêm clip vào timeline trước khi xuất."));
        }
        // Only the native dialog chooses where the video is written.
        let window = app
            .get_webview_window("main")
            .ok_or(StudioError::Input("Không tìm thấy cửa sổ chính."))?;
        let Some(selected) = app
            .dialog()
            .file()
            .set_parent(&window)
            .set_title("Lưu video MP4")
            .set_file_name(output_name(&project.name))
            .add_filter("MP4", &["mp4"])
            .blocking_save_file()
        else {
            return Ok(None);
        };
        let mut path = selected
            .into_path()
            .map_err(|_| StudioError::Input("Chỉ hỗ trợ lưu vào thư mục cục bộ."))?;
        if !path
            .extension()
            .is_some_and(|extension| extension.eq_ignore_ascii_case("mp4"))
        {
            path.as_mut_os_string().push(".mp4");
        }
        let path = render::checked_output(&path, &std::collections::HashMap::new())?;
        let path = path
            .to_str()
            .ok_or(StudioError::Input("Tên tệp không phải UTF-8 hợp lệ."))?;
        let job = state.store.create_render_job(project_id, &snapshot, path)?;
        if !queue_only.unwrap_or(false) {
            launch_render(&app)?;
        }
        Ok(Some(job))
    })
    .await
}

#[tauri::command]
fn retry_render(app: AppHandle, job_id: i64) -> CommandResult<RenderJob> {
    let state = app.state::<AppState>();
    command((|| {
        if !state
            .store
            .set_render_status(job_id, &["failed", "canceled"], "queued", None)?
        {
            return Err(StudioError::Input(
                "Chỉ thử lại được lượt xuất đã lỗi hoặc đã hủy.",
            ));
        }
        state.store.render_job(job_id)
    })())
}

#[tauri::command]
fn cancel_render(state: State<AppState>, job_id: i64) -> CommandResult<()> {
    let active = state.render.lock().map_err(|_| RENDER_BUSY.to_string())?;
    if let Some(active) = active.as_ref().filter(|active| active.job_id == job_id) {
        active.cancel.store(true, Ordering::Relaxed);
    } else {
        command(
            state
                .store
                .set_render_status(job_id, &["queued"], "canceled", None),
        )?;
    }
    Ok(())
}

#[tauri::command]
fn list_render_jobs(state: State<AppState>, project_id: i64) -> CommandResult<Vec<RenderJob>> {
    command(state.store.render_jobs(project_id))
}

#[tauri::command]
fn list_render_queue(state: State<AppState>) -> CommandResult<Vec<RenderJob>> {
    command(state.store.render_queue())
}

#[tauri::command]
fn run_render_queue(app: AppHandle) -> CommandResult<()> {
    command(launch_render(&app))
}

#[tauri::command]
fn list_editor_templates(state: State<AppState>) -> CommandResult<Vec<templates::TemplateEntry>> {
    command(state.store.templates())
}

#[tauri::command]
async fn analyze_reference(
    app: AppHandle,
    asset_id: i64,
    name: String,
) -> CommandResult<templates::TemplateEntry> {
    blocking(move || {
        let state = app.state::<AppState>();
        let _read = state
            .scan
            .try_lock()
            .map_err(|_| StudioError::Input("Chờ tác vụ thư viện đang chạy."))?;
        templates::analyze(&state.store, asset_id, &name)
    })
    .await
}

#[tauri::command]
async fn audio_levels(app: AppHandle, asset_id: i64) -> CommandResult<Vec<u8>> {
    blocking(move || analysis::levels(&app.state::<AppState>().store, asset_id)).await
}

#[tauri::command]
async fn analyze_shots(
    app: AppHandle,
    asset_id: i64,
    start_ms: i64,
    end_ms: i64,
) -> CommandResult<analysis::ShotAnalysis> {
    blocking(move || {
        analysis::analyze_shots(&app.state::<AppState>().store, asset_id, start_ms, end_ms)
    })
    .await
}

#[tauri::command]
async fn render_review(app: AppHandle, project_id: i64, start_ms: i64) -> CommandResult<i64> {
    blocking(move || {
        let state = app.state::<AppState>();
        let _active = state
            .review_generation
            .try_lock()
            .map_err(|_| StudioError::Input("Đang tạo bản xem trước."))?;
        let review = preview::render_review(&state.store, project_id, start_ms)?;
        let id = review.id;
        *state
            .review
            .lock()
            .map_err(|_| StudioError::Input("Không lưu được bản xem trước."))? = Some(review);
        Ok(id)
    })
    .await
}

#[tauri::command]
async fn detect_scenes(
    app: AppHandle,
    asset_id: i64,
    start_ms: i64,
    end_ms: i64,
    threshold: u8,
) -> CommandResult<Vec<i64>> {
    blocking(move || {
        analysis::scene_cuts(
            &app.state::<AppState>().store,
            asset_id,
            start_ms,
            end_ms,
            threshold,
        )
    })
    .await
}

#[tauri::command]
async fn list_voices() -> CommandResult<Vec<voice::Voice>> {
    blocking(voice::voices).await
}

/// Speaks text with a system voice into the app's voice-over folder and imports the WAV.
#[tauri::command]
async fn speak_text(
    app: AppHandle,
    text: String,
    voice: String,
    rate: i8,
) -> CommandResult<library::ImportedFiles> {
    blocking(move || {
        let folder = app.state::<AppState>().data_dir.join("voiceovers");
        let path = voice::speak(&folder, &text, &voice, rate)?;
        import_local_files(&app, &[path])
    })
    .await
}

#[tauri::command]
fn ai_key_status(state: State<AppState>) -> bool {
    voice::has_ai_key(state.publisher.secrets.as_ref())
}

#[tauri::command]
fn set_ai_key(state: State<AppState>, key: String) -> CommandResult<()> {
    command(voice::set_ai_key(state.publisher.secrets.as_ref(), &key))
}

#[tauri::command]
fn avatar_key_status(state: State<AppState>) -> bool {
    generative::has_avatar_key(state.publisher.secrets.as_ref())
}

#[tauri::command]
fn set_avatar_key(state: State<AppState>, key: String) -> CommandResult<()> {
    command(generative::set_avatar_key(
        state.publisher.secrets.as_ref(),
        &key,
    ))
}

#[tauri::command]
async fn create_avatar_video(
    app: AppHandle,
    avatar: String,
    voice: String,
    script: String,
) -> CommandResult<Option<String>> {
    blocking(move || {
        if !confirm(&app, "Tạo video avatar HeyGen", format!("Gửi {} ký tự lời thoại cùng Avatar Look ID và Voice ID đến HeyGen. Yêu cầu có thể dùng tín dụng API của tài khoản.", script.chars().count()), "Gửi và tạo video")? {
            return Ok(None);
        }
        generative::create_avatar(app.state::<AppState>().publisher.secrets.as_ref(), &avatar, &voice, &script).map(Some)
    }).await
}

#[tauri::command]
async fn get_avatar_video(
    app: AppHandle,
    id: String,
) -> CommandResult<generative::AvatarResult<library::ImportedFiles>> {
    blocking(move || {
        let state = app.state::<AppState>();
        let result = generative::get_avatar(
            state.publisher.secrets.as_ref(),
            &state.data_dir.join("avatars"),
            &id,
        )?;
        let media = result
            .media
            .map(|path| import_local_files(&app, &[path]))
            .transpose()?;
        Ok(generative::AvatarResult {
            status: result.status,
            media,
        })
    })
    .await
}

#[tauri::command]
async fn remove_media_background(
    app: AppHandle,
    asset_id: i64,
    start_ms: i64,
    end_ms: i64,
) -> CommandResult<library::ImportedFiles> {
    blocking(move || {
        let state = app.state::<AppState>();
        let resources = app.path().resource_dir().ok();
        let path = generative::remove_background(
            &state.store,
            &state.data_dir.join("cutouts"),
            asset_id,
            start_ms,
            end_ms,
            resources
                .as_deref()
                .map(|path| (path, state.data_dir.as_path())),
        )?;
        import_local_files(&app, &[path])
    })
    .await
}

/// Sends caption lines to Claude only after the user agrees in a native dialog.
#[tauri::command]
async fn translate_captions(
    app: AppHandle,
    lines: Vec<String>,
    language: String,
) -> CommandResult<Option<Vec<String>>> {
    blocking(move || {
        let message = format!(
            "{} câu phụ đề sẽ được gửi tới Anthropic (Claude API) bằng API key của bạn để dịch sang {}. Media không được gửi.",
            lines.len(),
            language.trim()
        );
        if !confirm(&app, "Dịch phụ đề bằng Claude", message, "Gửi và dịch")? {
            return Ok(None);
        }
        let state = app.state::<AppState>();
        voice::translate(state.publisher.secrets.as_ref(), &lines, &language, "https://api.anthropic.com").map(Some)
    })
    .await
}

#[tauri::command]
async fn import_lut(app: AppHandle) -> CommandResult<Option<model::LutEntry>> {
    blocking(move || {
        let window = app
            .get_webview_window("main")
            .ok_or(StudioError::Input("Không tìm thấy cửa sổ chính."))?;
        let Some(file) = app
            .dialog()
            .file()
            .set_parent(&window)
            .set_title("Nhập LUT .cube")
            .add_filter("Cube LUT", &["cube"])
            .blocking_pick_file()
        else {
            return Ok(None);
        };
        let path = file
            .into_path()
            .map_err(|_| StudioError::Input("Chỉ hỗ trợ tệp trên máy."))?;
        if std::fs::metadata(&path)?.len() > 8 * 1024 * 1024 {
            return Err(StudioError::Input("Tệp LUT lớn hơn 8 MB."));
        }
        let cube = std::fs::read_to_string(&path)
            .map_err(|_| StudioError::Input("Tệp LUT phải là văn bản UTF-8."))?;
        voice::validate_cube(&cube)?;
        let name: String = path
            .file_stem()
            .and_then(|stem| stem.to_str())
            .unwrap_or("LUT")
            .chars()
            .filter(|c| !c.is_control())
            .take(120)
            .collect();
        let name = if name.is_empty() {
            "LUT".to_owned()
        } else {
            name
        };
        let state = app.state::<AppState>();
        let id = state.store.insert_lut(&name, &cube)?;
        Ok(Some(model::LutEntry { id, name }))
    })
    .await
}

#[tauri::command]
fn list_luts(state: State<AppState>) -> CommandResult<Vec<model::LutEntry>> {
    command(state.store.luts())
}

#[tauri::command]
fn delete_lut(state: State<AppState>, id: i64) -> CommandResult<()> {
    command(state.store.delete_lut(id))
}

#[tauri::command]
async fn audio_offset(
    app: AppHandle,
    reference: i64,
    reference_start_ms: i64,
    other: i64,
    other_start_ms: i64,
) -> CommandResult<i64> {
    blocking(move || {
        analysis::audio_offset(
            &app.state::<AppState>().store,
            reference,
            reference_start_ms,
            other,
            other_start_ms,
        )
    })
    .await
}

#[tauri::command]
async fn track_motion(
    app: AppHandle,
    asset_id: i64,
    start_ms: i64,
    end_ms: i64,
    region: analysis::Region,
) -> CommandResult<Vec<analysis::TrackPoint>> {
    blocking(move || {
        analysis::track(
            &app.state::<AppState>().store,
            asset_id,
            start_ms,
            end_ms,
            region,
        )
    })
    .await
}

/// Publishing, deleting and editing change something outside this machine, so the
/// approval is a native dialog that the WebView cannot answer for the user.
fn confirm(app: &AppHandle, title: &str, message: String, action: &str) -> Result<bool> {
    let window = app
        .get_webview_window("main")
        .ok_or(StudioError::Input("Không tìm thấy cửa sổ chính."))?;
    Ok(app
        .dialog()
        .message(message)
        .title(title)
        .kind(MessageDialogKind::Warning)
        .buttons(MessageDialogButtons::OkCancelCustom(
            action.into(),
            "Hủy".into(),
        ))
        .parent(&window)
        .blocking_show())
}

fn excerpt(text: &str, limit: usize) -> String {
    let mut short: String = text.chars().take(limit).collect();
    if text.chars().count() > limit {
        short.push('…');
    }
    short
}

#[tauri::command]
fn list_social_accounts(state: State<AppState>) -> CommandResult<Vec<SocialAccount>> {
    command(
        state
            .store
            .social_accounts()
            .map(|accounts| accounts.into_iter().map(Into::into).collect()),
    )
}

#[tauri::command]
async fn connect_social_account(
    app: AppHandle,
    input: ConnectInput,
) -> CommandResult<SocialAccount> {
    blocking(move || {
        let state = app.state::<AppState>();
        state.publisher.connect(&state.store, input)
    })
    .await
}

#[tauri::command]
async fn disconnect_social_account(app: AppHandle, account_id: i64) -> CommandResult<()> {
    blocking(move || {
        let state = app.state::<AppState>();
        state.publisher.disconnect(&state.store, account_id)
    })
    .await
}

#[tauri::command]
async fn refresh_social_token(app: AppHandle, account_id: i64) -> CommandResult<SocialAccount> {
    blocking(move || {
        let state = app.state::<AppState>();
        state.publisher.refresh(&state.store, account_id)
    })
    .await
}

#[tauri::command]
async fn publish_options(app: AppHandle, account_id: i64) -> CommandResult<PublishOptions> {
    blocking(move || {
        let state = app.state::<AppState>();
        state.publisher.options(&state.store, account_id)
    })
    .await
}

#[tauri::command]
fn list_publish_jobs(state: State<AppState>) -> CommandResult<Vec<PublishJob>> {
    command(state.store.publish_jobs())
}

#[tauri::command]
fn create_publish_draft(state: State<AppState>, draft: DraftInput) -> CommandResult<PublishJob> {
    command(state.store.create_publish_job(&draft))
}

#[tauri::command]
fn delete_publish_draft(state: State<AppState>, job_id: i64) -> CommandResult<()> {
    command(state.store.delete_publish_job(job_id))
}

/// Shows the exact target and content, and only a confirmed job is handed to a worker.
#[tauri::command]
async fn approve_publish(app: AppHandle, job_id: i64) -> CommandResult<PublishJob> {
    blocking(move || {
        let state = app.state::<AppState>();
        let job = state.store.publish_job(job_id)?;
        if !matches!(job.status.as_str(), "draft" | "failed") {
            return Err(StudioError::Input("Bài này đang được đăng hoặc đã đăng."));
        }
        let message = format!(
            "Tài khoản: {} · {}\nĐịnh dạng: {}\nMedia: {}\n\n{}",
            Platform::parse(&job.platform)?.label(),
            job.account_name,
            job.format,
            job.media_label.as_deref().unwrap_or("không có"),
            excerpt(&job.caption, 600)
        );
        if !confirm(&app, "Duyệt và đăng bài", message, "Đăng bài")?
            || !state.store.begin_publish(job_id)?
        {
            return state.store.publish_job(job_id);
        }
        let worker = app.clone();
        std::thread::spawn(move || {
            let state = worker.state::<AppState>();
            state.publisher.run_job(&state.store, job_id);
        });
        state.store.publish_job(job_id)
    })
    .await
}

#[tauri::command]
async fn list_remote_posts(app: AppHandle, account_id: i64) -> CommandResult<Vec<RemotePost>> {
    blocking(move || {
        let state = app.state::<AppState>();
        state.publisher.remote_posts(&state.store, account_id)
    })
    .await
}

/// Returns false when the user declines in the native dialog.
#[tauri::command]
async fn delete_remote_post(
    app: AppHandle,
    account_id: i64,
    remote_id: String,
) -> CommandResult<bool> {
    blocking(move || {
        let state = app.state::<AppState>();
        let account = state.store.social_account(account_id)?;
        let message = format!(
            "Xóa bài {remote_id} trên {} · {}?\nBài sẽ bị gỡ khỏi nền tảng và không khôi phục được từ ứng dụng.",
            account.platform.label(),
            account.name
        );
        if !confirm(&app, "Xóa bài đã đăng", message, "Xóa bài")? {
            return Ok(false);
        }
        state
            .publisher
            .delete_remote(&state.store, account_id, &remote_id)?;
        Ok(true)
    })
    .await
}

#[tauri::command]
async fn edit_remote_post(
    app: AppHandle,
    account_id: i64,
    remote_id: String,
    message: String,
) -> CommandResult<bool> {
    blocking(move || {
        let state = app.state::<AppState>();
        let account = state.store.social_account(account_id)?;
        let summary = format!(
            "Sửa nội dung bài {remote_id} trên {} · {} thành:\n\n{}",
            account.platform.label(),
            account.name,
            excerpt(&message, 600)
        );
        if !confirm(&app, "Sửa bài đã đăng", summary, "Lưu thay đổi")? {
            return Ok(false);
        }
        state
            .publisher
            .edit_remote(&state.store, account_id, &remote_id, &message)?;
        Ok(true)
    })
    .await
}

fn data_dir(app: &tauri::App) -> tauri::Result<PathBuf> {
    #[cfg(debug_assertions)]
    if let Some(path) = std::env::var_os("STUDIO_DEV_DATA_DIR") {
        let path = PathBuf::from(path);
        if path.is_absolute() {
            return Ok(path);
        }
    }
    app.path().app_data_dir()
}

fn main() {
    tauri::Builder::default()
        .plugin(tauri_plugin_single_instance::init(|app, _, _| {
            if let Some(window) = app.get_webview_window("main") {
                let _ = window.unminimize();
                let _ = window.set_focus();
            }
        }))
        .plugin(tauri_plugin_dialog::init())
        .on_window_event(native_drop)
        .setup(|app| {
            let data_dir = data_dir(app)?;
            std::fs::create_dir_all(&data_dir)?;
            app.manage(AppState {
                store: Store::open(&data_dir.join("studio.sqlite3"))?,
                data_dir,
                proxy_dir: app.path().app_cache_dir()?.join("proxies"),
                proxy_generation: Mutex::new(()),
                scan: Mutex::new(()),
                render: Mutex::new(None),
                review: Mutex::new(None),
                review_generation: Mutex::new(()),
                publisher: Publisher::new()?,
            });
            Ok(())
        })
        .register_asynchronous_uri_scheme_protocol("studio-media", |context, request, responder| {
            if context.webview_label() != "main" {
                responder.respond(preview::empty(StatusCode::FORBIDDEN));
                return;
            }
            let app = context.app_handle().clone();
            tauri::async_runtime::spawn_blocking(move || {
                let state = app.state::<AppState>();
                if request.uri().path().starts_with("/review-") {
                    let review = state.review.lock().ok();
                    responder.respond(preview::serve_with_review(
                        &state.store,
                        request,
                        review.as_deref().and_then(Option::as_ref),
                        None,
                    ));
                } else {
                    responder.respond(preview::serve_with_review(
                        &state.store,
                        request,
                        None,
                        Some(&state.proxy_dir),
                    ));
                }
            });
        })
        .invoke_handler(tauri::generate_handler![
            pick_folder,
            pick_media_files,
            scan_folder,
            media_tools,
            list_folders,
            revoke_folder,
            list_assets,
            list_studio_catalog,
            import_srt,
            export_srt,
            transcribe_clip,
            list_projects,
            create_project,
            load_timeline,
            save_timeline,
            save_project_file,
            export_premiere_xml,
            open_project_file,
            prepare_proxy,
            proxy_status,
            create_edited_project,
            start_render,
            retry_render,
            cancel_render,
            list_render_jobs,
            list_render_queue,
            run_render_queue,
            list_editor_templates,
            analyze_reference,
            audio_levels,
            analyze_shots,
            render_review,
            detect_scenes,
            track_motion,
            audio_offset,
            list_voices,
            speak_text,
            ai_key_status,
            set_ai_key,
            avatar_key_status,
            set_avatar_key,
            create_avatar_video,
            get_avatar_video,
            remove_media_background,
            translate_captions,
            import_lut,
            list_luts,
            delete_lut,
            list_social_accounts,
            connect_social_account,
            disconnect_social_account,
            refresh_social_token,
            publish_options,
            list_publish_jobs,
            create_publish_draft,
            delete_publish_draft,
            approve_publish,
            list_remote_posts,
            delete_remote_post,
            edit_remote_post
        ])
        .run(tauri::generate_context!())
        .expect("AI Video Studio could not start");
}
