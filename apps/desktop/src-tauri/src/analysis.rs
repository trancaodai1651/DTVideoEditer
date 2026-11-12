//! Local media analysis behind the editor's smart tools: loudness levels for
//! the meter, beat markers and silence removal, scene cuts and motion tracking.
//! Everything runs through FFmpeg on files inside a grant. Nothing leaves the machine.

use std::time::Duration;

use serde::{Deserialize, Serialize};

use crate::{
    library::authorized_asset,
    model::{Result, StudioError},
    probe::{self, MediaFormat},
    store::{AssetSource, DerivedPreview, Store},
};

/// One level value covers this many milliseconds.
pub const LEVEL_STEP_MS: i64 = 50;
const LEVEL_RATE: usize = 4000;
const MAX_LEVEL_MS: i64 = 60 * 60 * 1000;
const MAX_SCENE_MS: i64 = 30 * 60 * 1000;
const MAX_TRACK_MS: i64 = 60 * 1000;
const TRACK_FPS: i64 = 10;
const TRACK_WIDTH: usize = 160;
const SEARCH: i32 = 14;

fn source(
    store: &Store,
    asset_id: i64,
    kinds: &[&str],
) -> Result<(AssetSource, std::path::PathBuf, MediaFormat)> {
    let asset = store
        .source(asset_id, false)?
        .filter(|asset| kinds.contains(&asset.kind.as_str()))
        .ok_or(StudioError::Input(
            "Media không còn trong thư viện hoặc không đúng loại.",
        ))?;
    let (path, _) = authorized_asset(&asset)?;
    let format = MediaFormat::for_path(&path)
        .ok_or(StudioError::Input("Định dạng media chưa được hỗ trợ."))?;
    Ok((asset, path, format))
}

fn ffmpeg() -> Result<std::process::Command> {
    let binary = probe::find_tool("ffmpeg").ok_or(StudioError::Input("Cần FFmpeg trong PATH."))?;
    let mut command = probe::command(binary);
    command.args([
        "-hide_banner",
        "-loglevel",
        "error",
        "-nostdin",
        "-threads",
        "1",
    ]);
    Ok(command)
}

fn seconds(ms: i64) -> String {
    format!("{}.{:03}", ms / 1000, ms % 1000)
}

/// RMS loudness per 50 ms as bytes: 0 is -60 dBFS or quieter, 255 is full scale.
pub fn level_bytes(samples: &[u8]) -> Vec<u8> {
    let window = LEVEL_RATE * LEVEL_STEP_MS as usize / 1000;
    samples
        .chunks_exact(2)
        .map(|pair| f64::from(i16::from_le_bytes([pair[0], pair[1]])) / 32768.0)
        .collect::<Vec<_>>()
        .chunks(window)
        .map(|chunk| {
            let power =
                chunk.iter().map(|sample| sample * sample).sum::<f64>() / chunk.len() as f64;
            let db = 10.0 * power.max(1e-12).log10();
            ((db + 60.0) / 60.0 * 255.0).round().clamp(0.0, 255.0) as u8
        })
        .collect()
}

/// Cached loudness of an audio or video asset, computed on first use.
pub fn levels(store: &Store, asset_id: i64) -> Result<Vec<u8>> {
    if let Some(bytes) = store.derived_preview(asset_id, DerivedPreview::Levels)? {
        return Ok(bytes);
    }
    let (asset, path, format) = source(store, asset_id, &["audio", "video"])?;
    let duration = asset
        .duration_ms
        .filter(|ms| (1..=MAX_LEVEL_MS).contains(ms))
        .ok_or(StudioError::Input(
            "Chỉ đo âm lượng media dài tối đa 60 phút.",
        ))?;
    let mut command = ffmpeg()?;
    command
        .args(format.input_args())
        .arg("-i")
        .arg(&path)
        .args([
            "-map", "0:a:0", "-vn", "-ac", "1", "-ar", "4000", "-f", "s16le", "pipe:1",
        ]);
    let limit = (duration as usize / 1000 + 2) * LEVEL_RATE * 2;
    let samples = probe::capture_limited(command, Duration::from_secs(180), limit).ok_or(
        StudioError::Input("FFmpeg chưa đọc được âm thanh của media này."),
    )?;
    let bytes = level_bytes(&samples);
    if bytes.is_empty() {
        return Err(StudioError::Input("Media này không có tiếng."));
    }
    store.cache_derived_preview(asset_id, DerivedPreview::Levels, &bytes)?;
    Ok(bytes)
}

