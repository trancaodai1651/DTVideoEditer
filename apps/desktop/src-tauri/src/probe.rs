use std::{
    ffi::OsStr,
    io::Read,
    path::{Path, PathBuf},
    process::{Command, Stdio},
    time::Duration,
};

use serde::Deserialize;
use wait_timeout::ChildExt;

const PROBE_TIMEOUT: Duration = Duration::from_secs(8);
const THUMBNAIL_TIMEOUT: Duration = Duration::from_secs(8);
const MAX_OUTPUT: usize = 128 * 1024;

pub struct Metadata {
    pub kind: &'static str,
    pub duration_ms: Option<i64>,
    pub width: Option<u32>,
    pub height: Option<u32>,
    pub codec: Option<String>,
    pub frame_rate: Option<f64>,
    pub thumbnail: Option<Vec<u8>>,
}

pub struct MediaFormat {
    demuxer: &'static str,
    mime: &'static str,
    image: bool,
}

impl MediaFormat {
    pub fn for_path(path: &Path) -> Option<Self> {
        let extension = path.extension()?.to_str()?.to_ascii_lowercase();
        let (demuxer, mime, image) = match extension.as_str() {
            "mp4" | "m4v" => ("mov", "video/mp4", false),
            "mov" => ("mov", "video/quicktime", false),
            "m4a" => ("mov", "audio/mp4", false),
            "webm" => ("matroska", "video/webm", false),
            "mkv" => ("matroska", "video/x-matroska", false),
            "mp3" => ("mp3", "audio/mpeg", false),
            "wav" => ("wav", "audio/wav", false),
            "flac" => ("flac", "audio/flac", false),
            "ogg" | "opus" => ("ogg", "audio/ogg", false),
            "jpg" | "jpeg" => ("jpeg_pipe", "image/jpeg", true),
            "png" => ("png_pipe", "image/png", true),
            "webp" => ("webp_pipe", "image/webp", true),
            _ => return None,
        };
        Some(Self {
            demuxer,
            mime,
            image,
        })
    }

    pub fn mime(&self, kind: &str) -> &'static str {
        match (self.mime, kind) {
            ("video/mp4", "audio") => "audio/mp4",
            ("video/webm", "audio") => "audio/webm",
            _ => self.mime,
        }
    }

    pub fn input_args(&self) -> [&str; 8] {
        [
            "-protocol_whitelist",
            "file",
            "-format_whitelist",
            self.demuxer,
            "-max_alloc",
            "134217728",
            "-f",
            self.demuxer,
        ]
    }
}

pub trait MediaProbe {
    fn generates_thumbnails(&self) -> bool {
        false
    }

    fn inspect(&self, path: &Path, format: &MediaFormat) -> Option<Metadata>;
}

pub struct Ffprobe {
    pub binary: PathBuf,
    pub ffmpeg: Option<PathBuf>,
}

#[derive(Deserialize)]
struct ProbeOutput {
    #[serde(default)]
    streams: Vec<Stream>,
    format: Option<Container>,
}

#[derive(Deserialize)]
struct Container {
    duration: Option<String>,
}

#[derive(Deserialize)]
struct Stream {
    codec_type: String,
    codec_name: Option<String>,
    width: Option<u32>,
    height: Option<u32>,
    duration: Option<String>,
    avg_frame_rate: Option<String>,
    disposition: Option<Disposition>,
}

#[derive(Deserialize)]
struct Disposition {
    attached_pic: Option<u8>,
}

impl MediaProbe for Ffprobe {
    fn generates_thumbnails(&self) -> bool {
        self.ffmpeg.is_some()
    }

