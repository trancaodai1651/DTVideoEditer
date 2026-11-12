use std::{
    io::{Read, Seek, SeekFrom},
    path::{Path, PathBuf},
    time::Duration,
};

use reqwest::{
    Url,
    blocking::{Client, RequestBuilder},
    redirect::Policy,
};
use serde::Serialize;
use serde_json::{Value, json};

use crate::{
    library::{authorized_asset, authorized_file},
    model::{Result, StudioError},
    probe,
    publish::secrets::{self, Secret, SecretStore},
    store::Store,
};

const KEY: &str = "ai-heygen";
const API: &str = "https://api.heygen.com/v3/videos";
const MAX_AVATAR_BYTES: u64 = 120 * 1024 * 1024;

fn request_error() -> StudioError {
    StudioError::Input("Không kết nối được với HeyGen.")
}

fn avatar_client() -> Result<Client> {
    Client::builder()
        .redirect(Policy::none())
        .timeout(Duration::from_secs(90))
        .build()
        .map_err(|_| request_error())
}

pub fn has_avatar_key(store: &dyn SecretStore) -> bool {
    secrets::load(store, KEY).is_ok()
}

pub fn set_avatar_key(store: &dyn SecretStore, key: &str) -> Result<()> {
    let key = key.trim();
    if !(12..=512).contains(&key.len()) || !key.bytes().all(|c| c.is_ascii_graphic()) {
        return Err(StudioError::Input("API key HeyGen không hợp lệ."));
    }
    secrets::save(
        store,
        KEY,
        &Secret {
            access_token: key.into(),
            ..Secret::default()
        },
    )
}

fn valid_id(value: &str) -> bool {
    !value.is_empty()
        && value.len() <= 128
        && value
            .bytes()
            .all(|c| c.is_ascii_alphanumeric() || c == b'_' || c == b'-')
}

fn avatar_payload(avatar: &str, voice: &str, script: &str) -> Result<Value> {
    let script = script.trim();
    if !valid_id(avatar) || !valid_id(voice) || !(1..=2000).contains(&script.chars().count()) {
        return Err(StudioError::Input(
            "Nhập Avatar Look ID, Voice ID và lời thoại từ 1 đến 2.000 ký tự.",
        ));
    }
    Ok(
        json!({"type":"avatar", "avatar_id":avatar, "voice_id":voice, "script":script, "aspect_ratio":"16:9", "resolution":"720p"}),
    )
}

fn response(request: RequestBuilder) -> Result<Value> {
    let response = request.send().map_err(|_| request_error())?;
    let status = response.status();
    if !status.is_success() {
        return Err(StudioError::Message(format!(
            "HeyGen trả HTTP {}. Kiểm tra key, quyền hoặc hạn mức.",
            status.as_u16()
        )));
    }
    serde_json::from_reader(response.take(256 * 1024))
        .map_err(|_| StudioError::Input("Không đọc được phản hồi HeyGen."))
}

pub fn create_avatar(
    secrets: &dyn SecretStore,
    avatar: &str,
    voice: &str,
    script: &str,
) -> Result<String> {
    let key = secrets::load(secrets, KEY)?.access_token;
    let payload = avatar_payload(avatar.trim(), voice.trim(), script)?;
    let body = response(
        avatar_client()?
            .post(API)
            .header("x-api-key", key)
            .json(&payload),
    )?;
    body["data"]["video_id"]
        .as_str()
        .filter(|id| valid_id(id))
        .map(str::to_owned)
        .ok_or(StudioError::Input("HeyGen không trả mã video hợp lệ."))
}

fn output_url(value: &str) -> Option<Url> {
    let url = Url::parse(value).ok()?;
    let host = url.host_str()?;
    (url.scheme() == "https"
        && url.username().is_empty()
        && url.password().is_none()
        && url.port().is_none()
        && (host == "heygen.ai"
            || host.ends_with(".heygen.ai")
            || host == "heygen.com"
            || host.ends_with(".heygen.com")))
    .then_some(url)
}

