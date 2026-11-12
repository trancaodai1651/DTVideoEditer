use std::{
    fs,
    path::{Path, PathBuf},
    time::{Duration, UNIX_EPOCH},
};

use crate::{
    library::{authorized_asset, authorized_file},
    model::{Result, StudioError},
    probe::{self, Ffprobe, MediaFormat, MediaProbe},
    store::Store,
};

struct Source {
    path: PathBuf,
    format: MediaFormat,
    duration: i64,
    key: String,
}

fn source(store: &Store, asset_id: i64) -> Result<Source> {
    let asset = store
        .source(asset_id, false)?
        .filter(|asset| asset.kind == "video")
        .ok_or(StudioError::Input(
            "Chọn video có trong thư viện để tạo proxy.",
        ))?;
    let (path, metadata) = authorized_asset(&asset)?;
    let format =
        MediaFormat::for_path(&path).ok_or(StudioError::Input("Không hỗ trợ định dạng nguồn."))?;
    let mtime = metadata
        .modified()?
        .duration_since(UNIX_EPOCH)
        .unwrap_or_default()
        .as_nanos();
    let duration = asset.duration_ms.unwrap_or_default();
    Ok(Source {
        path,
        format,
        duration,
        key: format!("p1-{asset_id}-{}-{mtime}.mp4", metadata.len()),
    })
}

pub fn ready(store: &Store, root: &Path, asset_id: i64) -> Option<PathBuf> {
    let source = source(store, asset_id).ok()?;
    let root = dunce::canonicalize(root).ok()?;
    authorized_file(&root, Path::new(&source.key))
        .ok()
        .map(|(path, _)| path)
}

pub fn build(store: &Store, root: &Path, asset_id: i64) -> Result<()> {
    let original = source(store, asset_id)?;
    if ready(store, root, asset_id).is_some() {
        return Ok(());
    }
    if original.duration < 100 {
        return Err(StudioError::Input("Không đọc được thời lượng video nguồn."));
    }
    let binary = probe::find_tool("ffmpeg")
        .ok_or(StudioError::Input("Cần FFmpeg trong PATH để tạo proxy."))?;
    let ffprobe = probe::find_tool("ffprobe")
        .ok_or(StudioError::Input("Cần FFprobe trong PATH để tạo proxy."))?;
    if probe::has_alpha(&ffprobe, &original.path, &original.format) {
        return Err(StudioError::Input(
            "Video trong suốt sử dụng nguồn gốc để giữ kênh alpha.",
        ));
    }
    fs::create_dir_all(root)?;
    let root = dunce::canonicalize(root)?;
    let output = tempfile::Builder::new()
        .prefix("proxy-")
        .suffix(".mp4")
        .tempfile_in(&root)?
        .into_temp_path();
    let make = |decoder: Option<&str>| {
        let mut cmd = probe::command(&binary);
        cmd.args([
            "-v",
            "error",
            "-nostdin",
            "-y",
            "-threads",
            "4",
            "-filter_threads",
            "2",
        ]);
        if let Some(decoder) = decoder {
            cmd.args(["-hwaccel", decoder]);
        }
        cmd.args(original.format.input_args()).arg("-i").arg(&original.path)
            .args(["-map", "0:V:0", "-map", "0:a:0?", "-sn", "-dn", "-vf",
                "scale='min(1280,iw)':'min(720,ih)':force_original_aspect_ratio=decrease:force_divisible_by=2,setsar=1,fps=30",
                "-af", "aresample=async=1:first_pts=0", "-c:v", "libx264", "-pix_fmt", "yuv420p",
                "-preset", "veryfast", "-crf", "23", "-maxrate", "2600k", "-bufsize", "5200k",
                "-g", "30", "-bf", "0", "-threads", "4", "-c:a", "aac", "-ac", "2", "-b:a", "128k",
                "-movflags", "+faststart"]).arg(output.as_os_str());
        probe::capture_limited(cmd, Duration::from_secs(1800), 4096).is_some()
    };
    if !probe::hardware_decoder().is_some_and(|decoder| make(Some(decoder))) && !make(None) {
        return Err(StudioError::Input(
            "FFmpeg không tạo được proxy cho video này.",
        ));
    }
    let proxy_format = MediaFormat::for_path(&output).expect("proxy is MP4");
    let proxy = Ffprobe {
        binary: ffprobe,
        ffmpeg: None,
    }
    .inspect(&output, &proxy_format);
    if !proxy.is_some_and(|item| {
        item.duration_ms
            .is_some_and(|duration| (duration - original.duration).abs() < 250)
            && item.width.is_some_and(|width| width <= 1280)
            && item.height.is_some_and(|height| height <= 720)
    }) {
        return Err(StudioError::Input("Proxy không khớp độ dài video nguồn."));
    }
    let current = source(store, asset_id)?;
    if current.key != original.key || current.path != original.path {
        return Err(StudioError::Input("Nguồn đã thay đổi trong lúc tạo proxy."));
    }
    output
        .persist_noclobber(root.join(original.key))
        .map_err(|error| error.error)?;
    Ok(())
}