/// Source times of hard cuts inside `start_ms..end_ms` of a video.
pub fn scene_cuts(
    store: &Store,
    asset_id: i64,
    start_ms: i64,
    end_ms: i64,
    threshold: u8,
) -> Result<Vec<i64>> {
    let (asset, path, format) = source(store, asset_id, &["video"])?;
    let duration = asset.duration_ms.unwrap_or(0);
    if start_ms < 0
        || end_ms > duration
        || end_ms - start_ms < 200
        || end_ms - start_ms > MAX_SCENE_MS
    {
        return Err(StudioError::Input(
            "Đoạn cần dò cảnh phải dài từ 0,2 giây đến 30 phút.",
        ));
    }
    let score = f64::from(threshold.clamp(10, 90)) / 100.0;
    let mut command = ffmpeg()?;
    command
        .args(format.input_args())
        .args(["-ss", &seconds(start_ms), "-t", &seconds(end_ms - start_ms), "-i"])
        .arg(&path)
        .args(["-map", "0:V:0", "-an", "-sn", "-dn", "-vf"])
        .arg(format!(
            "scale=320:180:force_original_aspect_ratio=decrease,select='gt(scene,{score:.2})',metadata=mode=print:key=lavfi.scene_score:file=-"
        ))
        .args(["-fps_mode", "passthrough", "-f", "null", "-"]);
    let output = probe::capture_limited(command, Duration::from_secs(300), 4 * 1024 * 1024).ok_or(
        StudioError::Input("FFmpeg chưa dò được cảnh trong thời gian cho phép."),
    )?;
    Ok(cut_times(
        &String::from_utf8_lossy(&output),
        start_ms,
        end_ms,
    ))
}

fn cut_times(output: &str, start_ms: i64, end_ms: i64) -> Vec<i64> {
    let mut cuts: Vec<i64> = Vec::new();
    for at in output.lines().filter_map(|line| {
        line.split_whitespace()
            .find_map(|item| item.strip_prefix("pts_time:"))?
            .parse::<f64>()
            .ok()
            .filter(|seconds| seconds.is_finite())
    }) {
        let ms = start_ms + (at * 1000.0).round() as i64;
        // Keep pieces at least 300 ms long so every split is a usable clip.
        if ms >= start_ms + 300
            && ms <= end_ms - 300
            && cuts.last().is_none_or(|last| ms - last >= 300)
        {
            cuts.push(ms);
        }
    }
    cuts
}

/// The area to follow, in thousandths of the frame.
#[derive(Clone, Copy, Debug, Deserialize)]
#[serde(rename_all = "camelCase", deny_unknown_fields)]
pub struct Region {
    pub x: u16,
    pub y: u16,
    pub width: u16,
    pub height: u16,
}

/// Where the tracked area's centre is at a source time, in thousandths of the frame.
#[derive(Clone, Copy, Debug, PartialEq, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct TrackPoint {
    pub at_ms: i64,
    pub x: u16,
    pub y: u16,
}

fn sad(
    frame: &[u8],
    width: usize,
    left: usize,
    top: usize,
    patch: &[u8],
    pw: usize,
    ph: usize,
) -> u64 {
    let mut total = 0u64;
    for row in 0..ph {
        let line = &frame[(top + row) * width + left..][..pw];
        let model = &patch[row * pw..][..pw];
        total += line
            .iter()
            .zip(model)
            .map(|(a, b)| u64::from(a.abs_diff(*b)))
            .sum::<u64>();
    }
    total
}