    fn inspect(&self, path: &Path, format: &MediaFormat) -> Option<Metadata> {
        let mut cmd = command(&self.binary);
        cmd.args(["-v", "error", "-probesize", "5000000", "-analyzeduration", "5000000"])
            .args(format.input_args())
            .args(["-show_entries", "format=duration:stream=codec_name,codec_type,width,height,duration,avg_frame_rate:stream_disposition=attached_pic", "-of", "json", "-i"])
            .arg(path);
        let bytes = capture(cmd, PROBE_TIMEOUT)?;
        let output = serde_json::from_slice::<ProbeOutput>(&bytes).ok()?;
        let picture = output.streams.iter().find(|stream| {
            stream.codec_type == "video"
                && stream.width.is_some_and(|width| width > 0)
                && stream.height.is_some_and(|height| height > 0)
                && stream.disposition.as_ref().and_then(|d| d.attached_pic) != Some(1)
        });
        let audio = output
            .streams
            .iter()
            .find(|stream| stream.codec_type == "audio");
        let (kind, stream) = match (format.image, picture, audio) {
            (true, Some(stream), _) => ("image", stream),
            (false, Some(stream), _) => ("video", stream),
            (false, None, Some(stream)) => ("audio", stream),
            _ => return None,
        };
        let duration_ms = (kind != "image")
            .then(|| {
                output
                    .format
                    .as_ref()
                    .and_then(|container| milliseconds(container.duration.as_deref()))
                    .or_else(|| milliseconds(stream.duration.as_deref()))
            })
            .flatten();
        let frame_rate = (kind == "video")
            .then(|| fraction(stream.avg_frame_rate.as_deref()))
            .flatten();
        let thumbnail = if picture.is_some() {
            self.ffmpeg
                .as_deref()
                .and_then(|binary| thumbnail(binary, path, format))
        } else {
            None
        };
        Some(Metadata {
            kind,
            duration_ms,
            width: stream.width,
            height: stream.height,
            codec: stream.codec_name.clone(),
            frame_rate,
            thumbnail,
        })
    }
}

fn milliseconds(value: Option<&str>) -> Option<i64> {
    let seconds: f64 = value?.parse().ok()?;
    let ms = (seconds * 1000.0).round();
    (ms.is_finite() && ms >= 0.0 && ms < (1u64 << 53) as f64).then_some(ms as i64)
}

fn fraction(value: Option<&str>) -> Option<f64> {
    let (left, right) = value?.split_once('/')?;
    let rate = left.parse::<f64>().ok()? / right.parse::<f64>().ok()?;
    (rate.is_finite() && rate > 0.0).then_some(rate)
}

fn thumbnail(binary: &Path, path: &Path, format: &MediaFormat) -> Option<Vec<u8>> {
    let mut cmd = command(binary);
    cmd.args([
        "-hide_banner",
        "-loglevel",
        "error",
        "-nostdin",
        "-threads",
        "1",
        "-filter_threads",
        "1",
    ])
    .args(format.input_args())
    .arg("-i")
    .arg(path)
    .args([
        "-map",
        "0:V:0",
        "-frames:v",
        "1",
        "-an",
        "-sn",
        "-dn",
        "-vf",
        "scale=320:180:force_original_aspect_ratio=decrease:force_divisible_by=2",
        "-c:v",
        "mjpeg",
        "-threads",
        "1",
        "-q:v",
        "5",
        "-f",
        "image2pipe",
        "pipe:1",
    ]);
    let bytes = capture(cmd, THUMBNAIL_TIMEOUT)?;
    bytes.starts_with(&[0xff, 0xd8, 0xff]).then_some(bytes)
}

/// Whether the file carries an audio stream the renderer can mix.
pub fn has_audio(ffprobe: &Path, path: &Path, format: &MediaFormat) -> bool {
    let mut cmd = command(ffprobe);
    cmd.args(["-v", "error"])
        .args(format.input_args())
        .args([
            "-select_streams",
            "a",
            "-show_entries",
            "stream=codec_type",
            "-of",
            "csv=p=0",
            "-i",
        ])
        .arg(path);
    capture(cmd, PROBE_TIMEOUT).is_some_and(|bytes| bytes.starts_with(b"audio"))
}

pub fn find_tool(name: &str) -> Option<PathBuf> {
    let path = std::env::var_os("PATH").unwrap_or_default();
    let binary = if cfg!(windows) {
        format!("{name}.exe")
    } else {
        name.to_owned()
    };
    let paths = std::env::split_paths(&path);
    #[cfg(target_os = "macos")]
    let paths =
        paths.chain(["/opt/homebrew/bin", "/usr/local/bin", "/opt/local/bin"].map(PathBuf::from));
    paths
        .filter(|dir| dir.is_absolute())
        .map(|dir| dir.join(&binary))
        .find(|path| path.is_file())
}

pub fn tool_ready(path: Option<&Path>) -> bool {
    path.is_some_and(|path| {
        let mut cmd = command(path);
        cmd.arg("-version");
        capture(cmd, Duration::from_secs(3)).is_some()
    })
}