#[derive(Serialize)]
#[serde(rename_all = "camelCase")]
pub struct AvatarResult<T> {
    pub status: &'static str,
    pub media: Option<T>,
}

pub fn get_avatar(
    secrets: &dyn SecretStore,
    folder: &Path,
    id: &str,
) -> Result<AvatarResult<PathBuf>> {
    if !valid_id(id) {
        return Err(StudioError::Input("Mã video HeyGen không hợp lệ."));
    }
    let key = secrets::load(secrets, KEY)?.access_token;
    let client = avatar_client()?;
    let body = response(client.get(format!("{API}/{id}")).header("x-api-key", key))?;
    match body["data"]["status"].as_str() {
        Some("waiting" | "pending" | "processing" | "running") => {
            return Ok(AvatarResult {
                status: "pending",
                media: None,
            });
        }
        Some("failed" | "canceled" | "cancelled") => {
            return Ok(AvatarResult {
                status: "failed",
                media: None,
            });
        }
        Some("completed") => (),
        _ => {
            return Err(StudioError::Input(
                "HeyGen không trả trạng thái video hợp lệ.",
            ));
        }
    }
    let url = body["data"]["video_url"]
        .as_str()
        .and_then(output_url)
        .ok_or(StudioError::Input("Địa chỉ tải video HeyGen không hợp lệ."))?;
    std::fs::create_dir_all(folder)?;
    let folder = dunce::canonicalize(folder)?;
    let name = format!("avatar-{id}.mp4");
    if let Ok((file, _)) = authorized_file(&folder, Path::new(&name)) {
        return Ok(AvatarResult {
            status: "done",
            media: Some(file),
        });
    }
    let response = client.get(url).send().map_err(|_| request_error())?;
    if !response.status().is_success()
        || response
            .content_length()
            .is_some_and(|bytes| bytes > MAX_AVATAR_BYTES)
    {
        return Err(StudioError::Input(
            "Không tải được video HeyGen hoặc video vượt 120 MB.",
        ));
    }
    let mut file = tempfile::NamedTempFile::new_in(&folder)?;
    let bytes = std::io::copy(&mut response.take(MAX_AVATAR_BYTES + 1), file.as_file_mut())?;
    let mut header = [0; 12];
    file.seek(SeekFrom::Start(0))?;
    if bytes > MAX_AVATAR_BYTES || file.read_exact(&mut header).is_err() || &header[4..8] != b"ftyp"
    {
        return Err(StudioError::Input(
            "HeyGen không trả tệp MP4 hợp lệ trong giới hạn 120 MB.",
        ));
    }
    let path = folder.join(name);
    file.persist_noclobber(&path).map_err(|error| error.error)?;
    Ok(AvatarResult {
        status: "done",
        media: Some(path),
    })
}