fn crop(frame: &[u8], width: usize, left: usize, top: usize, pw: usize, ph: usize) -> Vec<u8> {
    (0..ph)
        .flat_map(|row| frame[(top + row) * width + left..][..pw].iter().copied())
        .collect()
}

/// Block matching over grayscale frames. The patch is compared with both the
/// first appearance and the last match, which limits drift without losing an
/// object that slowly changes.
pub fn track_frames(
    frames: &[Vec<u8>],
    width: usize,
    height: usize,
    region: Region,
) -> Vec<(u16, u16)> {
    let Some(first) = frames.first() else {
        return Vec::new();
    };
    let pw = (usize::from(region.width) * width / 1000).clamp(6, width);
    let ph = (usize::from(region.height) * height / 1000).clamp(6, height);
    let mut left = (usize::from(region.x) * width / 1000).min(width - pw);
    let mut top = (usize::from(region.y) * height / 1000).min(height - ph);
    let original = crop(first, width, left, top, pw, ph);
    let mut recent = original.clone();
    let centre = |left: usize, top: usize| {
        (
            ((left * 2 + pw) * 500 / width).min(1000) as u16,
            ((top * 2 + ph) * 500 / height).min(1000) as u16,
        )
    };
    let mut points = vec![centre(left, top)];
    for frame in &frames[1..] {
        let mut best = (u64::MAX, left, top);
        for dy in -SEARCH..=SEARCH {
            for dx in -SEARCH..=SEARCH {
                let (x, y) = (left as i32 + dx, top as i32 + dy);
                if x < 0 || y < 0 || x as usize + pw > width || y as usize + ph > height {
                    continue;
                }
                let (x, y) = (x as usize, y as usize);
                let score = sad(frame, width, x, y, &original, pw, ph)
                    + sad(frame, width, x, y, &recent, pw, ph);
                // Prefer staying put when scores tie, so a flat area does not wander.
                let moved = (dx.unsigned_abs() + dy.unsigned_abs()) as u64;
                if score + moved < best.0 {
                    best = (score + moved, x, y);
                }
            }
        }
        (left, top) = (best.1, best.2);
        recent = crop(frame, width, left, top, pw, ph);
        points.push(centre(left, top));
    }
    points
}

