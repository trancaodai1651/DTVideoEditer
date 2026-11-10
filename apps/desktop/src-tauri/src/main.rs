#![cfg_attr(not(debug_assertions), windows_subsystem = "windows")]

mod library;
mod model;
mod preview;
mod probe;
mod publish;
mod render;
mod store;
mod templates;
mod timeline;

#[cfg(test)]
mod smoke;

use std::{
    path::PathBuf,
    sync::{
        Arc, Mutex,
        atomic::{AtomicBool, Ordering},
    },
};

use tauri::{AppHandle, Manager, State, http::StatusCode};
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
    scan: Mutex<()>,
    render: Mutex<Option<ActiveRender>>,
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
) -> CommandResult<AssetPage> {
    command(state.store.assets(folder_id, page))
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
) -> CommandResult<Option<RenderJob>> {
    blocking(move || {
        let state = app.state::<AppState>();
        let project = state
            .store
            .projects()?
            .into_iter()
            .find(|project| project.id == project_id)
            .ok_or(StudioError::Input("Không tìm thấy dự án."))?;
        let snapshot = state.store.snapshot(project_id)?;
        if snapshot.duration_ms() == 0 {
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
        .setup(|app| {
            let data_dir = data_dir(app)?;
            std::fs::create_dir_all(&data_dir)?;
            app.manage(AppState {
                store: Store::open(&data_dir.join("studio.sqlite3"))?,
                scan: Mutex::new(()),
                render: Mutex::new(None),
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
                responder.respond(preview::serve(&state.store, request));
            });
        })
        .invoke_handler(tauri::generate_handler![
            pick_folder,
            scan_folder,
            media_tools,
            list_folders,
            revoke_folder,
            list_assets,
            list_projects,
            create_project,
            load_timeline,
            save_timeline,
            create_edited_project,
            start_render,
            retry_render,
            cancel_render,
            list_render_jobs,
            list_render_queue,
            run_render_queue,
            list_editor_templates,
            analyze_reference,
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
