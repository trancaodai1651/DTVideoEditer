use std::{cell::Cell, fs, path::Path, process::Command, sync::atomic::AtomicBool};

use tauri::http::{Request, StatusCode, header};

use crate::{
    library::{authorized_file, scan, selected_root},
    preview::serve,
    probe::{Ffprobe, MediaFormat, MediaProbe, Metadata, find_tool},
    render::{Outcome, execute},
    store::Store,
    timeline::{ClipEdit, TimelineSnapshot, TrackEdit},
};

fn clip(asset_id: i64, start_ms: i64, end_ms: i64, position_ms: i64) -> ClipEdit {
    ClipEdit {
        asset_id,
        start_ms,
        end_ms,
        position_ms,
        layer: 0,
        look: Default::default(),
    }
}

fn snapshot(video: Vec<ClipEdit>, audio: Vec<ClipEdit>) -> TimelineSnapshot {
    TimelineSnapshot {
        version: 3,
        tracks: vec![
            TrackEdit {
                kind: "video".into(),
                clips: video,
            },
            TrackEdit {
                kind: "audio".into(),
                clips: audio,
            },
        ],
        titles: vec![],
        aspect: Default::default(),
    }
}

struct CountingProbe(Cell<usize>);

impl MediaProbe for CountingProbe {
    fn inspect(&self, _path: &Path, _format: &MediaFormat) -> Option<Metadata> {
        self.0.set(self.0.get() + 1);
        Some(Metadata {
            kind: "video",
            duration_ms: Some(1000),
            width: Some(320),
            height: Some(180),
            codec: Some("h264".into()),
            frame_rate: Some(24.0),
            thumbnail: None,
        })
    }
}

#[test]
fn grant_scan_preview_project_reopen_and_revoke() {
    let dir = tempfile::tempdir().unwrap();
    let root = dir.path().join("media");
    fs::create_dir(&root).unwrap();
    let root = selected_root(&root).unwrap();
    let db_path = dir.path().join("test.sqlite3");
    let clip_path = root.join("đoạn phim thử.mp4");
    fs::write(&clip_path, b"0123456789").unwrap();
    fs::write(root.join("ignored.txt"), b"text").unwrap();
    fs::write(dir.path().join("outside.mp4"), b"private").unwrap();

    assert!(authorized_file(&root, Path::new("../outside.mp4")).is_err());
    assert!(authorized_file(&root, &clip_path).is_err());
    let store = Store::open(&db_path).unwrap();
    let folder = store.grant(root.to_str().unwrap()).unwrap();
    assert_eq!(store.grant(root.to_str().unwrap()).unwrap(), folder);
    let probe = CountingProbe(Cell::new(0));
    assert_eq!(scan(&store, folder, &probe).unwrap().indexed, 1);
    assert_eq!(scan(&store, folder, &probe).unwrap().reused, 1);
    assert_eq!(probe.0.get(), 1);
    let page = store.assets(None, 0).unwrap();
    assert_eq!(page.total, 1);
    let asset_id = page.items[0].id;

    let request = || {
        Request::builder()
            .uri(format!("http://studio-media.localhost/source-{asset_id}"))
            .header(header::RANGE, "bytes=3-5")
            .body(Vec::new())
            .unwrap()
    };
    let response = serve(&store, request());
    assert_eq!(response.status(), StatusCode::PARTIAL_CONTENT);
    assert_eq!(response.headers()[header::CONTENT_RANGE], "bytes 3-5/10");
    assert_eq!(response.body(), b"345");
    let untrusted = Request::builder()
        .uri(request().uri())
        .header(header::ORIGIN, "https://untrusted.test")
        .body(Vec::new())
        .unwrap();
    assert_eq!(serve(&store, untrusted).status(), StatusCode::FORBIDDEN);

    let project = store.create_project("Dự án thử").unwrap();
    // A split with trimmed ends: two ranges of the same source with a gap between.
    let edits = snapshot(
        vec![clip(asset_id, 200, 700, 0), clip(asset_id, 700, 1000, 900)],
        vec![],
    );
    store.save_timeline(project.id, &edits).unwrap();
    let rejected = [
        snapshot(vec![clip(asset_id, 0, 1001, 0)], vec![]),
        snapshot(vec![], vec![clip(asset_id, 0, 500, 0)]),
        snapshot(
            vec![clip(asset_id, 0, 500, 0), clip(asset_id, 0, 500, 499)],
            vec![],
        ),
        snapshot(vec![clip(asset_id + 1, 0, 500, 0)], vec![]),
    ];
    for invalid in &rejected {
        assert!(store.save_timeline(project.id, invalid).is_err());
    }
    assert!(store.save_timeline(project.id + 1, &edits).is_err());
    drop(store);

    let store = Store::open(&db_path).unwrap();
    assert_eq!(store.projects().unwrap()[0].id, project.id);
    // Rejected saves roll back and the edit points survive a reopen.
    assert_eq!(store.snapshot(project.id).unwrap(), edits);
    let saved = store.timeline(project.id).unwrap();
    assert_eq!(saved.version, 3);
    assert_eq!(saved.clips[1].source_duration_ms, Some(1000));
    fs::remove_file(&clip_path).unwrap();
    scan(&store, folder, &probe).unwrap();
    assert_eq!(store.assets(None, 0).unwrap().total, 0);
    assert!(!store.timeline(project.id).unwrap().clips[0].available);
    fs::write(&clip_path, b"0123456789").unwrap();
    assert_eq!(scan(&store, folder, &probe).unwrap().indexed, 1);
    assert_eq!(store.assets(None, 0).unwrap().items[0].id, asset_id);

    store.revoke(folder).unwrap();
    assert!(store.timeline(project.id).unwrap().clips.is_empty());
    assert!(store.folders().unwrap().is_empty());
    assert!(scan(&store, folder, &probe).is_err());
    assert_eq!(serve(&store, request()).status(), StatusCode::NOT_FOUND);
    assert_eq!(fs::read(&clip_path).unwrap(), b"0123456789");
}

