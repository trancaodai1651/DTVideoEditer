use std::{
    collections::HashMap,
    ffi::OsString,
    fs,
    io::{BufRead, BufReader, Read},
    path::{Path, PathBuf},
    process::Stdio,
    sync::{
        Arc,
        atomic::{AtomicBool, AtomicI64, Ordering},
    },
    thread,
    time::{Duration, Instant},
};

use wait_timeout::ChildExt;

use crate::{
    library::authorized_file,
    model::{Result, StudioError},
    probe::{self, MediaFormat},
    store::Store,
    timeline::{ClipEdit, TimelineSnapshot},
};

pub const FPS: u32 = 30;
const MAX_SIDE: u32 = 3840;
const MAX_COMMAND_CHARS: usize = 30_000;
const ERROR_TAIL: usize = 600;

/// A clip's media after the grant and path checks.
pub struct Source {
    pub path: PathBuf,
    pub format: MediaFormat,
    pub kind: String,
    pub has_audio: bool,
    pub width: Option<u32>,
    pub height: Option<u32>,
}

pub struct Plan {
    pub args: Vec<OsString>,
    pub duration_ms: i64,
    pub partial: PathBuf,
    pub output: PathBuf,
}

#[derive(Debug, PartialEq)]
pub enum Outcome {
    Done,
    Canceled,
}

fn seconds(ms: i64) -> String {
    format!("{}.{:03}", ms / 1000, ms % 1000)
}

fn frame_size(snapshot: &TimelineSnapshot, sources: &HashMap<i64, Source>) -> (u32, u32) {
    let even = |value: f64| ((value.round() as u32).max(16)) & !1;
    snapshot
        .clips("video")
        .iter()
        .find_map(|clip| {
            let source = sources.get(&clip.asset_id)?;
            Some((source.width?, source.height?))
        })
        .filter(|(width, height)| *width > 0 && *height > 0)
        .map(|(width, height)| {
            let scale = (f64::from(MAX_SIDE) / f64::from(width.max(height))).min(1.0);
            (
                even(f64::from(width) * scale),
                even(f64::from(height) * scale),
            )
        })
        .unwrap_or((1280, 720))
}

fn push_input(args: &mut Vec<OsString>, source: &Source, clip: &ClipEdit) {
    args.extend(source.format.input_args().map(OsString::from));
    if source.kind != "image" {
        // Read a little past the out point. The filter graph makes the exact cut.
        args.extend(
            [
                "-ss".to_owned(),
                seconds(clip.start_ms),
                "-t".to_owned(),
                seconds(clip.length_ms() + 500),
            ]
            .map(OsString::from),
        );
    }
    args.push("-i".into());
    args.push(source.path.clone().into());
}

fn audio_chain(index: usize, clip: &ClipEdit) -> String {
    format!(
        "[{index}:a:0]aresample=48000,aformat=sample_fmts=fltp:channel_layouts=stereo,\
         atrim=duration={},asetpts=PTS-STARTPTS,adelay={}:all=1[a{index}]",
        seconds(clip.length_ms()),
        clip.position_ms
    )
}