pub fn remove_background(
    store: &Store,
    folder: &Path,
    asset_id: i64,
    start_ms: i64,
    end_ms: i64,
    runtime: Option<(&Path, &Path)>,
) -> Result<PathBuf> {
    let asset = store
        .source(asset_id, false)?
        .filter(|asset| matches!(asset.kind.as_str(), "image" | "video"))
        .ok_or(StudioError::Input(
            "Chọn ảnh hoặc video đã nhập để xóa nền.",
        ))?;
    let (source, metadata) = authorized_asset(&asset)?;
    let video = asset.kind == "video";
    let pixels = u64::from(asset.width.unwrap_or(0)) * u64::from(asset.height.unwrap_or(0));
    if !video && (metadata.len() > 32 * 1024 * 1024 || pixels > 30_000_000) {
        return Err(StudioError::Input(
            "Ảnh phải dưới 32 MB và tối đa 30 megapixel.",
        ));
    }
    if video
        && (start_ms < 0
            || end_ms > asset.duration_ms.unwrap_or(0)
            || !(500..=8_000).contains(&end_ms.saturating_sub(start_ms)))
    {
        return Err(StudioError::Input(
            "Trim video thành đoạn từ 0,5 đến 8 giây để xóa nền trên máy.",
        ));
    }
    let engine = Segmenter::open(runtime)?;
    std::fs::create_dir_all(folder)?;
    let folder = dunce::canonicalize(folder)?;
    let output = tempfile::Builder::new()
        .prefix("tach-nen-")
        .suffix(if video { ".mov" } else { ".png" })
        .tempfile_in(folder)?
        .into_temp_path();
    if video {
        segment_video(&engine, &source, &output, start_ms, end_ms)?;
    } else {
        let cmd = engine.command("i", &source, &output);
        probe::capture_limited(cmd, Duration::from_secs(180), 4096).ok_or(StudioError::Input(
            "rembg không tạo được ảnh. Kiểm tra mô hình U²-Net và cấu hình CLI.",
        ))?;
    }
    let current = store
        .source(asset_id, false)?
        .ok_or(StudioError::Input("Ảnh đã bị thu hồi."))?;
    let (checked, current_metadata) = authorized_asset(&current)?;
    if checked != source
        || metadata.len() != current_metadata.len()
        || metadata.modified().ok() != current_metadata.modified().ok()
    {
        return Err(StudioError::Input("Nguồn ảnh đã thay đổi."));
    }
    let mut header = [0; 8];
    std::fs::File::open(&output)?.read_exact(&mut header)?;
    if (video && &header[4..8] != b"ftyp") || (!video && &header != b"\x89PNG\r\n\x1a\n") {
        return Err(StudioError::Input("Tệp tách nền không hợp lệ."));
    }
    output.keep().map_err(|error| error.error.into())
}

enum Segmenter {
    Bundled {
        python: PathBuf,
        driver: PathBuf,
        cache: PathBuf,
    },
    Cli(PathBuf),
}

impl Segmenter {
    fn open(runtime: Option<(&Path, &Path)>) -> Result<Self> {
        if let Some((resources, data)) = runtime {
            let system = if cfg!(windows) { "windows" } else { "macos" };
            let target = format!("{system}-{}", std::env::consts::ARCH);
            let archive = resources.join("rembg").join(format!("{target}.tar.gz"));
            if archive.is_file() {
                let root = data.join(format!("rembg-2.0.87-v2-{target}"));
                let python_path = if cfg!(windows) {
                    "python/python.exe"
                } else {
                    "python/bin/python3.12"
                };
                if !root.join(python_path).is_file() || !root.join("driver.py").is_file() {
                    std::fs::create_dir_all(data)?;
                    let stage = tempfile::Builder::new()
                        .prefix("rembg-install-")
                        .tempdir_in(data)?;
                    let tar = if cfg!(windows) {
                        PathBuf::from(
                            std::env::var_os("SystemRoot").unwrap_or_else(|| "C:\\Windows".into()),
                        )
                        .join("System32/tar.exe")
                    } else {
                        PathBuf::from("/usr/bin/tar")
                    };
                    let mut extract = probe::command(tar);
                    extract.arg("-xzf").arg(archive).arg("-C").arg(stage.path());
                    if probe::capture_limited(extract, Duration::from_secs(180), 4096).is_none()
                        || !stage.path().join(python_path).is_file()
                        || !stage.path().join("driver.py").is_file()
                        || !stage.path().join("models/u2netp/u2netp.onnx").is_file()
                    {
                        return Err(StudioError::Input(
                            "Không giải nén được mô hình xóa nền đi kèm bản cài.",
                        ));
                    }
                    std::fs::rename(stage.path(), &root)?;
                }
                return Ok(Self::Bundled {
                    python: root.join(python_path),
                    driver: root.join("driver.py"),
                    cache: root.join("cache"),
                });
            }
        }
        probe::find_tool("rembg")
            .map(Self::Cli)
            .ok_or(StudioError::Input(
                "Cài bản đóng gói có rembg hoặc thêm rembg[cpu,cli] vào PATH cho bản phát triển.",
            ))
    }