#[test]
#[cfg(unix)]
fn blocks_symlink_entries_and_replaced_ancestor() {
    let dir = tempfile::tempdir().unwrap();
    let root = dir.path().join("granted");
    let outside = dir.path().join("other");
    fs::create_dir_all(&root).unwrap();
    fs::create_dir_all(&outside).unwrap();
    let root = selected_root(&root).unwrap();
    fs::write(outside.join("secret.mp4"), b"private").unwrap();
    std::os::unix::fs::symlink(&outside, root.join("shortcut")).unwrap();
    assert!(authorized_file(&root, Path::new("shortcut/secret.mp4")).is_err());
    let store = Store::open(&dir.path().join("test.sqlite3")).unwrap();
    let folder = store.grant(root.to_str().unwrap()).unwrap();
    assert_eq!(
        scan(&store, folder, &CountingProbe(Cell::new(0)))
            .unwrap()
            .indexed,
        0
    );
    fs::rename(&root, root.with_file_name("previous")).unwrap();
    std::os::unix::fs::symlink(&outside, &root).unwrap();
    assert!(scan(&store, folder, &CountingProbe(Cell::new(0))).is_err());
}

#[test]
#[ignore = "requires FFmpeg and FFprobe installed on PATH"]
fn real_ffmpeg_indexes_media_and_jpeg_thumbnail() {
    let dir = tempfile::tempdir().unwrap();
    let media = dir.path().join("Tư liệu");
    fs::create_dir(&media).unwrap();
    let ffmpeg = find_tool("ffmpeg").expect("ffmpeg on PATH");
    let ffprobe = find_tool("ffprobe").expect("ffprobe on PATH");
    let status = Command::new(&ffmpeg)
        .args([
            "-hide_banner",
            "-loglevel",
            "error",
            "-f",
            "lavfi",
            "-i",
            "color=c=royalblue:s=320x180:r=24:d=1",
            "-c:v",
            "libx264",
            "-pix_fmt",
            "yuv420p",
            "-threads",
            "1",
            "-movflags",
            "+faststart",
        ])
        .arg(media.join("Mẫu 01.mp4"))
        .status()
        .unwrap();
    assert!(status.success());
    let status = Command::new(&ffmpeg)
        .args([
            "-hide_banner",
            "-loglevel",
            "error",
            "-f",
            "lavfi",
            "-i",
            "sine=frequency=440:duration=1",
            "-c:a",
            "pcm_s16le",
        ])
        .arg(media.join("Âm thanh.wav"))
        .status()
        .unwrap();
    assert!(status.success());
    fs::write(
        media.join("Hình mẫu.png"),
        include_bytes!("../icons/icon.png"),
    )
    .unwrap();
    fs::write(media.join("hỏng.mp4"), "not a video").unwrap();

    let root = selected_root(&media).unwrap();
    let store = Store::open(&dir.path().join("test.sqlite3")).unwrap();
    let folder = store.grant(root.to_str().unwrap()).unwrap();
    let metadata_only = Ffprobe {
        binary: ffprobe.clone(),
        ffmpeg: None,
    };
    assert_eq!(scan(&store, folder, &metadata_only).unwrap().indexed, 3);
    assert!(
        store
            .assets(None, 0)
            .unwrap()
            .items
            .iter()
            .all(|asset| !asset.has_thumbnail)
    );
    let full_probe = Ffprobe {
        binary: ffprobe,
        ffmpeg: Some(ffmpeg),
    };
    let report = scan(&store, folder, &full_probe).unwrap();
    assert_eq!(
        (
            report.indexed,
            report.reused,
            report.skipped,
            report.partial
        ),
        (2, 1, 1, false)
    );
    assert_eq!(scan(&store, folder, &full_probe).unwrap().reused, 3);
    let assets = store.assets(Some(folder), 0).unwrap().items;
    let video = assets.iter().find(|asset| asset.kind == "video").unwrap();
    let audio = assets.iter().find(|asset| asset.kind == "audio").unwrap();
    let image = assets.iter().find(|asset| asset.kind == "image").unwrap();
    assert_eq!(
        (video.width, video.height, video.duration_ms),
        (Some(320), Some(180), Some(1000))
    );
    assert_eq!(video.codec.as_deref(), Some("h264"));
    assert_eq!(audio.duration_ms, Some(1000));
    assert_eq!((image.width, image.height), (Some(64), Some(64)));
    for item in [video, image] {
        assert!(item.has_thumbnail);
        let request = Request::builder()
            .uri(format!(
                "http://studio-media.localhost/thumbnail-{}",
                item.id
            ))
            .body(Vec::new())
            .unwrap();
        let response = serve(&store, request);
        assert_eq!(response.status(), StatusCode::OK);
        assert!(response.body().starts_with(&[0xff, 0xd8, 0xff]));
    }
    let project = store.create_project("Smoke test").unwrap();
    store
        .save_timeline(
            project.id,
            &snapshot(
                vec![clip(video.id, 0, 1000, 0), clip(image.id, 0, 3000, 1000)],
                vec![clip(audio.id, 0, 1000, 0)],
            ),
        )
        .unwrap();
    let tracks: Vec<_> = store
        .timeline(project.id)
        .unwrap()
        .clips
        .into_iter()
        .map(|clip| clip.track)
        .collect();
    assert_eq!(tracks, ["video", "video", "audio"]);
}