/// Builds the FFmpeg invocation for a snapshot. Video-track gaps render black,
/// audio gaps render silence, and a video clip's own audio is mixed with the audio track.
pub fn plan(
    snapshot: &TimelineSnapshot,
    sources: &HashMap<i64, Source>,
    output: &Path,
) -> Result<Plan> {
    let total = snapshot.duration_ms();
    if total <= 0 {
        return Err(StudioError::Input("Thêm clip vào timeline trước khi xuất."));
    }
    let missing = || StudioError::Input("Media của một clip không còn khả dụng. Hãy quét lại.");
    let (width, height) = frame_size(snapshot, sources);
    let fit = format!(
        "scale={width}:{height}:force_original_aspect_ratio=decrease:force_divisible_by=2,\
         pad={width}:{height}:(ow-iw)/2:(oh-ih)/2:color=black,setsar=1"
    );
    let black = |length: i64, label: &str| {
        format!(
            "color=c=black:s={width}x{height}:r={FPS}:d={},format=yuv420p,setsar=1{label}",
            seconds(length)
        )
    };

    let mut inputs = Vec::new();
    let mut graph = Vec::new();
    let mut video = Vec::new();
    let mut audio = vec!["[abase]".to_owned()];
    let mut index = 0;
    let mut cursor = 0;

    for clip in snapshot.clips("video") {
        let source = sources.get(&clip.asset_id).ok_or_else(missing)?;
        if source.kind == "audio" {
            return Err(StudioError::Input("Loại media không khớp với track."));
        }
        if clip.position_ms > cursor {
            let label = format!("[g{}]", video.len());
            graph.push(black(clip.position_ms - cursor, &label));
            video.push(label);
        }
        push_input(&mut inputs, source, clip);
        let length = seconds(clip.length_ms());
        // tpad holds a still for its whole length and covers a source that ends early.
        graph.push(format!(
            "[{index}:V:0]{fit},fps={FPS},tpad=stop_mode=clone:stop_duration={length},\
             format=yuv420p,trim=duration={length},setpts=PTS-STARTPTS[v{index}]"
        ));
        video.push(format!("[v{index}]"));
        if source.kind == "video" && source.has_audio {
            graph.push(audio_chain(index, clip));
            audio.push(format!("[a{index}]"));
        }
        cursor = clip.finish_ms();
        index += 1;
    }
    if total > cursor {
        let label = format!("[g{}]", video.len());
        graph.push(black(total - cursor, &label));
        video.push(label);
    }
    for clip in snapshot.clips("audio") {
        let source = sources.get(&clip.asset_id).ok_or_else(missing)?;
        if !source.has_audio {
            return Err(StudioError::Input(
                "Một clip trên track âm thanh không có luồng âm thanh.",
            ));
        }
        push_input(&mut inputs, source, clip);
        graph.push(audio_chain(index, clip));
        audio.push(format!("[a{index}]"));
        index += 1;
    }

    graph.push(format!(
        "{}concat=n={}:v=1:a=0[vout]",
        video.concat(),
        video.len()
    ));
    graph.push(format!(
        "anullsrc=r=48000:cl=stereo,atrim=duration={}[abase]",
        seconds(total)
    ));
    graph.push(format!(
        "{}amix=inputs={}:duration=first:normalize=0[aout]",
        audio.concat(),
        audio.len()
    ));

    let partial = output.with_extension("mp4.part");
    let mut args: Vec<OsString> = ["-hide_banner", "-loglevel", "error", "-nostdin", "-y"]
        .map(OsString::from)
        .into();
    args.extend(inputs);
    args.push("-filter_complex".into());
    args.push(graph.join(";").into());
    args.extend(
        [
            "-map", "[vout]", "-map", "[aout]", "-c:v", "libx264", "-preset", "veryfast", "-crf",
            "20", "-pix_fmt", "yuv420p", "-c:a", "aac", "-b:a", "192k", "-t",
        ]
        .map(OsString::from),
    );
    args.push(seconds(total).into());
    args.extend(
        [
            "-movflags",
            "+faststart",
            "-progress",
            "pipe:1",
            "-nostats",
            "-f",
            "mp4",
        ]
        .map(OsString::from),
    );
    args.push(partial.clone().into());
    if args.iter().map(|arg| arg.len() + 3).sum::<usize>() > MAX_COMMAND_CHARS {
        return Err(StudioError::Input(
            "Timeline có quá nhiều clip để xuất trong một lượt.",
        ));
    }
    Ok(Plan {
        args,
        duration_ms: total,
        partial,
        output: output.to_path_buf(),
    })
}

/// Runs FFmpeg, reports progress in thousandths and stops on cancel or deadline.
/// The video only appears at its final path after a complete render.
pub fn run(
    ffmpeg: &Path,
    plan: &Plan,
    cancel: &AtomicBool,
    mut on_progress: impl FnMut(u16),
) -> Result<Outcome> {
    let mut cmd = probe::command(ffmpeg);
    cmd.args(&plan.args).stderr(Stdio::piped());
    let mut child = cmd.spawn()?;
    let stdout = child.stdout.take().expect("stdout is piped");
    let mut stderr = child.stderr.take().expect("stderr is piped");

    let rendered_ms = Arc::new(AtomicI64::new(0));
    let progress = {
        let rendered_ms = Arc::clone(&rendered_ms);
        thread::spawn(move || {
            for line in BufReader::new(stdout).lines().map_while(|line| line.ok()) {
                if let Some(value) = line.strip_prefix("out_time_us=")
                    && let Ok(micros) = value.trim().parse::<i64>()
                {
                    rendered_ms.store(micros / 1000, Ordering::Relaxed);
                }
            }
        })
    };
    // Drain stderr completely so FFmpeg never blocks on a full pipe. Keep the tail.
    let errors = thread::spawn(move || {
        let mut tail = Vec::new();
        let mut chunk = [0; 4096];
        while let Ok(read) = stderr.read(&mut chunk) {
            if read == 0 {
                break;
            }
            tail.extend_from_slice(&chunk[..read]);
            if tail.len() > 4 * ERROR_TAIL {
                tail.drain(..tail.len() - 4 * ERROR_TAIL);
            }
        }
        String::from_utf8_lossy(&tail).into_owned()
    });

    let deadline = Instant::now()
        + Duration::from_secs(120)
        + Duration::from_millis(plan.duration_ms as u64 * 40);
    let mut reported = 0;
    let status = loop {
        if let Some(status) = child.wait_timeout(Duration::from_millis(150))? {
            break Some(status);
        }
        if cancel.load(Ordering::Relaxed) || Instant::now() > deadline {
            let _ = child.kill();
            let _ = child.wait();
            break None;
        }
        let value = (rendered_ms.load(Ordering::Relaxed) * 1000 / plan.duration_ms).clamp(0, 999);
        if value as u16 != reported {
            reported = value as u16;
            on_progress(reported);
        }
    };
    let _ = progress.join();
    let tail = errors.join().unwrap_or_default();

    match status {
        Some(status) if status.success() => {
            fs::rename(&plan.partial, &plan.output)?;
            Ok(Outcome::Done)
        }
        finished => {
            let _ = fs::remove_file(&plan.partial);
            if finished.is_some() {
                let detail: String = tail
                    .trim()
                    .chars()
                    .rev()
                    .take(ERROR_TAIL)
                    .collect::<Vec<_>>()
                    .into_iter()
                    .rev()
                    .collect();
                Err(StudioError::Message(format!(
                    "FFmpeg không xuất được video. {detail}"
                )))
            } else if cancel.load(Ordering::Relaxed) {
                Ok(Outcome::Canceled)
            } else {
                Err(StudioError::Input(
                    "Xuất video vượt quá thời gian cho phép.",
                ))
            }
        }
    }
}