    fn command(&self, mode: &str, source: &Path, output: &Path) -> std::process::Command {
        let mut command = match self {
            Self::Bundled {
                python,
                driver,
                cache,
            } => {
                let mut command = probe::command(python);
                command
                    .args(["-I", "-B"])
                    .arg(driver)
                    .arg(mode)
                    .env("NUMBA_CACHE_DIR", cache);
                command
            }
            Self::Cli(binary) => {
                let mut command = probe::command(binary);
                command.args([mode, "-m", "u2netp"]);
                command
            }
        };
        command.arg(source).arg(output).env("OMP_NUM_THREADS", "2");
        command
    }
}

fn segment_video(
    engine: &Segmenter,
    source: &Path,
    output: &Path,
    start_ms: i64,
    end_ms: i64,
) -> Result<()> {
    let ffmpeg = probe::find_tool("ffmpeg").ok_or(StudioError::Input("Cần FFmpeg trong PATH."))?;
    let format = probe::MediaFormat::for_path(source)
        .ok_or(StudioError::Input("Định dạng nguồn không được hỗ trợ."))?;
    let work = tempfile::tempdir()?;
    let frames = work.path().join("frames");
    let masks = work.path().join("masks");
    std::fs::create_dir(&frames)?;
    std::fs::create_dir(&masks)?;
    let start = format!("{}.{:03}", start_ms / 1000, start_ms % 1000);
    let length = end_ms - start_ms;
    let duration = format!("{}.{:03}", length / 1000, length % 1000);
    let mut extract = probe::command(&ffmpeg);
    extract.args(["-v", "error", "-nostdin"]).args(format.input_args())
        .args(["-ss", &start, "-t", &duration, "-i"]).arg(source)
        .args(["-map", "0:V:0", "-vf", "fps=12,scale='min(640,iw)':'min(640,ih)':force_original_aspect_ratio=decrease:force_divisible_by=2", "-threads", "1"])
        .arg(frames.join("%05d.png"));
    probe::capture_limited(extract, Duration::from_secs(45), 4096).ok_or(StudioError::Input(
        "FFmpeg chưa đọc được khung hình để xóa nền.",
    ))?;
    let rembg = engine.command("p", &frames, &masks);
    probe::capture_limited(rembg, Duration::from_secs(240), 64 * 1024).ok_or(
        StudioError::Input("rembg không tạo được các khung trong suốt."),
    )?;
    let mut encode = probe::command(ffmpeg);
    encode
        .args(["-v", "error", "-nostdin", "-y", "-framerate", "12", "-i"])
        .arg(masks.join("%05d.png"))
        .args(format.input_args())
        .args(["-ss", &start, "-t", &duration, "-i"])
        .arg(source)
        .args([
            "-map",
            "0:v:0",
            "-map",
            "1:a:0?",
            "-t",
            &duration,
            "-c:v",
            "prores_ks",
            "-profile:v",
            "4",
            "-pix_fmt",
            "yuva444p10le",
            "-threads",
            "2",
            "-c:a",
            "aac",
            "-movflags",
            "+faststart",
        ])
        .arg(output);
    probe::capture_limited(encode, Duration::from_secs(75), 4096).ok_or(StudioError::Input(
        "FFmpeg không ghi được video trong suốt.",
    ))?;
    Ok(())
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn validates_avatar_parameters_and_download_origin() {
        let payload = avatar_payload("public-look", "voice_1", " Xin chào ").unwrap();
        assert_eq!(payload["script"], "Xin chào");
        assert!(avatar_payload("../../id", "voice", "x").is_err());
        assert!(output_url("https://files.heygen.ai/video/id.mp4?token=x").is_some());
        assert!(output_url("https://heygen.ai.example.com/id.mp4").is_none());
        assert!(output_url("https://files.heygen.ai:444/id.mp4").is_none());
    }
}
