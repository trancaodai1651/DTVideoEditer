use std::{
    fs,
    io::{Read, Write},
    path::{Path, PathBuf},
    process::Command,
    time::Duration,
};

use serde::{Deserialize, Serialize};
use sha2::{Digest, Sha256};

use crate::{
    library::authorized_asset,
    model::{Result, StudioError},
    probe::{self, MediaFormat},
    store::Store,
    timeline::{MAX_TIMELINE_MS, MAX_TITLES, MIN_CLIP_MS},
};

const MAX_SRT_BYTES: usize = 6 * 1024 * 1024;
const CHUNK_MS: i64 = 5 * 60 * 1000;

#[derive(Clone, Debug, Deserialize, PartialEq, Eq, Serialize)]
#[serde(rename_all = "camelCase", deny_unknown_fields)]
pub struct Cue {
    pub start_ms: i64,
    pub end_ms: i64,
    pub text: String,
}

#[derive(Deserialize)]
#[serde(rename_all = "camelCase", deny_unknown_fields)]
pub struct SpeechClip {
    asset_id: i64,
    start_ms: i64,
    end_ms: i64,
    speed: u16,
}

fn valid(cue: &Cue) -> bool {
    cue.start_ms >= 0
        && cue.end_ms <= MAX_TIMELINE_MS
        && cue.end_ms.saturating_sub(cue.start_ms) >= MIN_CLIP_MS
        && !cue.text.trim().is_empty()
        && cue.text.chars().count() <= 600
        && !cue
            .text
            .chars()
            .any(|character| character.is_control() && character != '\n')
}

fn timestamp(input: &str) -> Option<i64> {
    let mut fields = input.split(':');
    let hours: i64 = fields.next()?.parse().ok()?;
    let minutes: i64 = fields.next()?.parse().ok()?;
    let (seconds, milliseconds) = fields.next()?.split_once([',', '.'])?;
    let seconds: i64 = seconds.parse().ok()?;
    let millis: i64 = milliseconds.parse().ok()?;
    if fields.next().is_some()
        || !(0..=6).contains(&hours)
        || !(0..60).contains(&minutes)
        || !(0..60).contains(&seconds)
        || milliseconds.len() != 3
        || !(0..1000).contains(&millis)
    {
        return None;
    }
    Some(((hours * 60 + minutes) * 60 + seconds) * 1000 + millis)
}

pub fn read(path: &Path) -> Result<Vec<Cue>> {
    let mut data = Vec::new();
    fs::File::open(path)?
        .take((MAX_SRT_BYTES + 1) as u64)
        .read_to_end(&mut data)?;
    if data.len() > MAX_SRT_BYTES {
        return Err(StudioError::Input("Tệp SRT vượt quá 6 MB."));
    }
    let raw = std::str::from_utf8(&data)
        .map_err(|_| StudioError::Input("Hãy lưu tệp SRT ở mã UTF-8."))?;
    parse_cues(raw, false)
}

fn parse_cues(raw: &str, generated: bool) -> Result<Vec<Cue>> {
    let normalized = raw
        .trim_start_matches('\u{feff}')
        .replace("\r\n", "\n")
        .replace('\r', "\n");
    let mut cues = Vec::new();
    let lines: Vec<_> = normalized.lines().collect();
    for (index, block) in lines
        .split(|line| line.trim().is_empty())
        .filter(|block| !block.is_empty())
        .enumerate()
    {
        let invalid = || {
            StudioError::Message(format!(
                "Mốc SRT thứ {} có định dạng hoặc thời lượng không hợp lệ.",
                index + 1
            ))
        };
        let mut content = block.iter().copied();
        let first = content.next().ok_or_else(invalid)?;
        let timing = if first
            .trim()
            .bytes()
            .all(|character| character.is_ascii_digit())
        {
            content.next().ok_or_else(invalid)?
        } else {
            first
        };
        let (start, end) = timing.split_once("-->").ok_or_else(invalid)?;
        let start_ms = timestamp(start.trim()).ok_or_else(invalid)?;
        let end_ms =
            timestamp(end.split_whitespace().next().ok_or_else(invalid)?).ok_or_else(invalid)?;
        let text = content.collect::<Vec<_>>().join("\n").trim().to_owned();
        let cue = Cue {
            start_ms,
            end_ms,
            text,
        };
        if !valid(&cue) {
            if generated {
                continue;
            }
            return Err(invalid());
        }
        cues.push(cue);
        if cues.len() > MAX_TITLES {
            return Err(StudioError::Input("Tệp SRT vượt quá 1800 câu phụ đề."));
        }
    }
    cues.sort_by_key(|cue| cue.start_ms);
    Ok(cues)
}