#[test]
fn migrates_schema_one_projects_to_edit_points() {
    let dir = tempfile::tempdir().unwrap();
    let db_path = dir.path().join("old.sqlite3");
    let db = rusqlite::Connection::open(&db_path).unwrap();
    db.execute_batch(include_str!("../migrations/001_library.sql"))
        .unwrap();
    db.execute_batch(
        "PRAGMA user_version = 1;
         INSERT INTO folder_grants(id, root) VALUES (1, '/media');
         INSERT INTO assets(id, folder_id, relative_path, kind, bytes, modified) VALUES
           (1, 1, 'a.mp4', 'video', 10, ''), (2, 1, 'b.png', 'image', 10, ''),
           (3, 1, 'c.wav', 'audio', 10, ''), (4, 1, 'd.mp4', 'video', 10, '');
         INSERT INTO asset_metadata(asset_id, duration_ms) VALUES (1, 6000), (2, NULL), (3, 3000), (4, NULL);
         INSERT INTO projects(id, name) VALUES (1, 'Cũ');
         INSERT INTO timelines(id) VALUES (1);
         INSERT INTO timeline_tracks(id, timeline_id, kind) VALUES (1, 1, 'video'), (2, 1, 'audio');
         INSERT INTO timeline_clips(id, track_id, asset_id, position) VALUES
           (5, 1, 1, 0), (6, 1, 2, 1), (7, 1, 4, 3), (8, 2, 3, 0), (9, 2, 3, 1);",
    )
    .unwrap();
    drop(db);

    let store = Store::open(&db_path).unwrap();
    let clips = store.timeline(1).unwrap().clips;
    let points: Vec<_> = clips
        .iter()
        .map(|clip| (clip.id, clip.start_ms, clip.end_ms, clip.position_ms))
        .collect();
    assert_eq!(
        points,
        [
            (5, 0, 6000, 0),
            (6, 0, 3000, 6000),
            (7, 0, 1000, 9000),
            (8, 0, 3000, 0),
            (9, 0, 3000, 3000)
        ]
    );
    // Rebuilt tables keep their foreign keys: new saves work and revoking cascades.
    store
        .save_timeline(1, &snapshot(vec![clip(1, 500, 2500, 0)], vec![]))
        .unwrap();
    let job = store
        .create_render_job(1, &store.snapshot(1).unwrap(), "/out.mp4")
        .unwrap();
    assert_eq!((job.status.as_str(), job.duration_ms), ("queued", 2000));
    drop(store);

    let store = Store::open(&db_path).unwrap();
    // Waiting work survives restart. A render interrupted while running can be retried.
    assert_eq!(store.next_queued_render().unwrap(), Some(job.id));
    assert_eq!(store.render_job(job.id).unwrap().status, "queued");
    assert!(
        store
            .create_render_job(1, &store.snapshot(1).unwrap(), "/out.mp4")
            .is_err()
    );
    assert!(
        store
            .set_render_status(job.id, &["queued"], "running", None)
            .unwrap()
    );
    let next = store
        .create_render_job(1, &store.snapshot(1).unwrap(), "/next.mp4")
        .unwrap();
    drop(store);
    let store = Store::open(&db_path).unwrap();
    assert_eq!(store.render_job(job.id).unwrap().status, "failed");
    assert!(
        store
            .set_render_status(job.id, &["failed", "canceled"], "queued", None)
            .unwrap()
    );
    assert!(
        !store
            .set_render_status(job.id, &["failed", "canceled"], "queued", None)
            .unwrap()
    );
    assert_eq!(store.next_queued_render().unwrap(), Some(job.id));
    assert!(
        store
            .set_render_status(job.id, &["queued"], "canceled", None)
            .unwrap()
    );
    assert_eq!(store.next_queued_render().unwrap(), Some(next.id));
    store.revoke(1).unwrap();
    assert!(store.timeline(1).unwrap().clips.is_empty());
    assert_eq!(store.render_jobs(1).unwrap().len(), 2);
}

