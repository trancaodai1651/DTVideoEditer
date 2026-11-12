use std::{cell::Cell, fs, path::Path, process::Command, sync::atomic::AtomicBool};

use tauri::http::{Request, StatusCode, header};

use crate::{
    library::{authorized_file, scan, selected_root},
    preview::serve,
    probe::{Ffprobe, MediaFormat, MediaProbe, Metadata, find_tool},
    render::{Outcome, execute},
    store::{DerivedPreview, Store},
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
        lanes: Vec::new(),
        export_range: None,
        adjustments: Vec::new(),
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
fn exact_import_preserves_id_reopens_and_rejects_siblings() {
    let dir = tempfile::tempdir().unwrap();
    let original = dir.path().join("ảnh thử.mp4");
    let sibling = dir.path().join("khác.mp4");
    let unsupported = dir.path().join("notes.txt");
    fs::write(&original, b"0123456789").unwrap();
    fs::write(&sibling, b"ungranted").unwrap();
    fs::write(&unsupported, b"text").unwrap();
    let db = dir.path().join("studio.sqlite3");
    let store = Store::open(&db).unwrap();
    let probe = CountingProbe(Cell::new(0));
    let report = crate::library::import_files(
        &store,
        &[original.clone(), unsupported, original.clone()],
        &probe,
    )
    .unwrap();
    assert_eq!(report.skipped, 1);
    assert_eq!(report.assets.len(), 1);
    let asset = &report.assets[0];
    assert!(store.folders().unwrap()[0].file_only);
    assert_eq!(
        crate::library::import_files(&store, std::slice::from_ref(&original), &probe)
            .unwrap()
            .assets[0]
            .id,
        asset.id
    );
    assert_eq!(probe.0.get(), 1);
    drop(store);

    let store = Store::open(&db).unwrap();
    let mut source = store.source(asset.id, false).unwrap().unwrap();
    assert!(source.file_only);
    assert!(crate::library::authorized_asset(&source).is_ok());
    source.relative_path = "khác.mp4".into();
    assert!(crate::library::authorized_asset(&source).is_err());
    let request = || {
        Request::builder()
            .uri(format!("http://studio-media.localhost/source-{}", asset.id))
            .header(header::RANGE, "bytes=2-4")
            .body(Vec::new())
            .unwrap()
    };
    assert_eq!(serve(&store, request()).body(), b"234");
    store.revoke(asset.folder_id).unwrap();
    assert_eq!(serve(&store, request()).status(), StatusCode::NOT_FOUND);
    assert_eq!(fs::read(original).unwrap(), b"0123456789");
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
            "color=c=royalblue:s=320x180:r=24:d=1,drawbox=color=red:t=fill:enable='gte(t,0.5)'",
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
        ffmpeg: Some(ffmpeg.clone()),
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
    let strip = serve(
        &store,
        Request::builder()
            .uri(format!("/filmstrip-{}", video.id))
            .body(Vec::new())
            .unwrap(),
    );
    assert_eq!(strip.status(), StatusCode::OK);
    let jpeg = dir.path().join("filmstrip.jpg");
    fs::write(&jpeg, strip.body()).unwrap();
    let pixels = Command::new(&ffmpeg)
        .args(["-v", "error", "-i"])
        .arg(jpeg)
        .args([
            "-f", "rawvideo", "-pix_fmt", "rgb24", "-threads", "1", "pipe:1",
        ])
        .output()
        .unwrap();
    assert!(pixels.status.success());
    assert_eq!(pixels.stdout.len(), 768 * 54 * 3);
    let blue = (27 * 768 + 48) * 3;
    let red = (27 * 768 + 720) * 3;
    assert!(pixels.stdout[blue + 2] > pixels.stdout[blue] + 80);
    assert!(pixels.stdout[red] > pixels.stdout[red + 2] + 80);
    let project = store.create_project("Smoke test").unwrap();
    let mut saved = snapshot(
        vec![clip(video.id, 0, 1000, 0), clip(image.id, 0, 3000, 1000)],
        vec![clip(audio.id, 0, 1000, 0)],
    );
    saved.lanes.push(crate::timeline::LaneControl {
        track: "audio".into(),
        layer: 0,
        muted: true,
        locked: true,
        hidden: false,
    });
    store.save_timeline(project.id, &saved).unwrap();
    assert_eq!(store.snapshot(project.id).unwrap(), saved);
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
        caption: false,
        background: false,
        edit_group: None,
        ..Default::default()
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

#[test]
#[ignore = "requires FFmpeg with drawtext and FFprobe installed on PATH"]
fn real_ffmpeg_exports_speed_keying_stickers_and_captions() {
    use crate::timeline::{Effect, KeyColor, Look, TitleColor, TitleEdit};

    let dir = tempfile::tempdir().unwrap();
    let media = dir.path().join("media");
    fs::create_dir(&media).unwrap();
    let ffmpeg = find_tool("ffmpeg").expect("ffmpeg on PATH");
    let ffprobe = find_tool("ffprobe").expect("ffprobe on PATH");
    for (name, video) in [
        ("base.mp4", "color=blue:s=320x180:r=30:d=3"),
        (
            "overlay.mp4",
            "color=0x00ff00:s=320x180:r=24:d=3,drawbox=x=100:y=60:w=120:h=60:c=red:t=fill",
        ),
    ] {
        let status = Command::new(&ffmpeg)
            .args([
                "-v", "error", "-f", "lavfi", "-i", video, "-c:v", "libx264", "-threads", "1",
                "-pix_fmt", "yuv420p",
            ])
            .arg(media.join(name))
            .status()
            .unwrap();
        assert!(status.success());
    }

    let root = selected_root(&media).unwrap();
    let store = Store::open(&dir.path().join("test.sqlite3")).unwrap();
    let folder = store.grant(root.to_str().unwrap()).unwrap();
    let probe = Ffprobe {
        binary: ffprobe,
        ffmpeg: None,
    };
    assert_eq!(scan(&store, folder, &probe).unwrap().indexed, 2);
    let assets = store.assets(Some(folder), 0).unwrap().items;
    let id = |name: &str| {
        assets
            .iter()
            .find(|asset| asset.relative_path == name)
            .unwrap()
            .id
    };
    let catalog = crate::catalog::load(&store, dir.path()).unwrap();
    let stock_id = |name: &str| {
        catalog
            .iter()
            .find(|item| item.asset.relative_path == name)
            .unwrap()
            .asset
            .id
    };
    let mut edits = snapshot(
        vec![
            clip(id("base.mp4"), 0, 3000, 0),
            ClipEdit {
                layer: 1,
                look: Look {
                    speed: 150,
                    key_color: KeyColor::Green,
                    ellipse: true,
                    rotate: 8,
                    denoise: true,
                    sharpen: true,
                    stabilize: true,
                    optical_flow: true,
                    effect: Effect::Grain,
                    ..Look::default()
                },
                ..clip(id("overlay.mp4"), 0, 3000, 0)
            },
            ClipEdit {
                layer: 2,
                look: Look {
                    scale: 50,
                    ..Look::default()
                },
                ..clip(stock_id("gold-star.png"), 0, 700, 2100)
            },
        ],
        vec![ClipEdit {
            look: Look {
                speed: 150,
                clean_audio: true,
                ..Look::default()
            },
            ..clip(stock_id("soft-steps.wav"), 0, 1500, 0)
        }],
    );
    edits.titles.push(TitleEdit {
        text: "Phụ đề thử".into(),
        position_ms: 400,
        duration_ms: 500,
        layer: 0,
        size: 10,
        x: 0,
        y: 80,
        color: TitleColor::White,
        caption: true,
        background: true,
        edit_group: None,
        ..Default::default()
    });
    let project = store
        .create_project_with_timeline("Thử thư viện", Some(&edits))
        .unwrap();
    assert_eq!(store.snapshot(project.id).unwrap(), edits);
    let output = dunce::canonicalize(dir.path()).unwrap().join("export.mp4");
    let job = store
        .create_render_job(project.id, &edits, output.to_str().unwrap())
        .unwrap();
    assert_eq!(
        execute(&store, job.id, &AtomicBool::new(false)).unwrap(),
        Outcome::Done
    );

    let frame = |seconds: &str| {
        let result = Command::new(&ffmpeg)
            .args(["-v", "error", "-ss", seconds, "-i"])
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
            result.status.success(),
            "{}",
            String::from_utf8_lossy(&result.stderr)
        );
        assert_eq!(result.stdout.len(), 320 * 180 * 3);
        result.stdout
    };
    let pixel = |bytes: &[u8], x: usize, y: usize| -> [u8; 3] {
        bytes[(y * 320 + x) * 3..][..3].try_into().unwrap()
    };
    let blue = |[r, g, b]: [u8; 3]| r < 35 && g < 35 && b > 210;
    let keyed = frame("0.65");
    let [r, g, b] = pixel(&keyed, 160, 90);
    assert!(r > 180 && g < 70 && b < 70, "{r}, {g}, {b}");
    assert!(blue(pixel(&keyed, 70, 90)));
    assert!(
        keyed[140 * 320 * 3..]
            .chunks_exact(3)
            .filter(|rgb| rgb.iter().all(|v| *v > 210))
            .count()
            > 60
    );
    assert!(blue(pixel(&frame("2.03"), 160, 90)));
    let sticker = frame("2.4");
    let [r, g, b] = pixel(&sticker, 160, 90);
    assert!(r > 180 && g > 120 && b < 120, "{r}, {g}, {b}");
    assert!(blue(pixel(&sticker, 120, 50)));
}

#[test]
#[ignore = "requires FFmpeg and FFprobe installed on PATH"]
fn real_ffmpeg_exports_keyframes_and_transitions_with_in_out() {
    use crate::timeline::{ClipTransition, ExportRange, Look, TransformKey, TransitionKind};

    let dir = tempfile::tempdir().unwrap();
    let ffmpeg = find_tool("ffmpeg").expect("ffmpeg on PATH");
    let ffprobe = find_tool("ffprobe").expect("ffprobe on PATH");
    let paths: Vec<_> = ["red", "blue"]
        .into_iter()
        .map(|color| {
            let path = dir.path().join(format!("{color}.mp4"));
            let status = Command::new(&ffmpeg)
                .args(["-v", "error", "-f", "lavfi", "-i"])
                .arg(format!("color={color}:s=320x180:r=30:d=1"))
                .args([
                    "-f",
                    "lavfi",
                    "-i",
                    "sine=frequency=440:duration=1",
                    "-c:v",
                    "libx264",
                    "-threads",
                    "1",
                    "-pix_fmt",
                    "yuv420p",
                    "-c:a",
                    "aac",
                ])
                .arg(&path)
                .status()
                .unwrap();
            assert!(status.success());
            path
        })
        .collect();
    let store = Store::open(&dir.path().join("test.sqlite3")).unwrap();
    let probe = Ffprobe {
        binary: ffprobe.clone(),
        ffmpeg: None,
    };
    let imported = crate::library::import_files(&store, &paths, &probe).unwrap();
    assert_eq!(imported.skipped, 0);
    let red = imported.assets[0].id;
    let blue = imported.assets[1].id;
    let stock = crate::catalog::load(&store, dir.path()).unwrap();
    let star = stock
        .iter()
        .find(|item| item.asset.relative_path == "gold-star.png")
        .unwrap()
        .asset
        .id;
    let response = serve(
        &store,
        Request::builder()
            .uri(format!("/waveform-{red}"))
            .body(Vec::new())
            .unwrap(),
    );
    assert_eq!(response.status(), StatusCode::OK);
    assert!(response.body().starts_with(b"\x89PNG\r\n\x1a\n"));
    assert!(
        store
            .derived_preview(red, DerivedPreview::Waveform)
            .unwrap()
            .is_some()
    );
    let response = serve(
        &store,
        Request::builder()
            .uri(format!("/filmstrip-{red}"))
            .body(Vec::new())
            .unwrap(),
    );
    assert_eq!(response.status(), StatusCode::OK);
    assert!(response.body().starts_with(b"\xff\xd8\xff"));
    assert_eq!(
        store
            .derived_preview(red, DerivedPreview::Filmstrip)
            .unwrap()
            .as_deref(),
        Some(response.body().as_slice())
    );

    for (name, kind) in [
        ("dissolve", TransitionKind::Dissolve),
        ("black", TransitionKind::Black),
    ] {
        let mut edits = snapshot(
            vec![
                clip(red, 0, 1000, 0),
                ClipEdit {
                    look: Look {
                        transition: Some(ClipTransition {
                            kind,
                            duration_ms: 400,
                            from_asset_id: red,
                            from_start_ms: 0,
                        }),
                        ..Look::default()
                    },
                    ..clip(blue, 0, 1000, 1000)
                },
                ClipEdit {
                    layer: 1,
                    look: Look {
                        keyframes: vec![
                            TransformKey {
                                at_ms: 0,
                                x: -20,
                                y: 0,
                                scale: 20,
                                rotate: 0,
                                opacity: 100,
                                smooth: false,
                            },
                            TransformKey {
                                at_ms: 500,
                                x: 20,
                                y: 0,
                                scale: 60,
                                rotate: 25,
                                opacity: 85,
                                smooth: true,
                            },
                        ],
                        ..Look::default()
                    },
                    ..clip(star, 0, 500, 1500)
                },
            ],
            Vec::new(),
        );
        let project = store
            .create_project_with_timeline(name, Some(&edits))
            .unwrap();
        edits.export_range = Some(ExportRange {
            start_ms: 800,
            end_ms: 1900,
        });
        let output = dunce::canonicalize(dir.path())
            .unwrap()
            .join(format!("{name}.mp4"));
        let job = store
            .create_render_job(project.id, &edits, output.to_str().unwrap())
            .unwrap();
        assert_eq!(
            execute(&store, job.id, &AtomicBool::new(false)).unwrap(),
            Outcome::Done
        );
        let metadata = Command::new(&ffprobe)
            .args([
                "-v",
                "error",
                "-show_entries",
                "format=duration:stream=codec_type",
                "-of",
                "json",
            ])
            .arg(&output)
            .output()
            .unwrap();
        assert!(metadata.status.success());
        let metadata: serde_json::Value = serde_json::from_slice(&metadata.stdout).unwrap();
        let duration: f64 = metadata["format"]["duration"]
            .as_str()
            .unwrap()
            .parse()
            .unwrap();
        assert!((duration - 1.1).abs() < 0.06, "{duration}");
        assert!(
            metadata["streams"]
                .as_array()
                .unwrap()
                .iter()
                .any(|stream| stream["codec_type"] == "audio")
        );

        let sample = |time: &str, x: usize| {
            let frame = Command::new(&ffmpeg)
                .args(["-v", "error", "-ss", time, "-i"])
                .arg(&output)
                .args([
                    "-frames:v",
                    "1",
                    "-f",
                    "rawvideo",
                    "-pix_fmt",
                    "rgb24",
                    "-threads",
                    "1",
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
            let offset = (90 * 320 + x) * 3;
            [
                frame.stdout[offset],
                frame.stdout[offset + 1],
                frame.stdout[offset + 2],
            ]
        };
        let [r, g, b] = sample(if name == "dissolve" { "0.4" } else { "0.2" }, 160);
        if name == "dissolve" {
            assert!(r > 55 && g < 35 && b > 55, "dissolve: {r}, {g}, {b}");
        } else {
            assert!(r < 45 && g < 35 && b < 45, "black join: {r}, {g}, {b}");
        }
        let [r, g, b] = sample("0.93", 155);
        assert!(
            r > 135 && g > 90 && b < 140,
            "keyframed star: {r}, {g}, {b}"
        );
    }
}

#[test]
#[ignore = "requires FFmpeg and FFprobe installed on PATH"]
fn real_ffmpeg_measures_tracks_and_exports_curves_with_detached_audio() {
    use crate::analysis::{Region, levels, scene_cuts, track};
    use crate::timeline::SpeedPoint;

    let dir = tempfile::tempdir().unwrap();
    let ffmpeg = find_tool("ffmpeg").expect("ffmpeg on PATH");
    let ffprobe = find_tool("ffprobe").expect("ffprobe on PATH");
    let make = |name: &str, graph: &str| {
        let path = dir.path().join(name);
        let status = Command::new(&ffmpeg)
            .args([
                "-v",
                "error",
                "-filter_complex",
                graph,
                "-map",
                "[v]",
                "-map",
                "[a]",
            ])
            .args([
                "-c:v", "libx264", "-threads", "1", "-pix_fmt", "yuv420p", "-c:a", "aac", "-t", "2",
            ])
            .arg(&path)
            .status()
            .unwrap();
        assert!(status.success(), "{name}");
        path
    };
    // Red then blue, with silence from 0.5 s to 1.5 s.
    let cuts = make(
        "cuts.mp4",
        "color=red:s=320x180:r=30:d=1[r];color=blue:s=320x180:r=30:d=1[b];[r][b]concat=n=2:v=1:a=0[v];\
         sine=frequency=440:duration=2,volume=enable='between(t,0.5,1.5)':volume=0[a]",
    );
    // A white square moving right at 60 px/s on grey.
    let moving = make(
        "moving.mp4",
        "color=gray:s=320x180:r=30:d=2[bg];color=white:s=30x30:r=30:d=2[box];[bg][box]overlay=x='40+t*60':y=60:shortest=1[v];\
         sine=frequency=330:duration=2[a]",
    );
    let store = Store::open(&dir.path().join("test.sqlite3")).unwrap();
    let probe = Ffprobe {
        binary: ffprobe.clone(),
        ffmpeg: None,
    };
    let imported = crate::library::import_files(&store, &[cuts, moving], &probe).unwrap();
    let (cuts, moving) = (imported.assets[0].id, imported.assets[1].id);

    let loudness = levels(&store, cuts).unwrap();
    assert!((38..=42).contains(&loudness.len()), "{}", loudness.len());
    assert!(
        loudness[14..26].iter().all(|level| *level < 40),
        "{loudness:?}"
    );
    assert!(
        loudness[2..8].iter().all(|level| *level > 150),
        "{loudness:?}"
    );
    assert_eq!(
        store.derived_preview(cuts, DerivedPreview::Levels).unwrap(),
        Some(loudness)
    );

    let scenes = scene_cuts(&store, cuts, 0, 2000, 32).unwrap();
    assert_eq!(scenes.len(), 1, "{scenes:?}");
    assert!((scenes[0] - 1000).abs() <= 80, "{scenes:?}");

    let region = Region {
        x: 125,
        y: 333,
        width: 94,
        height: 167,
    };
    let points = track(&store, moving, 0, 2000, region).unwrap();
    assert!(points.len() >= 18, "{}", points.len());
    for point in &points {
        let expected = (55.0 + point.at_ms as f64 * 0.06) * 1000.0 / 320.0;
        assert!(
            (f64::from(point.x) - expected).abs() <= 40.0,
            "{point:?} vs {expected}"
        );
        assert!((i64::from(point.y) - 417).abs() <= 40, "{point:?}");
    }

    // A curved picture with its sound detached to Audio 1, and a disabled clip after it.
    let mut picture = clip(cuts, 0, 2000, 0);
    picture.look.speed_curve = vec![
        SpeedPoint { at: 0, speed: 50 },
        SpeedPoint {
            at: 1000,
            speed: 200,
        },
    ];
    picture.look.audio_detached = true;
    picture.look.audio_link = Some(1);
    let mut sound = picture.clone();
    sound.look.audio_detached = false;
    let length = picture.length_ms();
    let mut off = clip(moving, 0, 1000, length);
    off.look.disabled = true;
    let edits = snapshot(vec![picture, off], vec![sound]);
    let project = store.create_project("Đường cong").unwrap();
    store.save_timeline(project.id, &edits).unwrap();
    let saved = store.snapshot(project.id).unwrap();
    assert_eq!(saved.tracks[1].clips[0].look.audio_link, Some(1));
    let output = dunce::canonicalize(dir.path()).unwrap().join("curve.mp4");
    let job = store
        .create_render_job(project.id, &saved, output.to_str().unwrap())
        .unwrap();
    assert_eq!(
        execute(&store, job.id, &AtomicBool::new(false)).unwrap(),
        Outcome::Done
    );
    let metadata = Command::new(&ffprobe)
        .args([
            "-v",
            "error",
            "-show_entries",
            "format=duration:stream=codec_type,duration",
            "-of",
            "json",
        ])
        .arg(&output)
        .output()
        .unwrap();
    let metadata: serde_json::Value = serde_json::from_slice(&metadata.stdout).unwrap();
    let duration: f64 = metadata["format"]["duration"]
        .as_str()
        .unwrap()
        .parse()
        .unwrap();
    let expected = (length + 1000) as f64 / 1000.0;
    assert!(
        (duration - expected).abs() < 0.08,
        "{duration} vs {expected}"
    );
    let streams = metadata["streams"].as_array().unwrap();
    let audio = streams
        .iter()
        .find(|stream| stream["codec_type"] == "audio")
        .unwrap();
    let audio_length: f64 = audio["duration"].as_str().unwrap().parse().unwrap();
    assert!((audio_length - expected).abs() < 0.1, "{audio_length}");
}

#[test]
#[ignore = "requires FFmpeg with drawtext and FFprobe installed on PATH"]
fn real_ffmpeg_grades_freezes_reverses_and_syncs_audio() {
    use crate::analysis::audio_offset;
    use crate::timeline::{AdjustmentEdit, Look, TitleAlign, TitleEdit, TitleFont};

    let dir = tempfile::tempdir().unwrap();
    let ffmpeg = find_tool("ffmpeg").expect("ffmpeg on PATH");
    let ffprobe = find_tool("ffprobe").expect("ffprobe on PATH");
    let make = |name: &str, graph: &str, seconds: &str| {
        let path = dir.path().join(name);
        let status = Command::new(&ffmpeg)
            .args([
                "-v",
                "error",
                "-filter_complex",
                graph,
                "-map",
                "[v]",
                "-map",
                "[a]",
            ])
            .args([
                "-c:v", "libx264", "-threads", "1", "-pix_fmt", "yuv444p", "-crf", "8", "-c:a",
                "aac", "-t", seconds,
            ])
            .arg(&path)
            .status()
            .unwrap();
        assert!(status.success(), "{name}");
        path
    };
    // Red for the first second, blue for the second.
    let colours = make(
        "colours.mp4",
        "color=red:s=320x180:r=30:d=1[r];color=blue:s=320x180:r=30:d=1[b];[r][b]concat=n=2:v=1:a=0[v];sine=frequency=440:duration=2[a]",
        "2",
    );
    // The same beep pattern, the second take starting 0.7 s later.
    let beeps = "sine=frequency=880:duration=6,volume='between(t,0.3,0.4)+between(t,1.0,1.08)+between(t,2.2,2.35)+between(t,2.6,2.65)+between(t,4.1,4.3)':eval=frame";
    let take_a = make(
        "take-a.mp4",
        &format!("color=gray:s=320x180:r=30:d=6[v];{beeps}[a]"),
        "6",
    );
    let take_b = make(
        "take-b.mp4",
        &format!("color=gray:s=320x180:r=30:d=6[v];{beeps},adelay=700:all=1[a]"),
        "6",
    );
    let store = Store::open(&dir.path().join("test.sqlite3")).unwrap();
    let probe = Ffprobe {
        binary: ffprobe.clone(),
        ffmpeg: None,
    };
    let imported =
        crate::library::import_files(&store, &[colours, take_a, take_b], &probe).unwrap();
    let id = |name: &str| {
        imported
            .assets
            .iter()
            .find(|asset| asset.relative_path.ends_with(name))
            .unwrap()
            .id
    };
    let (colours, take_a, take_b) = (id("colours.mp4"), id("take-a.mp4"), id("take-b.mp4"));

    let offset = audio_offset(&store, take_a, 0, take_b, 0).unwrap();
    assert!((offset - 700).abs() <= 20, "offset {offset}");

    // An inverting LUT turns red into cyan.
    let mut cube = String::from("LUT_3D_SIZE 2\n");
    for index in 0..8 {
        cube.push_str(&format!(
            "{} {} {}\n",
            1 - (index & 1),
            1 - ((index >> 1) & 1),
            1 - ((index >> 2) & 1)
        ));
    }
    crate::voice::validate_cube(&cube).unwrap();
    let lut = store.insert_lut("Đảo màu", &cube).unwrap();

    let mut reversed = clip(colours, 0, 2000, 0);
    reversed.look.reverse = true;
    let mut frozen = clip(colours, 0, 1000, 2000);
    frozen.look.freeze_at_ms = Some(1500);
    let mut inverted = clip(colours, 0, 1000, 3000);
    inverted.look.lut = Some(lut);
    let mut bright = clip(colours, 0, 1000, 4000);
    bright.look.exposure = 100;
    bright.look.hue = 120;
    let mut edits = snapshot(vec![reversed, frozen, inverted, bright], vec![]);
    edits.adjustments.push(AdjustmentEdit {
        position_ms: 4500,
        duration_ms: 500,
        layer: 0,
        look: Look {
            saturation: 0,
            ..Look::default()
        },
    });
    edits.titles.push(TitleEdit {
        text: "Chữ đậm".into(),
        position_ms: 0,
        duration_ms: 1000,
        size: 8,
        y: 80,
        font: TitleFont::Bold,
        color_hex: Some("#00ff00".into()),
        stroke_hex: Some("#000000".into()),
        stroke_width: Some(4),
        background_hex: Some("#202020".into()),
        background_opacity: Some(70),
        align: TitleAlign::Left,
        shadow: true,
        fade_ms: Some(200),
        line_spacing: Some(4),
        ..Default::default()
    });
    let project = store.create_project("Màu sắc").unwrap();
    store.save_timeline(project.id, &edits).unwrap();
    let saved = store.snapshot(project.id).unwrap();
    assert_eq!(saved.adjustments.len(), 1);
    assert_eq!(saved.titles[0].font, TitleFont::Bold);
    let output = dunce::canonicalize(dir.path()).unwrap().join("grade.mp4");
    let job = store
        .create_render_job(project.id, &saved, output.to_str().unwrap())
        .unwrap();
    assert_eq!(
        execute(&store, job.id, &AtomicBool::new(false)).unwrap(),
        Outcome::Done
    );

    let frame = |seconds: &str| {
        let result = Command::new(&ffmpeg)
            .args(["-v", "error", "-ss", seconds, "-i"])
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
        assert!(result.status.success());
        result.stdout
    };
    let pixel =
        |bytes: &[u8]| -> [u8; 3] { bytes[(40 * 320 + 160) * 3..][..3].try_into().unwrap() };
    let near = |[r, g, b]: [u8; 3], [er, eg, eb]: [u8; 3]| {
        (i32::from(r) - i32::from(er)).abs() < 50
            && (i32::from(g) - i32::from(eg)).abs() < 50
            && (i32::from(b) - i32::from(eb)).abs() < 50
    };
    let start = pixel(&frame("0.2"));
    assert!(
        near(start, [0, 0, 255]),
        "reverse starts on the blue half: {start:?}"
    );
    let late = pixel(&frame("1.7"));
    assert!(near(late, [255, 0, 0]), "and ends on red: {late:?}");
    for at in ["2.1", "2.9"] {
        let held = pixel(&frame(at));
        assert!(
            near(held, [0, 0, 255]),
            "freeze holds the blue frame at {at}: {held:?}"
        );
    }
    let cyan = pixel(&frame("3.4"));
    assert!(near(cyan, [0, 255, 255]), "LUT inverts red: {cyan:?}");
    let shifted = pixel(&frame("4.2"));
    assert!(
        shifted[1] > 150 && shifted[0] < 120,
        "hue 120 moves red towards green: {shifted:?}"
    );
    let grey = pixel(&frame("4.7"));
    let spread = grey.iter().max().unwrap() - grey.iter().min().unwrap();
    assert!(spread < 25, "the adjustment layer removes colour: {grey:?}");
}