fn same_file(left: &Path, right: &Path) -> bool {
    if cfg!(windows) {
        left.to_string_lossy()
            .eq_ignore_ascii_case(&right.to_string_lossy())
    } else {
        left == right
    }
}

/// Resolves every asset in the snapshot through its folder grant.
pub fn resolve(
    store: &Store,
    snapshot: &TimelineSnapshot,
    ffprobe: &Path,
) -> Result<HashMap<i64, Source>> {
    let unavailable = StudioError::Input("Media của một clip không còn khả dụng. Hãy quét lại.");
    let mut sources = HashMap::new();
    for clip in snapshot.tracks.iter().flat_map(|track| &track.clips) {
        if sources.contains_key(&clip.asset_id) {
            continue;
        }
        let Some(asset) = store.source(clip.asset_id, false)? else {
            return Err(unavailable);
        };
        let (path, _) = authorized_file(Path::new(&asset.root), Path::new(&asset.relative_path))?;
        let Some(format) = MediaFormat::for_path(&path) else {
            return Err(unavailable);
        };
        let has_audio = asset.kind != "image" && probe::has_audio(ffprobe, &path, &format);
        sources.insert(
            clip.asset_id,
            Source {
                path,
                format,
                kind: asset.kind,
                has_audio,
                width: asset.width,
                height: asset.height,
            },
        );
    }
    Ok(sources)
}

/// The output must be an MP4 in an existing folder and must not replace a source.
pub fn checked_output(output: &Path, sources: &HashMap<i64, Source>) -> Result<PathBuf> {
    let invalid = StudioError::Input("Vị trí lưu video không hợp lệ. Hãy chọn lại nơi lưu.");
    let (Some(parent), Some(name)) = (output.parent(), output.file_name()) else {
        return Err(invalid);
    };
    let is_mp4 = output
        .extension()
        .is_some_and(|extension| extension.eq_ignore_ascii_case("mp4"));
    if !output.is_absolute() || !is_mp4 || output.is_dir() {
        return Err(invalid);
    }
    let Ok(parent) = dunce::canonicalize(parent) else {
        return Err(invalid);
    };
    let output = parent.join(name);
    if sources
        .values()
        .any(|source| same_file(&source.path, &output))
    {
        return Err(StudioError::Input(
            "Không thể ghi đè lên tệp nguồn đang dùng trong timeline.",
        ));
    }
    Ok(output)
}

/// Renders a queued job. The caller records the final status.
pub fn execute(store: &Store, job_id: i64, cancel: &AtomicBool) -> Result<Outcome> {
    let task = store.render_task(job_id)?;
    if !store.set_render_status(job_id, &["queued"], "running", None)? {
        return Err(StudioError::Input(
            "Lượt xuất video không ở trạng thái chờ.",
        ));
    }
    let tool = |name: &str| probe::find_tool(name).filter(|path| probe::tool_ready(Some(path)));
    let (Some(ffmpeg), Some(ffprobe)) = (tool("ffmpeg"), tool("ffprobe")) else {
        return Err(StudioError::Input(
            "Cần FFmpeg và FFprobe trong PATH để xuất video. Xem Cài đặt.",
        ));
    };
    let sources = resolve(store, &task.snapshot, &ffprobe)?;
    let output = checked_output(Path::new(&task.output_path), &sources)?;
    let plan = plan(&task.snapshot, &sources, &output)?;
    run(&ffmpeg, &plan, cancel, |progress| {
        let _ = store.set_render_progress(job_id, progress);
    })
}