#[test]
#[ignore = "requires FFmpeg and FFprobe installed on PATH"]
fn real_ffmpeg_renders_trimmed_timeline_to_mp4() {
    let dir = tempfile::tempdir().unwrap();
    let media = dir.path().join("Tư liệu");
    fs::create_dir(&media).unwrap();
    let ffmpeg = find_tool("ffmpeg").expect("ffmpeg on PATH");
    let ffprobe = find_tool("ffprobe").expect("ffprobe on PATH");
    let generate = |args: &[&str], name: &str| {
        let status = Command::new(&ffmpeg)
            .args(["-hide_banner", "-loglevel", "error"])
            .args(args)
            .arg(media.join(name))
            .status()
            .unwrap();
        assert!(status.success());
    };
    generate(
        &[
            "-f",
            "lavfi",
            "-i",
            "testsrc2=size=640x360:rate=30:duration=6",
            "-f",
            "lavfi",
            "-i",
            "sine=frequency=330:duration=6",
            "-c:v",
            "libx264",
            "-pix_fmt",
            "yuv420p",
            "-c:a",
            "aac",
        ],
        "Video mẫu.mp4",
    );
    generate(
        &[
            "-f",
            "lavfi",
            "-i",
            "sine=frequency=440:duration=3",
            "-c:a",
            "pcm_s16le",
        ],
        "Âm thanh mẫu.wav",
    );
    fs::write(
        media.join("Ảnh mẫu.png"),
        include_bytes!("../icons/icon.png"),
    )
    .unwrap();

    let root = selected_root(&media).unwrap();
    let store = Store::open(&dir.path().join("test.sqlite3")).unwrap();
    let folder = store.grant(root.to_str().unwrap()).unwrap();
    let probe = Ffprobe {
        binary: ffprobe.clone(),
        ffmpeg: None,
    };
    assert_eq!(scan(&store, folder, &probe).unwrap().indexed, 3);
    let assets = store.assets(Some(folder), 0).unwrap().items;
    let id = |kind: &str| assets.iter().find(|asset| asset.kind == kind).unwrap().id;
    let project = store.create_project("Xuất thử").unwrap();
    // Trimmed head, a split with a dropped middle, a half second gap, a still,
    // and a trimmed audio clip that starts late.
    store
        .save_timeline(
            project.id,
            &snapshot(
                vec![
                    clip(id("video"), 1000, 3000, 0),
                    clip(id("video"), 4000, 5500, 2000),
                    clip(id("image"), 0, 1500, 4000),
                ],
                vec![clip(id("audio"), 500, 2500, 3000)],
            ),
        )
        .unwrap();
    let saved = store.snapshot(project.id).unwrap();
    assert_eq!(saved.duration_ms(), 5500);

    let output = dunce::canonicalize(dir.path()).unwrap().join("Kết quả.mp4");
    let job = store
        .create_render_job(project.id, &saved, output.to_str().unwrap())
        .unwrap();
    let idle = AtomicBool::new(false);
    assert_eq!(execute(&store, job.id, &idle).unwrap(), Outcome::Done);
    assert!(output.is_file());
    assert!(!output.with_extension("mp4.part").exists());
    let rendered = probe
        .inspect(&output, &MediaFormat::for_path(&output).unwrap())
        .unwrap();
    let duration = rendered.duration_ms.unwrap();
    assert!((5400..=5600).contains(&duration), "duration {duration} ms");
    assert_eq!(
        (rendered.kind, rendered.width, rendered.height),
        ("video", Some(640), Some(360))
    );
    assert_eq!(rendered.codec.as_deref(), Some("h264"));
    assert_eq!(rendered.frame_rate, Some(30.0));
    let audio_codec = Command::new(&ffprobe)
        .args([
            "-v",
            "error",
            "-select_streams",
            "a:0",
            "-show_entries",
            "stream=codec_name",
            "-of",
            "csv=p=0",
        ])
        .arg(&output)
        .output()
        .unwrap();
    assert_eq!(String::from_utf8_lossy(&audio_codec.stdout).trim(), "aac");

    // A finished job is not runnable again, a canceled one leaves no file behind.
    assert!(execute(&store, job.id, &idle).is_err());
    let second = output.with_file_name("Hủy.mp4");
    let canceled = store
        .create_render_job(project.id, &saved, second.to_str().unwrap())
        .unwrap();
    assert_eq!(
        execute(&store, canceled.id, &AtomicBool::new(true)).unwrap(),
        Outcome::Canceled
    );
    assert!(!second.exists() && !second.with_extension("mp4.part").exists());

    // Writing over a source in the timeline is refused before FFmpeg starts.
    let source = root.join("Video mẫu.mp4");
    let bytes = fs::metadata(&source).unwrap().len();
    let overwrite = store
        .create_render_job(project.id, &saved, source.to_str().unwrap())
        .unwrap();
    assert!(execute(&store, overwrite.id, &idle).is_err());
    assert_eq!(fs::metadata(&source).unwrap().len(), bytes);
}