/// Follows a region of a video from `start_ms` for up to a minute of source time.
pub fn track(
    store: &Store,
    asset_id: i64,
    start_ms: i64,
    end_ms: i64,
    region: Region,
) -> Result<Vec<TrackPoint>> {
    let (asset, path, format) = source(store, asset_id, &["video"])?;
    let (Some(source_width), Some(source_height), Some(duration)) =
        (asset.width, asset.height, asset.duration_ms)
    else {
        return Err(StudioError::Input(
            "Video thiếu kích thước hoặc thời lượng.",
        ));
    };
    if region.x >= 1000
        || region.y >= 1000
        || region.width == 0
        || region.height == 0
        || region.x + region.width > 1000
        || region.y + region.height > 1000
    {
        return Err(StudioError::Input("Vùng theo dõi nằm ngoài khung hình."));
    }
    let end_ms = end_ms.min(duration).min(start_ms + MAX_TRACK_MS);
    if start_ms < 0 || end_ms - start_ms < 200 {
        return Err(StudioError::Input(
            "Đoạn theo dõi cần dài ít nhất 0,2 giây.",
        ));
    }
    let width = TRACK_WIDTH;
    let height = ((TRACK_WIDTH as u64 * u64::from(source_height) / u64::from(source_width.max(1)))
        as usize
        & !1)
        .clamp(16, 320);
    let mut command = ffmpeg()?;
    command
        .args(format.input_args())
        .args([
            "-ss",
            &seconds(start_ms),
            "-t",
            &seconds(end_ms - start_ms),
            "-i",
        ])
        .arg(&path)
        .args(["-map", "0:V:0", "-an", "-sn", "-dn", "-vf"])
        .arg(format!(
            "fps={TRACK_FPS},scale={width}:{height},format=gray"
        ))
        .args(["-f", "rawvideo", "pipe:1"]);
    let frames_expected = ((end_ms - start_ms) * TRACK_FPS / 1000 + 2) as usize;
    let bytes = probe::capture_limited(
        command,
        Duration::from_secs(180),
        frames_expected * width * height,
    )
    .ok_or(StudioError::Input(
        "FFmpeg chưa giải mã được đoạn video để theo dõi.",
    ))?;
    let frames: Vec<Vec<u8>> = bytes
        .chunks_exact(width * height)
        .map(<[u8]>::to_vec)
        .collect();
    if frames.len() < 2 {
        return Err(StudioError::Input("Đoạn video quá ngắn để theo dõi."));
    }
    Ok(track_frames(&frames, width, height, region)
        .into_iter()
        .enumerate()
        .map(|(index, (x, y))| TrackPoint {
            at_ms: start_ms + index as i64 * 1000 / TRACK_FPS,
            x,
            y,
        })
        .collect())
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn levels_map_rms_to_bytes() {
        let silence = vec![0u8; 400];
        assert_eq!(level_bytes(&silence), [0]);
        let full: Vec<u8> = (0..200)
            .flat_map(|i| if i % 2 == 0 { i16::MAX } else { i16::MIN + 1 }.to_le_bytes())
            .collect();
        assert!(level_bytes(&full)[0] >= 254);
        // -20 dBFS square wave lands two thirds of the way up.
        let quiet: Vec<u8> = (0..200)
            .flat_map(|i| if i % 2 == 0 { 3277i16 } else { -3277 }.to_le_bytes())
            .collect();
        assert_eq!(level_bytes(&quiet)[0], 170);
    }

    #[test]
    fn scene_cuts_keep_usable_pieces() {
        let output = "frame:0 pts_time:0.1\nframe:1 pts_time:1.5\nframe:2 pts_time:1.6\nframe:3 pts_time:3.9\nframe:4 pts_time:NaN";
        assert_eq!(cut_times(output, 1000, 5000), [2500]);
        assert_eq!(cut_times(output, 0, 10_000), [1500, 3900]);
        assert!(cut_times("", 0, 1000).is_empty());
    }

    #[test]
    fn tracker_follows_a_moving_square_over_noise() {
        let (width, height) = (160, 90);
        let frames: Vec<Vec<u8>> = (0..20)
            .map(|index| {
                let mut frame: Vec<u8> = (0..width * height)
                    .map(|pixel| ((pixel * 37 + index * 11) % 23) as u8 + 40)
                    .collect();
                let (left, top) = (20 + index * 5, 30 + index);
                for y in top..top + 12 {
                    for x in left..left + 12 {
                        frame[y * width + x] = if (x + y) % 3 == 0 { 250 } else { 200 };
                    }
                }
                frame
            })
            .collect();
        let region = Region {
            x: 125,
            y: 334,
            width: 75,
            height: 134,
        };
        let points = track_frames(&frames, width, height, region);
        assert_eq!(points.len(), 20);
        for (index, (x, y)) in points.iter().enumerate() {
            let expected_x = ((20 + index * 5) * 2 + 12) * 500 / width;
            let expected_y = ((30 + index) * 2 + 12) * 500 / height;
            assert!(
                (i64::from(*x) - expected_x as i64).abs() <= 8,
                "frame {index} x {x} vs {expected_x}"
            );
            assert!(
                (i64::from(*y) - expected_y as i64).abs() <= 12,
                "frame {index} y {y} vs {expected_y}"
            );
        }
    }
}