fn format_timestamp(ms: i64) -> String {
    format!(
        "{:02}:{:02}:{:02},{:03}",
        ms / 3_600_000,
        ms / 60_000 % 60,
        ms / 1000 % 60,
        ms % 1000
    )
}

pub fn write(path: &Path, mut cues: Vec<Cue>) -> Result<()> {
    if cues.is_empty() || cues.len() > MAX_TITLES || cues.iter().any(|cue| !valid(cue)) {
        return Err(StudioError::Input("Danh sách phụ đề không hợp lệ."));
    }
    cues.sort_by_key(|cue| cue.start_ms);
    let folder = path
        .parent()
        .ok_or(StudioError::Input("Thư mục lưu SRT không hợp lệ."))?;
    let mut file = tempfile::NamedTempFile::new_in(folder)?;
    for (index, cue) in cues.iter().enumerate() {
        use std::io::Write;
        let text = cue
            .text
            .lines()
            .filter(|line| !line.trim().is_empty())
            .collect::<Vec<_>>()
            .join("\n");
        writeln!(
            file,
            "{}\n{} --> {}\n{}\n",
            index + 1,
            format_timestamp(cue.start_ms),
            format_timestamp(cue.end_ms),
            text
        )?;
    }
    file.persist_noclobber(path).map_err(|error| error.error)?;
    Ok(())
}

/// File name of the GGML model shipped in the installer's resources.
pub const BUNDLED_MODEL: &str = "ggml-small-q5_1.bin";
const MODEL_BYTES: u64 = 190_085_487;
const MODEL_SHA256: &str = "ae85e4a935d7a567bd102fe55afc16bb595bdb618e11b2fc7591bc08120411bb";
const MODEL_URL: &str = "https://huggingface.co/ggerganov/whisper.cpp/resolve/5359861c739e955e79d9a303bcbc70fb988958b1/ggml-small-q5_1.bin";

/// The Whisper model packaged with the app, when this build includes it.
pub fn bundled_model(resources: Option<&Path>) -> Option<std::path::PathBuf> {
    let path = resources?.join("whisper").join(BUNDLED_MODEL);
    packaged_model(&path).then_some(path)
}

fn packaged_model(path: &Path) -> bool {
    let mut header = [0; 4];
    fs::File::open(path).is_ok_and(|mut file| {
        file.metadata()
            .is_ok_and(|metadata| metadata.is_file() && metadata.len() == MODEL_BYTES)
            && file.read_exact(&mut header).is_ok()
            && &header == b"lmgg"
    })
}