#[cfg(test)]
mod tests {
    use super::*;
    use crate::timeline::TrackEdit;

    fn source(name: &str, kind: &str, has_audio: bool) -> Source {
        let path = PathBuf::from(if cfg!(windows) { "C:\\media" } else { "/media" }).join(name);
        Source {
            format: MediaFormat::for_path(&path).unwrap(),
            path,
            kind: kind.into(),
            has_audio,
            width: Some(641),
            height: Some(360),
        }
    }

    fn clip(asset_id: i64, start_ms: i64, end_ms: i64, position_ms: i64) -> ClipEdit {
        ClipEdit {
            asset_id,
            start_ms,
            end_ms,
            position_ms,
        }
    }

    #[test]
    fn plans_trims_gaps_stills_and_mixed_audio() {
        let sources = HashMap::from([
            (1, source("a.mp4", "video", true)),
            (2, source("b.png", "image", false)),
            (3, source("c.wav", "audio", true)),
        ]);
        let snapshot = TimelineSnapshot {
            version: 2,
            tracks: vec![
                TrackEdit {
                    kind: "video".into(),
                    clips: vec![clip(2, 0, 2000, 3500), clip(1, 1000, 3500, 500)],
                },
                TrackEdit {
                    kind: "audio".into(),
                    clips: vec![clip(3, 250, 1250, 6000)],
                },
            ],
        };
        let output = sources[&1].path.with_file_name("out.mp4");
        let plan = plan(&snapshot, &sources, &output).unwrap();
        assert_eq!(plan.duration_ms, 7000);
        assert_eq!(plan.partial, output.with_extension("mp4.part"));
        let args: Vec<_> = plan
            .args
            .iter()
            .map(|arg| arg.to_string_lossy().into_owned())
            .collect();
        let joined = args.join(" ");
        // The trimmed video seeks to its in point, the still has no seek.
        assert!(joined.contains("-f mov -ss 1.000 -t 3.000 -i"));
        assert!(joined.contains("-f png_pipe -i"));
        assert!(joined.contains("-f wav -ss 0.250 -t 1.500 -i"));
        let graph = &args[args
            .iter()
            .position(|arg| arg == "-filter_complex")
            .unwrap()
            + 1];
        // Odd source width is rounded down to an even frame.
        assert!(graph.contains("color=c=black:s=640x360:r=30:d=0.500,"));
        assert!(graph.contains("trim=duration=2.500,setpts=PTS-STARTPTS[v0]"));
        assert!(graph.contains("tpad=stop_mode=clone:stop_duration=2.000"));
        assert!(graph.contains("color=c=black:s=640x360:r=30:d=1.500,"));
        assert!(graph.contains("[g0][v0][g2][v1][g4]concat=n=5:v=1:a=0[vout]"));
        assert!(graph.contains("atrim=duration=2.500,asetpts=PTS-STARTPTS,adelay=500:all=1[a0]"));
        assert!(graph.contains("adelay=6000:all=1[a2]"));
        assert!(graph.contains("atrim=duration=7.000[abase]"));
        assert!(graph.contains("[abase][a0][a2]amix=inputs=3:duration=first:normalize=0[aout]"));
        assert!(joined.ends_with(&format!(
            "-t 7.000 -movflags +faststart -progress pipe:1 -nostats -f mp4 {}",
            plan.partial.display()
        )));
    }

    #[test]
    fn rejects_empty_timeline_missing_media_and_source_overwrite() {
        let sources = HashMap::from([(1, source("a.mp4", "video", false))]);
        let output = sources[&1].path.with_file_name("out.mp4");
        let empty = TimelineSnapshot {
            version: 2,
            tracks: Vec::new(),
        };
        assert!(plan(&empty, &sources, &output).is_err());
        let missing = TimelineSnapshot {
            version: 2,
            tracks: vec![TrackEdit {
                kind: "video".into(),
                clips: vec![clip(9, 0, 1000, 0)],
            }],
        };
        assert!(plan(&missing, &sources, &output).is_err());

        let dir = tempfile::tempdir().unwrap();
        let folder = dunce::canonicalize(dir.path()).unwrap();
        let used = HashMap::from([(
            1,
            Source {
                path: folder.join("a.mp4"),
                ..source("a.mp4", "video", false)
            },
        )]);
        assert!(checked_output(&folder.join("A.MP4"), &used).is_err() == cfg!(windows));
        assert!(checked_output(&folder.join("a.mp4"), &used).is_err());
        assert!(checked_output(&folder.join("new.mp4"), &used).is_ok());
        assert!(checked_output(&folder.join("new.mov"), &used).is_err());
        assert!(checked_output(&folder.join("missing").join("new.mp4"), &used).is_err());
        assert!(checked_output(Path::new("new.mp4"), &used).is_err());
    }
}