pub fn command(binary: impl AsRef<OsStr>) -> Command {
    let mut cmd = Command::new(binary);
    #[cfg(windows)]
    {
        use std::os::windows::process::CommandExt;
        cmd.creation_flags(0x0800_0000); // CREATE_NO_WINDOW
    }
    cmd.stdin(Stdio::null())
        .stderr(Stdio::null())
        .stdout(Stdio::piped());
    cmd
}

pub fn waveform(path: &Path, duration_ms: i64) -> Option<Vec<u8>> {
    if !(1..=900_000).contains(&duration_ms) {
        return None;
    }
    let format = MediaFormat::for_path(path)?;
    let mut cmd = command(find_tool("ffmpeg")?);
    cmd.args(["-hide_banner", "-loglevel", "error", "-nostdin"]).args(format.input_args())
        .arg("-i").arg(path)
        .args(["-filter_complex", "[0:a:0]aformat=channel_layouts=mono,aresample=1000,showwavespic=s=480x48:colors=0x76d9d6,format=rgba,colorkey=black:0.01:0[wave]",
            "-map", "[wave]", "-frames:v", "1", "-c:v", "png", "-f", "image2pipe", "pipe:1"]);
    capture(cmd, Duration::from_secs(18)).filter(|bytes| bytes.starts_with(b"\x89PNG\r\n\x1a\n"))
}

pub fn filmstrip(path: &Path, duration_ms: i64) -> Option<Vec<u8>> {
    const FRAMES: i64 = 8;
    if duration_ms < 100 {
        return None;
    }
    let format = MediaFormat::for_path(path)?;
    let mut cmd = command(find_tool("ffmpeg")?);
    cmd.args([
        "-hide_banner",
        "-loglevel",
        "error",
        "-nostdin",
        "-filter_complex_threads",
        "1",
    ]);
    let mut graph = String::new();
    for index in 0..FRAMES {
        let at = duration_ms * index / FRAMES;
        cmd.args(format.input_args())
            .args([
                "-threads",
                "1",
                "-ss",
                &format!("{}.{:03}", at / 1000, at % 1000),
                "-i",
            ])
            .arg(path);
        graph.push_str(&format!("[{index}:V:0]trim=end_frame=1,scale=96:54:force_original_aspect_ratio=decrease,pad=96:54:(ow-iw)/2:(oh-ih)/2,setsar=1,setpts=PTS-STARTPTS[f{index}];"));
    }
    for index in 0..FRAMES {
        graph.push_str(&format!("[f{index}]"));
    }
    graph.push_str(&format!("hstack=inputs={FRAMES}[strip]"));
    cmd.args([
        "-filter_complex",
        &graph,
        "-map",
        "[strip]",
        "-frames:v",
        "1",
        "-threads",
        "1",
        "-c:v",
        "mjpeg",
        "-q:v",
        "5",
        "-f",
        "image2pipe",
        "pipe:1",
    ]);
    capture(cmd, THUMBNAIL_TIMEOUT).filter(|bytes| bytes.starts_with(b"\xff\xd8\xff"))
}

fn capture(cmd: Command, deadline: Duration) -> Option<Vec<u8>> {
    capture_allow_empty(cmd, deadline).filter(|bytes| !bytes.is_empty())
}

pub(crate) fn capture_allow_empty(mut cmd: Command, deadline: Duration) -> Option<Vec<u8>> {
    let mut child = cmd.spawn().ok()?;
    let output = child.stdout.take().expect("stdout is piped");
    let reader = std::thread::spawn(move || {
        let mut bytes = Vec::new();
        output
            .take((MAX_OUTPUT + 1) as u64)
            .read_to_end(&mut bytes)?;
        Ok::<_, std::io::Error>(bytes)
    });
    let success = match child.wait_timeout(deadline) {
        Ok(Some(status)) => status.success(),
        _ => {
            let _ = child.kill();
            let _ = child.wait();
            false
        }
    };
    let bytes = reader.join().ok()?.ok()?;
    (success && bytes.len() <= MAX_OUTPUT).then_some(bytes)
}

#[cfg(test)]
mod tests {
    use super::{fraction, milliseconds};

    #[test]
    fn rejects_non_finite_and_invalid_media_metadata() {
        assert_eq!(fraction(Some("30000/1001")), Some(30000.0 / 1001.0));
        assert_eq!(fraction(Some("1/0")), None);
        assert_eq!(milliseconds(Some("1.234")), Some(1234));
        assert_eq!(milliseconds(Some("NaN")), None);
        assert_eq!(milliseconds(Some("-5")), None);
    }
}