pub fn default_model(
    resources: Option<&Path>,
    data: &Path,
    on_download: impl FnOnce(),
) -> Result<PathBuf> {
    if let Some(path) = bundled_model(resources) {
        return Ok(path);
    }
    let folder = data.join("whisper");
    let model = folder.join(BUNDLED_MODEL);
    if packaged_model(&model) {
        return Ok(model);
    }
    on_download();
    fs::create_dir_all(&folder)?;
    const UNAVAILABLE: StudioError = StudioError::Input(
        "Không tải được mô hình Whisper mặc định. Kết nối mạng rồi bấm Tạo phụ đề lại, hoặc dùng bộ cài đầy đủ.",
    );
    let redirects = reqwest::redirect::Policy::custom(|attempt| {
        let url = attempt.url();
        if attempt.previous().len() >= 6
            || url.scheme() != "https"
            || !url
                .host_str()
                .is_some_and(|host| host == "huggingface.co" || host.ends_with(".hf.co"))
        {
            attempt.error("Whisper model redirect outside Hugging Face")
        } else {
            attempt.follow()
        }
    });
    let response = reqwest::blocking::Client::builder()
        .redirect(redirects)
        .connect_timeout(Duration::from_secs(20))
        .timeout(Duration::from_secs(600))
        .build()
        .and_then(|client| client.get(MODEL_URL).send())
        .and_then(|response| response.error_for_status())
        .map_err(|_| UNAVAILABLE)?;
    let mut input = response.take(MODEL_BYTES + 1);
    let mut file = tempfile::NamedTempFile::new_in(folder)?;
    let mut hash = Sha256::new();
    let mut count = 0;
    let mut buffer = [0; 65536];
    loop {
        let size = input.read(&mut buffer).map_err(|_| UNAVAILABLE)?;
        if size == 0 {
            break;
        }
        file.write_all(&buffer[..size])?;
        hash.update(&buffer[..size]);
        count += size as u64;
    }
    if count != MODEL_BYTES || format!("{:x}", hash.finalize()) != MODEL_SHA256 {
        return Err(StudioError::Input(
            "Mô hình Whisper tải về không khớp mã xác minh. Hãy thử lại.",
        ));
    }
    file.as_file().sync_all()?;
    file.persist(&model).map_err(|error| error.error)?;
    Ok(model)
}

pub fn transcribe(
    store: &Store,
    clip: &SpeechClip,
    language: &str,
    model: &Path,
    progress: impl Fn(i64, i64),
) -> Result<Vec<Cue>> {
    transcribe_in_chunks(store, clip, language, model, CHUNK_MS, progress)
}

pub fn whisper_binary() -> Result<PathBuf> {
    const MISSING: StudioError = StudioError::Input(
        "Cần FFmpeg có filter whisper. Trong Terminal, chạy ffmpeg -h filter=whisper để kiểm tra.",
    );
    let path = probe::find_tool("ffmpeg").ok_or(MISSING)?;
    let mut command = probe::command(&path);
    command.args(["-hide_banner", "-h", "filter=whisper"]);
    let output =
        probe::capture_limited(command, Duration::from_secs(8), 64 * 1024).ok_or(MISSING)?;
    if !output.starts_with(b"Filter whisper") {
        return Err(MISSING);
    }
    Ok(path)
}

fn leading_silence(mut command: Command, duration_ms: i64) -> i64 {
    command.args([
        "-af",
        "silencedetect=n=-60dB:d=1.5,ametadata=print:file=-",
        "-f",
        "null",
        "-",
    ]);
    let Some(output) = probe::capture_limited(command, Duration::from_secs(90), 256 * 1024) else {
        return 0;
    };
    let text = String::from_utf8_lossy(&output);
    let mut lines = text.lines();
    let start = lines.find_map(|line| line.strip_prefix("lavfi.silence_start="));
    let at_boundary = start
        .and_then(|value| value.parse::<f64>().ok())
        .is_some_and(|seconds| seconds.abs() <= 0.05);
    if !at_boundary {
        return 0;
    }
    // Keep 200 ms before the first audible sample to preserve the onset of speech.
    lines
        .find_map(|line| line.strip_prefix("lavfi.silence_end="))
        .map_or(duration_ms, |value| {
            value
                .parse::<f64>()
                .ok()
                .filter(|seconds| seconds.is_finite())
                .map_or(0, |seconds| {
                    ((seconds * 1000.).round() as i64)
                        .saturating_sub(200)
                        .clamp(0, duration_ms - 1)
                })
        })
}

