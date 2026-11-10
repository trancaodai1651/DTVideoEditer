use std::{fs, io::Read, path::Path, time::Duration};

use serde::{Deserialize, Serialize};

use crate::{
    library::authorized_file,
    model::{Result, StudioError},
    probe::{self, MediaFormat},
    store::Store,
    timeline::{MAX_TIMELINE_MS, MAX_TITLES, MIN_CLIP_MS},
};

const MAX_SRT_BYTES: usize = 256 * 1024;
const MAX_TRANSCRIBE_MS: i64 = 15 * 60 * 1000;

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
        return Err(StudioError::Input("Tệp SRT vượt quá 256 KB."));
    }
    let raw = std::str::from_utf8(&data)
        .map_err(|_| StudioError::Input("Hãy lưu tệp SRT ở mã UTF-8."))?;
    parse(raw)
}

fn parse(raw: &str) -> Result<Vec<Cue>> {
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
            return Err(invalid());
        }
        cues.push(cue);
        if cues.len() > MAX_TITLES {
            return Err(StudioError::Input("Tệp SRT vượt quá 300 câu phụ đề."));
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

pub fn transcribe(
    store: &Store,
    clip: &SpeechClip,
    language: &str,
    model: &Path,
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
        || !(MIN_CLIP_MS..=MAX_TRANSCRIBE_MS).contains(&length)
        || !(50..=200).contains(&clip.speed)
        || !matches!(language, "vi" | "en" | "auto")
    {
        return Err(StudioError::Input(
            "Phụ đề tự động hỗ trợ clip có âm thanh dài tối đa 15 phút.",
        ));
    }
    let (source_path, _) =
        authorized_file(Path::new(&source.root), Path::new(&source.relative_path))?;
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
    fs::copy(model, work.path().join("model.bin"))?;
    let filter = format!(
        "atempo={:.2},whisper=model=model.bin:language={language}:queue=12:use_gpu=0:destination=captions.srt:format=srt:max_len=80",
        f64::from(clip.speed) / 100.0
    );
    let mut command = probe::command(ffmpeg);
    command
        .current_dir(work.path())
        .args(["-hide_banner", "-loglevel", "error", "-nostdin"])
        .args(format.input_args())
        .args([
            "-ss",
            &format!("{:.3}", clip.start_ms as f64 / 1000.0),
            "-t",
            &format!("{:.3}", length as f64 / 1000.0),
        ])
        .arg("-i")
        .arg(source_path)
        .args(["-map", "0:a:0", "-vn", "-af", &filter, "-f", "null", "-"]);
    probe::capture_allow_empty(command, Duration::from_secs(20 * 60)).ok_or(StudioError::Input(
        "Whisper chưa tạo được phụ đề. Kiểm tra filter whisper, mô hình GGML và tiếng trong clip.",
    ))?;
    let limit = (length * 100 + i64::from(clip.speed) / 2) / i64::from(clip.speed);
    let output = work.path().join("captions.srt");
    if !output.exists() {
        return Ok(Vec::new());
    }
    let mut cues = read(&output)?;
    for cue in &mut cues {
        cue.end_ms = cue.end_ms.min(limit);
    }
    cues.retain(valid);
    Ok(cues)
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn imports_and_exports_utf8_cues_without_overwrite() {
        let source = "\u{feff}1\r\n00:00:01,120 --> 00:00:03,456\r\nChào bạn\r\nDòng thứ hai\r\n\r\n2\r\n00:00:04.000 --> 00:00:06.000\r\nHẹn gặp lại";
        let cues = parse(source).unwrap();
        assert_eq!(cues[0].start_ms, 1120);
        assert_eq!(cues[0].text, "Chào bạn\nDòng thứ hai");
        let folder = tempfile::tempdir().unwrap();
        let path = folder.path().join("phụ đề.srt");
        write(&path, cues.clone()).unwrap();
        assert_eq!(read(&path).unwrap(), cues);
        assert!(write(&path, cues).is_err());
        assert!(parse("1\n00:60:01,000 --> 00:00:10,000\nSai").is_err());
    }
}