#[test]
#[ignore = "requires FFmpeg with drawtext and FFprobe installed on PATH"]
fn real_ffmpeg_analyzes_cuts_and_exports_layers_with_text_and_color() {
    use crate::timeline::{Look, Motion, TitleColor, TitleEdit};
    let dir = tempfile::tempdir().unwrap();
    let media = dir.path().join("media");
    fs::create_dir(&media).unwrap();
    let ffmpeg = find_tool("ffmpeg").expect("ffmpeg on PATH");
    let ffprobe = find_tool("ffprobe").expect("ffprobe on PATH");
    let generate = |args: &[&str], name: &str| {
        let status = Command::new(&ffmpeg)
            .args(["-hide_banner", "-loglevel", "error"])
            .args(args)
            .arg(media.join(name))
            .status()
            .unwrap();
        assert!(status.success());
    };
    generate(
        &[
            "-f",
            "lavfi",
            "-i",
            "color=black:s=320x180:r=30:d=1",
            "-f",
            "lavfi",
            "-i",
            "color=white:s=320x180:r=30:d=1",
            "-filter_complex",
            "[0:v][1:v]concat=n=2:v=1:a=0",
            "-c:v",
            "libx264",
            "-threads",
            "1",
            "-pix_fmt",
            "yuv420p",
        ],
        "reference.mp4",
    );
    generate(
        &[
            "-f",
            "lavfi",
            "-i",
            "color=red:s=320x180:r=30:d=2",
            "-c:v",
            "libx264",
            "-threads",
            "1",
            "-pix_fmt",
            "yuv420p",
        ],
        "overlay.mp4",
    );
    generate(
        &[
            "-f",
            "lavfi",
            "-i",
            "sine=frequency=330:duration=2",
            "-c:a",
            "pcm_s16le",
        ],
        "sound.wav",
    );

    let root = selected_root(&media).unwrap();
    let db = dir.path().join("test.sqlite3");
    let store = Store::open(&db).unwrap();
    let folder = store.grant(root.to_str().unwrap()).unwrap();
    let probe = Ffprobe {
        binary: ffprobe,
        ffmpeg: None,
    };
    assert_eq!(scan(&store, folder, &probe).unwrap().indexed, 3);
    let assets = store.assets(Some(folder), 0).unwrap().items;
    let id = |name: &str| {
        assets
            .iter()
            .find(|asset| asset.relative_path == name)
            .unwrap()
            .id
    };
    let template = crate::templates::analyze(&store, id("reference.mp4"), "Mẫu thử").unwrap();
    assert_eq!(template.template.scene_ms, [1000, 1000]);

    let top = ClipEdit {
        layer: 1,
        look: Look {
            saturation: 0,
            scale: 50,
            fade_ms: 150,
            motion: Motion::Slide,
            ..Look::default()
        },
        ..clip(id("overlay.mp4"), 0, 1500, 0)
    };
    let sound = id("sound.wav");
    let mut edits = snapshot(
        vec![clip(id("reference.mp4"), 0, 2000, 0), top],
        vec![
            clip(sound, 0, 2000, 0),
            ClipEdit {
                layer: 1,
                ..clip(sound, 0, 1000, 0)
            },
        ],
    );
    edits.titles.push(TitleEdit {
        text: "Tiếng Việt: 100% ${x}".into(),
        position_ms: 400,
        duration_ms: 500,
        layer: 0,
        size: 10,
        x: 0,
        y: 82,
        color: TitleColor::White,
    });
    let project = store
        .create_project_with_timeline("Bản dựng", Some(&edits))
        .unwrap();
    drop(store);
    let store = Store::open(&db).unwrap();
    assert_eq!(store.snapshot(project.id).unwrap(), edits);
    assert_eq!(
        store.templates().unwrap()[0].template.scene_ms,
        [1000, 1000]
    );
    let output = dunce::canonicalize(dir.path())
        .unwrap()
        .join("Video đã dựng.mp4");
    let job = store
        .create_render_job(project.id, &edits, output.to_str().unwrap())
        .unwrap();
    assert_eq!(
        execute(&store, job.id, &AtomicBool::new(false)).unwrap(),
        Outcome::Done
    );
    let frame = Command::new(&ffmpeg)
        .args(["-hide_banner", "-loglevel", "error", "-ss", "0.65", "-i"])
        .arg(&output)
        .args([
            "-frames:v",
            "1",
            "-f",
            "rawvideo",
            "-pix_fmt",
            "rgb24",
            "pipe:1",
        ])
        .output()
        .unwrap();
    assert!(
        frame.status.success(),
        "{}",
        String::from_utf8_lossy(&frame.stderr)
    );
    assert_eq!(frame.stdout.len(), 320 * 180 * 3);
    let center = &frame.stdout[(90 * 320 + 160) * 3..][..3];
    assert!(
        center.iter().all(|value| (50..105).contains(value)),
        "{center:?}"
    );
    assert!(frame.stdout[(4 * 320 + 4) * 3] < 8);
    assert!(
        frame.stdout[140 * 320 * 3..]
            .iter()
            .filter(|value| **value > 220)
            .count()
            > 100
    );

    assert!(
        store
            .set_render_status(job.id, &["running"], "done", None)
            .unwrap()
    );
    let response = serve(
        &store,
        Request::builder()
            .uri(format!("http://studio-media.localhost/render-{}", job.id))
            .header(header::RANGE, "bytes=0-15")
            .body(Vec::new())
            .unwrap(),
    );
    assert_eq!(response.status(), StatusCode::PARTIAL_CONTENT);
    assert!(response.body().windows(4).any(|bytes| bytes == b"ftyp"));
}