pub(crate) fn transcribe_in_chunks(
    store: &Store,
    clip: &SpeechClip,
    language: &str,
    model: &Path,
    chunk_ms: i64,
    progress: impl Fn(i64, i64),
) -> Result<Vec<Cue>> {
    let source = store
        .source(clip.asset_id, false)?
        .filter(|asset| matches!(asset.kind.as_str(), "audio" | "video"))
        .ok_or(StudioError::Input(
            "Chọn một clip âm thanh hoặc video còn trong thư viện.",
        ))?;
    let length = clip.end_ms.saturating_sub(clip.start_ms);
    if clip.start_ms < 0
        || clip.end_ms > source.duration_ms.unwrap_or(0)
        || !(MIN_CLIP_MS..=MAX_TIMELINE_MS).contains(&length)
        || !(50..=200).contains(&clip.speed)
        || !matches!(language, "vi" | "en" | "auto")
    {
        return Err(StudioError::Input(
            "Chọn clip còn khả dụng, tốc độ từ 0,5× đến 2× và độ dài trong giới hạn timeline.",
        ));
    }
    let (source_path, _) = authorized_asset(&source)?;
    let format = MediaFormat::for_path(&source_path)
        .ok_or(StudioError::Input("Định dạng nguồn không hợp lệ."))?;
    let ffmpeg =
        probe::find_tool("ffmpeg").ok_or(StudioError::Input("Cần FFmpeg có filter whisper."))?;
    let model = dunce::canonicalize(model)?;
    let metadata = fs::metadata(&model)?;
    if !metadata.is_file()
        || !model
            .extension()
            .is_some_and(|extension| extension.eq_ignore_ascii_case("bin"))
        || !(1024..=2_000_000_000).contains(&metadata.len())
    {
        return Err(StudioError::Input(
            "Chọn mô hình Whisper GGML dạng .bin, tối đa 2 GB.",
        ));
    }
    let work = tempfile::tempdir()?;
    // A fixed, relative filename keeps user paths out of the FFmpeg filter syntax.
    let staged = work.path().join("model.bin");
    // A hard link avoids copying a large bundled model; other volumes fall back to a copy.
    if fs::hard_link(&model, &staged).is_err() {
        fs::copy(&model, &staged)?;
    }
    let filter = format!(
        "atempo={:.2},whisper=model=model.bin:language={language}:queue=12:use_gpu=0:destination=captions.srt:format=srt:max_len=80",
        f64::from(clip.speed) / 100.0
    );
    let scaled = |ms| (ms * 100 + i64::from(clip.speed) / 2) / i64::from(clip.speed);
    let output = work.path().join("captions.srt");
    let mut result = Vec::new();
    progress(0, length);
    for from in (0..length).step_by(chunk_ms as usize) {
        let to = (from + chunk_ms).min(length);
        let read_audio = |offset: i64| {
            let mut command = probe::command(&ffmpeg);
            command
                .current_dir(work.path())
                .args(["-hide_banner", "-loglevel", "error", "-nostdin"])
                .args(format.input_args())
                .args([
                    "-ss",
                    &format!("{:.3}", (clip.start_ms + offset) as f64 / 1000.0),
                    "-t",
                    &format!("{:.3}", (to - offset) as f64 / 1000.0),
                    "-i",
                ])
                .arg(&source_path)
                .args(["-map", "0:a:0", "-vn"]);
            command
        };
        let offset = from + leading_silence(read_audio(from), to - from);
        if offset >= to {
            progress(to, length);
            continue;
        }
        let mut command = read_audio(offset);
        command.args(["-af", &filter, "-f", "null", "-"]);
        probe::capture_allow_empty(command, Duration::from_secs(20 * 60)).ok_or_else(|| StudioError::Message(format!(
            "Whisper chưa đọc được tiếng từ mốc {}. Kiểm tra clip có âm thanh và FFmpeg có filter whisper.", format_timestamp(clip.start_ms + from))))?;
        if output.is_file() {
            let mut bytes = Vec::new();
            fs::File::open(&output)?
                .take((MAX_SRT_BYTES + 1) as u64)
                .read_to_end(&mut bytes)?;
            if bytes.len() > MAX_SRT_BYTES {
                return Err(StudioError::Input("Phụ đề vượt quá giới hạn."));
            }
            let text = std::str::from_utf8(&bytes)
                .map_err(|_| StudioError::Input("Whisper trả phụ đề không hợp lệ."))?;
            for mut cue in parse_cues(text, true)? {
                cue.start_ms += scaled(offset);
                cue.end_ms = (cue.end_ms + scaled(offset)).min(scaled(to));
                if valid(&cue) {
                    result.push(cue);
                }
            }
            fs::remove_file(&output)?;
        }
        if result.len() > MAX_TITLES {
            return Err(StudioError::Input(
                "Có hơn 1800 câu phụ đề. Hãy tách clip thành các dự án ngắn hơn.",
            ));
        }
        progress(to, length);
    }
    let current = store
        .source(clip.asset_id, false)?
        .ok_or(StudioError::Input("Đã thu hồi nguồn đang nhận dạng."))?;
    if authorized_asset(&current)?.0 != source_path {
        return Err(StudioError::Input("Nguồn nhận dạng đã thay đổi."));
    }
    Ok(result)
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn imports_and_exports_utf8_cues_without_overwrite() {
        let source = "\u{feff}1\r\n00:00:01,120 --> 00:00:03,456\r\nChào bạn\r\nDòng thứ hai\r\n\r\n2\r\n00:00:04.000 --> 00:00:06.000\r\nHẹn gặp lại";
        let cues = parse_cues(source, false).unwrap();
        assert_eq!(cues[0].start_ms, 1120);
        assert_eq!(cues[0].text, "Chào bạn\nDòng thứ hai");
        let folder = tempfile::tempdir().unwrap();
        let path = folder.path().join("phụ đề.srt");
        write(&path, cues.clone()).unwrap();
        assert_eq!(read(&path).unwrap(), cues);
        assert!(write(&path, cues).is_err());
        assert!(parse_cues("1\n00:60:01,000 --> 00:00:10,000\nSai", false).is_err());
    }

    #[test]
    fn bundled_model_is_found_only_inside_resources() {
        let folder = tempfile::tempdir().unwrap();
        assert!(bundled_model(None).is_none());
        assert!(bundled_model(Some(folder.path())).is_none());
        fs::create_dir(folder.path().join("whisper")).unwrap();
        let model = folder.path().join("whisper").join(BUNDLED_MODEL);
        fs::write(&model, b"tiny").unwrap();
        assert!(bundled_model(Some(folder.path())).is_none());
        let mut file = fs::File::create(&model).unwrap();
        file.write_all(b"lmgg").unwrap();
        file.set_len(MODEL_BYTES).unwrap();
        assert_eq!(bundled_model(Some(folder.path())), Some(model));
        let resolved = default_model(Some(folder.path()), folder.path(), || {
            panic!("packaged model should not download")
        })
        .unwrap();
        assert_eq!(resolved, folder.path().join("whisper").join(BUNDLED_MODEL));
        let cached = default_model(None, folder.path(), || {
            panic!("cached model should not download")
        })
        .unwrap();
        assert_eq!(cached, resolved);
    }

    #[test]
    #[ignore = "downloads the pinned 190 MB Whisper model"]
    fn real_whisper_download_is_verified_and_reused() {
        let directory = tempfile::tempdir().unwrap();
        let path = default_model(None, directory.path(), || {}).unwrap();
        assert!(packaged_model(&path));
        let cached =
            default_model(None, directory.path(), || panic!("model is already cached")).unwrap();
        assert_eq!(path, cached);
    }
}
