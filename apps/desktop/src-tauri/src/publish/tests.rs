//! Adapter tests against a local HTTP server that plays the platform.
//! They pin request shapes to the official contracts and never touch the network.

use std::{
    collections::HashMap,
    fs,
    io::{Read, Write},
    net::{TcpListener, TcpStream},
    path::Path,
    sync::{
        Arc, Mutex,
        atomic::{AtomicUsize, Ordering},
    },
    thread,
    time::Duration,
};

use serde_json::{Value, json};

use super::{
    ConnectInput, DraftInput, FACEBOOK_LOGIN, INSTAGRAM_LOGIN, Platform, Publisher, check_draft,
    http::{Api, Endpoints},
    secrets::{self, MemorySecrets},
    tiktok::chunk_plan,
};
use crate::{
    library::selected_root,
    store::Store,
    timeline::{ClipEdit, TimelineSnapshot, TrackEdit},
};

#[derive(Clone)]
struct Call {
    method: String,
    path: String,
    query: String,
    headers: HashMap<String, String>,
    body: Vec<u8>,
}

impl Call {
    fn text(&self) -> String {
        String::from_utf8_lossy(&self.body).into_owned()
    }

    fn is(&self, method: &str, path: &str) -> bool {
        self.method == method && self.path == path
    }
}

struct Mock {
    url: String,
    log: Arc<Mutex<Vec<Call>>>,
}

fn position(data: &[u8], needle: &[u8]) -> Option<usize> {
    data.windows(needle.len())
        .position(|window| window == needle)
}

fn read_call(stream: &mut TcpStream) -> Option<Call> {
    let mut data = Vec::new();
    let mut chunk = [0; 64 * 1024];
    let mut more = |data: &mut Vec<u8>| -> Option<()> {
        let read = stream.read(&mut chunk).ok().filter(|read| *read > 0)?;
        data.extend_from_slice(&chunk[..read]);
        Some(())
    };
    let end = loop {
        if let Some(end) = position(&data, b"\r\n\r\n") {
            break end;
        }
        more(&mut data)?;
    };
    let head = String::from_utf8_lossy(&data[..end]).into_owned();
    let mut lines = head.split("\r\n");
    let mut request = lines.next()?.split(' ');
    let (method, target) = (request.next()?, request.next()?);
    let headers: HashMap<String, String> = lines
        .filter_map(|line| line.split_once(':'))
        .map(|(name, value)| (name.trim().to_ascii_lowercase(), value.trim().to_owned()))
        .collect();
    let mut body = data.split_off(end + 4);
    if let Some(length) = headers
        .get("content-length")
        .and_then(|value| value.parse::<usize>().ok())
    {
        while body.len() < length {
            more(&mut body)?;
        }
    } else if headers.contains_key("transfer-encoding") {
        while !body.ends_with(b"0\r\n\r\n") {
            more(&mut body)?;
        }
        let mut decoded = Vec::new();
        let mut rest = body.as_slice();
        while let Some(line) = position(rest, b"\r\n") {
            let size =
                usize::from_str_radix(String::from_utf8_lossy(&rest[..line]).trim(), 16).ok()?;
            if size == 0 {
                break;
            }
            decoded.extend_from_slice(&rest[line + 2..line + 2 + size]);
            rest = &rest[line + 4 + size..];
        }
        body = decoded;
    }
    let (path, query) = target.split_once('?').unwrap_or((target, ""));
    Some(Call {
        method: method.to_owned(),
        path: path.to_owned(),
        query: query.to_owned(),
        headers,
        body,
    })
}

impl Mock {
    /// `respond` gets the call and the server's own base URL (for upload URLs).
    fn start(respond: impl Fn(&Call, &str) -> (u16, Value) + Send + 'static) -> Self {
        let listener = TcpListener::bind("127.0.0.1:0").unwrap();
        let url = format!("http://{}", listener.local_addr().unwrap());
        let log = Arc::new(Mutex::new(Vec::new()));
        let (base, seen) = (url.clone(), Arc::clone(&log));
        thread::spawn(move || {
            for mut stream in listener.incoming().flatten() {
                let Some(call) = read_call(&mut stream) else {
                    continue;
                };
                let (status, body) = respond(&call, &base);
                seen.lock().unwrap().push(call);
                let body = if body.is_null() {
                    String::new()
                } else {
                    body.to_string()
                };
                let _ = write!(
                    stream,
                    "HTTP/1.1 {status} Mock\r\nContent-Type: application/json\r\nContent-Length: {}\r\nConnection: close\r\n\r\n{body}",
                    body.len()
                );
            }
        });
        Self { url, log }
    }

    fn calls(&self) -> Vec<String> {
        let log = self.log.lock().unwrap();
        log.iter()
            .map(|call| format!("{} {}", call.method, call.path))
            .collect()
    }

    fn call(&self, method: &str, path: &str) -> Call {
        let log = self.log.lock().unwrap();
        log.iter()
            .rev()
            .find(|call| call.is(method, path))
            .cloned()
            .unwrap_or_else(|| panic!("no {method} {path} in {:?}", self.calls_unlocked(&log)))
    }

    fn calls_unlocked(&self, log: &[Call]) -> Vec<String> {
        log.iter()
            .map(|call| format!("{} {}", call.method, call.path))
            .collect()
    }

    fn clear(&self) {
        self.log.lock().unwrap().clear();
    }
}

struct Bench {
    _dir: tempfile::TempDir,
    store: Store,
    publisher: Publisher,
    mock: Mock,
    db_path: std::path::PathBuf,
    media: std::path::PathBuf,
    folder: i64,
}

impl Bench {
    fn new(mock: Mock) -> Self {
        let dir = tempfile::tempdir().unwrap();
        let media = dir.path().join("media");
        fs::create_dir(&media).unwrap();
        let media = selected_root(&media).unwrap();
        let db_path = dir.path().join("test.sqlite3");
        let store = Store::open(&db_path).unwrap();
        let folder = store.grant(media.to_str().unwrap()).unwrap();
        let publisher = Publisher {
            api: Api::new(false).unwrap(),
            endpoints: Endpoints {
                threads: mock.url.clone(),
                graph: mock.url.clone(),
                graph_video: mock.url.clone(),
                instagram: mock.url.clone(),
                tiktok: mock.url.clone(),
                upload_hosts: vec!["127.0.0.1".into()],
                poll: Duration::from_millis(1),
                polls: 4,
            },
            secrets: Box::new(MemorySecrets::default()),
        };
        Self {
            _dir: dir,
            store,
            publisher,
            mock,
            db_path,
            media,
            folder,
        }
    }

    fn connect(&self, platform: &str, variant: &str, token: &str) -> i64 {
        self.publisher
            .connect(
                &self.store,
                ConnectInput {
                    platform: platform.into(),
                    variant: variant.into(),
                    access_token: token.into(),
                    refresh_token: None,
                    client_key: None,
                    client_secret: None,
                },
            )
            .unwrap()
            .id
    }

    /// Indexes a real file in the granted folder, as a scan would.
    fn asset(&self, name: &str, kind: &str, bytes: &[u8]) -> i64 {
        fs::write(self.media.join(name), bytes).unwrap();
        let db = self.store.db().unwrap();
        db.execute(
            "INSERT INTO assets(folder_id, relative_path, kind, bytes, modified) VALUES (?, ?, ?, ?, '')",
            rusqlite::params![self.folder, name, kind, bytes.len() as i64],
        )
        .unwrap();
        let id = db.last_insert_rowid();
        db.execute("INSERT INTO asset_metadata(asset_id) VALUES (?)", [id])
            .unwrap();
        id
    }

    fn draft(&self, account_id: i64, format: &str, caption: &str) -> DraftInput {
        DraftInput {
            account_id,
            format: format.into(),
            caption: caption.into(),
            title: String::new(),
            privacy: String::new(),
            media_url: None,
            asset_id: None,
            render_job_id: None,
        }
    }

    /// Saves a draft, approves it and runs the worker inline.
    fn post(&self, draft: DraftInput) -> super::PublishJob {
        let job = self.store.create_publish_job(&draft).unwrap();
        assert_eq!(job.status, "draft");
        self.run(job.id)
    }

    fn run(&self, job_id: i64) -> super::PublishJob {
        assert!(self.store.begin_publish(job_id).unwrap());
        assert!(!self.store.begin_publish(job_id).unwrap());
        self.publisher.run_job(&self.store, job_id);
        self.store.publish_job(job_id).unwrap()
    }

    fn token_absent_from_database(&self, token: &str) -> bool {
        let wal = self.db_path.with_extension("sqlite3-wal");
        [self.db_path.clone(), wal]
            .iter()
            .filter_map(|path| fs::read(path).ok())
            .all(|bytes| position(&bytes, token.as_bytes()).is_none())
    }
}

#[test]
fn threads_posts_lists_deletes_and_refreshes() {
    let polls = AtomicUsize::new(0);
    let bench = Bench::new(Mock::start(move |call, _| {
        let reply = match (call.method.as_str(), call.path.as_str()) {
            ("GET", "/v1.0/me") => json!({"id": "111", "username": "tester"}),
            ("POST", "/v1.0/111/threads") => json!({"id": "c1"}),
            ("GET", "/v1.0/c1") => {
                if polls.fetch_add(1, Ordering::Relaxed) == 0 {
                    json!({"id": "c1", "status": "IN_PROGRESS"})
                } else {
                    json!({"id": "c1", "status": "FINISHED"})
                }
            }
            ("POST", "/v1.0/111/threads_publish") => json!({"id": "p1"}),
            ("GET", "/v1.0/p1") => {
                json!({"id": "p1", "permalink": "https://www.threads.com/@tester/post/abc"})
            }
            ("GET", "/v1.0/111/threads") => json!({"data": [
                {"id": "p1", "media_type": "TEXT_POST", "text": "Xin chào", "permalink": "https://www.threads.com/@tester/post/abc", "timestamp": "2026-11-10T03:00:00+0000"},
                {"text": "no id"}
            ]}),
            ("DELETE", "/v1.0/p1") => json!({"success": true, "deleted_id": "p1"}),
            ("GET", "/refresh_access_token") => {
                json!({"access_token": "THREADSTOKEN2", "token_type": "bearer", "expires_in": 5_184_000})
            }
            _ => return (404, json!({"error": {"message": "unknown", "code": 100}})),
        };
        (200, reply)
    }));

    let account = bench.connect("threads", "", "THREADSTOKEN1");
    assert!(
        bench
            .mock
            .call("GET", "/v1.0/me")
            .query
            .contains("access_token=THREADSTOKEN1")
    );
    let saved = bench.store.social_account(account).unwrap();
    assert_eq!(
        (
            saved.platform,
            saved.remote_id.as_str(),
            saved.name.as_str()
        ),
        (Platform::Threads, "111", "tester")
    );
    assert!(bench.token_absent_from_database("THREADSTOKEN1"));

    let job = bench.post(bench.draft(account, "text", "Xin chào"));
    assert_eq!(
        (job.status.as_str(), job.remote_id.as_deref()),
        ("published", Some("p1"))
    );
    assert_eq!(
        job.permalink.as_deref(),
        Some("https://www.threads.com/@tester/post/abc")
    );
    let create = bench.mock.call("POST", "/v1.0/111/threads").text();
    assert!(create.contains("media_type=TEXT") && create.contains("access_token=THREADSTOKEN1"));
    assert!(
        bench
            .mock
            .call("POST", "/v1.0/111/threads_publish")
            .text()
            .contains("creation_id=c1")
    );
    // A published job cannot be sent again.
    assert!(!bench.store.begin_publish(job.id).unwrap());

    let mut image = bench.draft(account, "image", "Ảnh");
    image.media_url = Some("https://cdn.example.com/a.jpg".into());
    bench.post(image);
    let create = bench.mock.call("POST", "/v1.0/111/threads").text();
    assert!(
        create.contains("media_type=IMAGE")
            && create.contains("image_url=https%3A%2F%2Fcdn.example.com%2Fa.jpg")
    );

    let posts = bench.publisher.remote_posts(&bench.store, account).unwrap();
    assert_eq!(posts.len(), 1);
    assert_eq!(
        (posts[0].id.as_str(), posts[0].text.as_str()),
        ("p1", "Xin chào")
    );

    bench
        .publisher
        .delete_remote(&bench.store, account, "p1")
        .unwrap();
    assert_eq!(bench.store.publish_job(job.id).unwrap().status, "removed");
    assert!(
        bench
            .publisher
            .delete_remote(&bench.store, account, "../me")
            .is_err()
    );

    let refreshed = bench.publisher.refresh(&bench.store, account).unwrap();
    assert!(refreshed.expires_at.unwrap() > super::unix_now() + 5_000_000);
    let secret = secrets::load(bench.publisher.secrets.as_ref(), &saved.secret_ref).unwrap();
    assert_eq!(secret.access_token, "THREADSTOKEN2");
    assert!(bench.token_absent_from_database("THREADSTOKEN2"));

    bench.publisher.disconnect(&bench.store, account).unwrap();
    assert!(bench.store.social_accounts().unwrap().is_empty());
    assert!(bench.publisher.secrets.get(&saved.secret_ref).is_err());
    // Jobs go with their account.
    assert!(bench.store.publish_jobs().unwrap().is_empty());
}

#[test]
fn threads_retry_resumes_container_instead_of_posting_twice() {
    let state = Arc::new(Mutex::new("ERROR"));
    let shared = Arc::clone(&state);
    let bench = Bench::new(Mock::start(move |call, _| {
        let status = *shared.lock().unwrap();
        let reply = match (call.method.as_str(), call.path.as_str()) {
            ("GET", "/v1.0/me") => json!({"id": 111, "name": "Numeric Id"}),
            ("POST", "/v1.0/111/threads") => json!({"id": "c1"}),
            ("GET", "/v1.0/c1") => {
                json!({"id": "c1", "status": status, "error_message": "FAILED_DOWNLOADING_VIDEO"})
            }
            ("POST", "/v1.0/111/threads_publish") => json!({"id": "p9"}),
            ("GET", "/v1.0/p9") => json!({"id": "p9"}),
            _ => {
                return (
                    400,
                    json!({"error": {"message": "Invalid OAuth access token.", "type": "OAuthException", "code": 190}}),
                );
            }
        };
        (200, reply)
    }));
    let account = bench.connect("threads", "", "TOKEN");
    assert_eq!(
        bench.store.social_account(account).unwrap().name,
        "Numeric Id"
    );

    let mut video = bench.draft(account, "video", "Video");
    video.media_url = Some("https://cdn.example.com/a.mp4".into());
    let job = bench.post(video);
    assert_eq!(job.status, "failed");
    assert!(job.error.unwrap().contains("FAILED_DOWNLOADING_VIDEO"));

    // The platform still processing: the job fails softly and keeps its container.
    *state.lock().unwrap() = "IN_PROGRESS";
    bench.mock.clear();
    let job = bench.run(job.id);
    assert_eq!(job.status, "failed");
    assert!(job.error.unwrap().contains("vẫn đang xử lý"));
    assert!(
        !bench
            .mock
            .calls()
            .contains(&"POST /v1.0/111/threads_publish".to_owned())
    );

    // Ready now: the retry publishes the same container and creates nothing new.
    *state.lock().unwrap() = "FINISHED";
    bench.mock.clear();
    let job = bench.run(job.id);
    assert_eq!(
        (job.status.as_str(), job.remote_id.as_deref()),
        ("published", Some("p9"))
    );
    assert!(
        !bench
            .mock
            .calls()
            .contains(&"POST /v1.0/111/threads".to_owned())
    );

    // Already live from an earlier attempt: nothing is sent again.
    let again = bench
        .store
        .create_publish_job(&bench.draft(account, "text", "Lần hai"))
        .unwrap();
    bench.store.set_publish_ref(again.id, "c1").unwrap();
    *state.lock().unwrap() = "PUBLISHED";
    bench.mock.clear();
    let again = bench.run(again.id);
    assert_eq!(
        (again.status.as_str(), again.remote_id),
        ("published", None)
    );
    assert_eq!(bench.mock.calls(), ["GET /v1.0/c1"]);

    // An expired token is reported as a reconnect request, without the token.
    let failed = bench
        .publisher
        .remote_posts(&bench.store, account)
        .unwrap_err()
        .to_string();
    assert!(failed.contains("kết nối lại") && !failed.contains("TOKEN"));
}

#[test]
fn facebook_page_posts_uploads_edits_and_deletes() {
    let bench = Bench::new(Mock::start(|call, base| {
        let reply = match (call.method.as_str(), call.path.as_str()) {
            ("GET", "/v26.0/me") => json!({"id": "900", "name": "Trang thử", "category": "Media"}),
            ("POST", "/v26.0/900/feed") => json!({"id": "900_1"}),
            ("POST", "/v26.0/900/photos") => json!({"id": "55", "post_id": "900_2"}),
            ("POST", "/v26.0/900/videos") => json!({"id": "66"}),
            ("GET", "/v26.0/66") => json!({"permalink_url": "/900/videos/66/"}),
            ("GET", "/v26.0/900_1" | "/v26.0/900_2") => {
                json!({"permalink_url": "https://www.facebook.com/900/posts/1"})
            }
            ("POST", "/v26.0/900/video_reels") => {
                if call.text().contains("upload_phase=start") {
                    json!({"video_id": "777", "upload_url": format!("{base}/video-upload/v26.0/777")})
                } else {
                    json!({"success": true})
                }
            }
            ("POST", "/video-upload/v26.0/777") => json!({"success": true}),
            ("GET", "/v26.0/900/published_posts") => {
                json!({"data": [{"id": "900_1", "message": "Chào", "created_time": "2026-11-10T03:00:00+0000", "permalink_url": "https://www.facebook.com/900/posts/1"}]})
            }
            ("POST", "/v26.0/900_1") | ("DELETE", "/v26.0/900_1") => json!({"success": true}),
            _ => {
                return (
                    400,
                    json!({"error": {"message": "(#200) Permissions error", "type": "OAuthException", "code": 200}}),
                );
            }
        };
        (200, reply)
    }));
    let page = bench.connect("facebook", "", "PAGETOKEN");
    assert!(
        bench
            .mock
            .call("GET", "/v26.0/me")
            .query
            .contains("fields=id%2Cname%2Ccategory")
    );

    let text = bench.post(bench.draft(page, "text", "Chào"));
    assert_eq!(
        (text.status.as_str(), text.remote_id.as_deref()),
        ("published", Some("900_1"))
    );
    assert_eq!(
        text.permalink.as_deref(),
        Some("https://www.facebook.com/900/posts/1")
    );
    assert!(
        bench
            .mock
            .call("POST", "/v26.0/900/feed")
            .text()
            .contains("access_token=PAGETOKEN")
    );

    let photo = bench.asset("Ảnh bìa.jpg", "image", b"JPEGBYTES");
    let mut draft = bench.draft(page, "image", "Ảnh bìa");
    draft.asset_id = Some(photo);
    let image = bench.post(draft);
    assert_eq!(image.remote_id.as_deref(), Some("900_2"));
    let upload = bench.mock.call("POST", "/v26.0/900/photos");
    assert!(upload.headers["content-type"].starts_with("multipart/form-data"));
    let body = upload.text();
    assert!(
        body.contains("name=\"source\"")
            && body.contains("JPEGBYTES")
            && body.contains("name=\"caption\"")
    );

    let clip = bench.asset("clip.mp4", "video", b"MP4BYTES");
    let mut draft = bench.draft(page, "video", "Video dài");
    draft.asset_id = Some(clip);
    draft.title = "Tiêu đề".into();
    let video = bench.post(draft);
    assert_eq!(video.remote_id.as_deref(), Some("66"));
    assert_eq!(
        video.permalink.as_deref(),
        Some("https://www.facebook.com/900/videos/66/")
    );
    let body = bench.mock.call("POST", "/v26.0/900/videos").text();
    assert!(
        body.contains("MP4BYTES")
            && body.contains("name=\"description\"")
            && body.contains("name=\"title\"")
    );

    let mut draft = bench.draft(page, "reel", "Reel ngắn");
    draft.asset_id = Some(clip);
    let reel = bench.post(draft);
    assert_eq!(
        (reel.status.as_str(), reel.remote_id.as_deref()),
        ("published", Some("777"))
    );
    let sent = bench.mock.call("POST", "/video-upload/v26.0/777");
    assert_eq!(sent.headers["authorization"], "OAuth PAGETOKEN");
    assert_eq!(
        (
            sent.headers["offset"].as_str(),
            sent.headers["file_size"].as_str()
        ),
        ("0", "8")
    );
    assert_eq!(sent.body, b"MP4BYTES");
    let finish = bench.mock.call("POST", "/v26.0/900/video_reels").text();
    assert!(
        finish.contains("upload_phase=finish")
            && finish.contains("video_id=777")
            && finish.contains("video_state=PUBLISHED")
    );

    assert_eq!(
        bench.publisher.remote_posts(&bench.store, page).unwrap()[0].id,
        "900_1"
    );
    bench
        .publisher
        .edit_remote(&bench.store, page, "900_1", "Chào lần nữa")
        .unwrap();
    assert_eq!(
        bench.store.publish_job(text.id).unwrap().caption,
        "Chào lần nữa"
    );
    assert!(
        bench
            .publisher
            .edit_remote(&bench.store, page, "900_1", "  ")
            .is_err()
    );
    bench
        .publisher
        .delete_remote(&bench.store, page, "900_1")
        .unwrap();
    assert_eq!(bench.store.publish_job(text.id).unwrap().status, "removed");

    // Platform errors keep their code and text, and the asset going away fails the job cleanly.
    let denied = bench
        .publisher
        .delete_remote(&bench.store, page, "900_404")
        .unwrap_err()
        .to_string();
    assert!(denied.contains("mã 200") && denied.contains("Permissions error"));
    fs::remove_file(bench.media.join("clip.mp4")).unwrap();
    let mut draft = bench.draft(page, "video", "Mất tệp");
    draft.asset_id = Some(clip);
    assert_eq!(bench.post(draft).status, "failed");
    assert!(bench.token_absent_from_database("PAGETOKEN"));
}

#[test]
fn upload_urls_must_stay_on_the_platform_domain() {
    let endpoints = Endpoints::default();
    assert!(
        endpoints
            .upload_url(
                "https://rupload.facebook.com/video-upload/v26.0/1",
                "facebook.com"
            )
            .is_ok()
    );
    assert!(
        endpoints
            .upload_url(
                "https://open-upload.tiktokapis.com/upload/?upload_id=1",
                "tiktokapis.com"
            )
            .is_ok()
    );
    for refused in [
        "http://rupload.facebook.com/video-upload/v26.0/1",
        "https://rupload.facebook.com.evil.test/x",
        "https://evilfacebook.com/x",
        "https://127.0.0.1/x",
        "not a url",
    ] {
        assert!(
            endpoints.upload_url(refused, "facebook.com").is_err(),
            "{refused}"
        );
    }

    // A Reel whose upload URL points elsewhere is stopped before the token leaves.
    let bench = Bench::new(Mock::start(|call, _| {
        match (call.method.as_str(), call.path.as_str()) {
            ("GET", "/v26.0/me") => (200, json!({"id": "900", "name": "Trang"})),
            _ => (
                200,
                json!({"video_id": "777", "upload_url": "https://uploads.example.com/777"}),
            ),
        }
    }));
    let page = bench.connect("facebook", "", "PAGETOKEN");
    let clip = bench.asset("clip.mp4", "video", b"MP4BYTES");
    let mut draft = bench.draft(page, "reel", "Reel");
    draft.asset_id = Some(clip);
    let job = bench.post(draft);
    assert_eq!(job.status, "failed");
    assert!(job.error.unwrap().contains("địa chỉ tải lên không hợp lệ"));
    assert_eq!(
        bench.mock.calls(),
        ["GET /v26.0/me", "POST /v26.0/900/video_reels"]
    );
}

#[test]
fn instagram_publishes_by_url_and_uploads_reels_through_a_page() {
    let bench = Bench::new(Mock::start(|call, base| {
        let page_token = call.query.contains("PAGETOKEN") || call.text().contains("PAGETOKEN");
        let reply = match (call.method.as_str(), call.path.as_str()) {
            ("GET", "/v26.0/me") if page_token => {
                json!({"instagram_business_account": {"id": "1784", "username": "studio"}, "id": "900"})
            }
            ("GET", "/v26.0/me") => json!({"data": [{"user_id": "2001", "username": "creator"}]}),
            ("POST", "/v26.0/2001/media") => json!({"id": "c2"}),
            ("POST", "/v26.0/1784/media") => {
                json!({"id": "c9", "uri": format!("{base}/ig-api-upload/v26.0/c9")})
            }
            ("POST", "/ig-api-upload/v26.0/c9") => {
                json!({"success": true, "message": "Upload successful."})
            }
            ("GET", "/v26.0/c2" | "/v26.0/c9") => json!({"status_code": "FINISHED"}),
            ("POST", "/v26.0/2001/media_publish") => json!({"id": "m2"}),
            ("POST", "/v26.0/1784/media_publish") => json!({"id": "m9"}),
            ("GET", "/v26.0/m2" | "/v26.0/m9") => {
                json!({"permalink": "https://www.instagram.com/p/xyz/"})
            }
            ("GET", "/v26.0/1784/media") => {
                json!({"data": [{"id": "m9", "caption": "Reel", "media_type": "VIDEO", "media_product_type": "REELS", "permalink": "https://www.instagram.com/reel/xyz/", "timestamp": "2026-11-10T03:00:00+0000"}]})
            }
            ("DELETE", "/v26.0/m9") => json!({"success": true, "deleted_id": "m9"}),
            ("GET", "/refresh_access_token") => {
                json!({"access_token": "IGTOKEN2", "expires_in": 5_184_000})
            }
            _ => {
                return (
                    400,
                    json!({"error_type": "OAuthException", "code": 400, "error_message": "bad request"}),
                );
            }
        };
        (200, reply)
    }));

    let creator = bench.connect("instagram", INSTAGRAM_LOGIN, "IGTOKEN");
    assert_eq!(
        bench.store.social_account(creator).unwrap().remote_id,
        "2001"
    );
    let mut draft = bench.draft(creator, "image", "Ảnh");
    draft.media_url = Some("https://cdn.example.com/a.jpg".into());
    let image = bench.post(draft);
    assert_eq!(
        (image.status.as_str(), image.remote_id.as_deref()),
        ("published", Some("m2"))
    );
    assert_eq!(
        image.permalink.as_deref(),
        Some("https://www.instagram.com/p/xyz/")
    );
    assert!(
        bench
            .mock
            .call("POST", "/v26.0/2001/media")
            .text()
            .contains("image_url=")
    );
    // Instagram Login has no file upload and no delete, so both are refused up front.
    let clip = bench.asset("reel.mp4", "video", b"REELBYTES");
    let mut local = bench.draft(creator, "reel", "Reel");
    local.asset_id = Some(clip);
    assert!(bench.store.create_publish_job(&local).is_err());
    assert!(
        bench
            .publisher
            .delete_remote(&bench.store, creator, "m2")
            .is_err()
    );
    assert!(
        bench
            .publisher
            .refresh(&bench.store, creator)
            .unwrap()
            .expires_at
            .is_some()
    );

    let studio = bench.connect("instagram", FACEBOOK_LOGIN, "PAGETOKEN");
    assert_eq!(bench.store.social_account(studio).unwrap().name, "studio");
    let mut local = bench.draft(studio, "reel", "Reel");
    local.asset_id = Some(clip);
    let reel = bench.post(local);
    assert_eq!(
        (reel.status.as_str(), reel.remote_id.as_deref()),
        ("published", Some("m9"))
    );
    let container = bench.mock.call("POST", "/v26.0/1784/media").text();
    assert!(container.contains("media_type=REELS") && container.contains("upload_type=resumable"));
    let sent = bench.mock.call("POST", "/ig-api-upload/v26.0/c9");
    assert_eq!(sent.headers["authorization"], "OAuth PAGETOKEN");
    assert_eq!(sent.headers["file_size"], "9");
    assert_eq!(sent.body, b"REELBYTES");
    assert_eq!(
        bench.publisher.remote_posts(&bench.store, studio).unwrap()[0].kind,
        "REELS"
    );
    bench
        .publisher
        .delete_remote(&bench.store, studio, "m9")
        .unwrap();
    assert!(bench.publisher.refresh(&bench.store, studio).is_err());
}

#[test]
fn tiktok_uploads_in_chunks_and_rotates_refresh_tokens() {
    const MIB: u64 = 1024 * 1024;
    assert_eq!(chunk_plan(4 * MIB), (4 * MIB, 1));
    assert_eq!(chunk_plan(5 * MIB), (10 * MIB, 1));
    assert_eq!(chunk_plan(25 * MIB), (10 * MIB, 2));
    assert_eq!(chunk_plan(64 * MIB + 1), (10 * MIB, 6));

    let polls = AtomicUsize::new(0);
    let bench = Bench::new(Mock::start(move |call, base| {
        let ok = json!({"code": "ok", "message": "", "log_id": "1"});
        let reply = match (call.method.as_str(), call.path.as_str()) {
            ("GET", "/v2/user/info/") => {
                json!({"data": {"user": {"open_id": "open-1_a", "display_name": "Nhà sáng tạo"}}, "error": ok})
            }
            ("POST", "/v2/post/publish/creator_info/query/") => {
                json!({"data": {"creator_nickname": "Nhà sáng tạo", "privacy_level_options": ["FOLLOWER_OF_CREATOR", "SELF_ONLY"], "max_video_post_duration_sec": 600}, "error": ok})
            }
            ("POST", "/v2/post/publish/video/init/") => {
                json!({"data": {"publish_id": "v_pub_1", "upload_url": format!("{base}/upload/?upload_id=1&upload_token=t")}, "error": ok})
            }
            ("PUT", "/upload/") => {
                let done = call.headers["content-range"].ends_with(&format!(
                    "-{}/{}",
                    21 * MIB - 1,
                    21 * MIB
                ));
                return (if done { 201 } else { 206 }, Value::Null);
            }
            ("POST", "/v2/post/publish/status/fetch/") => {
                if polls.fetch_add(1, Ordering::Relaxed) == 0 {
                    json!({"data": {"status": "PROCESSING_UPLOAD", "uploaded_bytes": 21 * MIB}, "error": ok})
                } else {
                    json!({"data": {"status": "PUBLISH_COMPLETE", "publicaly_available_post_id": [7_300_000_000_000_000_001_i64]}, "error": ok})
                }
            }
            ("POST", "/v2/video/list/") => {
                json!({"data": {"videos": [{"id": "7300000000000000001", "title": "", "video_description": "Video đầu", "create_time": 1_794_000_000, "share_url": "https://www.tiktok.com/@a/video/1"}], "cursor": 0, "has_more": false}, "error": ok})
            }
            ("POST", "/v2/oauth/token/") => {
                if call.text().contains("refresh_token=RT1") {
                    json!({"access_token": "TTACCESS2", "expires_in": 7200, "refresh_token": "RT2", "refresh_expires_in": 15_552_000, "open_id": "open-1_a", "scope": "video.publish", "token_type": "Bearer"})
                } else {
                    return (
                        400,
                        json!({"error": "invalid_grant", "error_description": "Refresh token is invalid", "log_id": "2"}),
                    );
                }
            }
            _ => {
                return (
                    401,
                    json!({"data": {}, "error": {"code": "access_token_invalid", "message": "expired", "log_id": "3"}}),
                );
            }
        };
        (200, reply)
    }));

    let account = bench
        .publisher
        .connect(
            &bench.store,
            ConnectInput {
                platform: "tiktok".into(),
                variant: String::new(),
                access_token: "TTACCESS1".into(),
                refresh_token: Some("RT1".into()),
                client_key: Some("CLIENTKEY".into()),
                client_secret: Some("CLIENTSECRET".into()),
            },
        )
        .unwrap();
    assert_eq!(
        bench.mock.call("GET", "/v2/user/info/").headers["authorization"],
        "Bearer TTACCESS1"
    );
    assert!(account.capabilities.privacy && !account.capabilities.delete);
    let secret_ref = bench.store.social_account(account.id).unwrap().secret_ref;

    // With no known expiry and refresh credentials, the token is renewed before use.
    let options = bench.publisher.options(&bench.store, account.id).unwrap();
    assert_eq!(options.privacy_levels, ["FOLLOWER_OF_CREATOR", "SELF_ONLY"]);
    let renew = bench.mock.call("POST", "/v2/oauth/token/").text();
    assert!(renew.contains("client_key=CLIENTKEY") && renew.contains("grant_type=refresh_token"));
    let secret = secrets::load(bench.publisher.secrets.as_ref(), &secret_ref).unwrap();
    assert_eq!(
        (
            secret.access_token.as_str(),
            secret.refresh_token.as_deref()
        ),
        ("TTACCESS2", Some("RT2"))
    );
    assert_eq!(
        bench
            .mock
            .call("POST", "/v2/post/publish/creator_info/query/")
            .headers["authorization"],
        "Bearer TTACCESS2"
    );
    for secret in ["TTACCESS1", "TTACCESS2", "RT2", "CLIENTSECRET"] {
        assert!(bench.token_absent_from_database(secret));
    }

    let video = bench.asset("dọc.mp4", "video", &vec![7; (21 * MIB) as usize]);
    let mut draft = bench.draft(account.id, "video", "Video đầu #thử");
    draft.asset_id = Some(video);
    assert!(
        bench.store.create_publish_job(&draft).is_err(),
        "privacy is required"
    );
    draft.privacy = "PUBLIC_TO_EVERYONE".into();
    let refused = bench.post(draft.clone());
    assert_eq!(refused.status, "failed");
    assert!(
        refused
            .error
            .unwrap()
            .contains("FOLLOWER_OF_CREATOR, SELF_ONLY")
    );

    draft.privacy = "SELF_ONLY".into();
    bench.mock.clear();
    let job = bench.post(draft);
    assert_eq!(
        (job.status.as_str(), job.remote_id.as_deref()),
        ("published", Some("7300000000000000001"))
    );
    let init: Value =
        serde_json::from_slice(&bench.mock.call("POST", "/v2/post/publish/video/init/").body)
            .unwrap();
    assert_eq!(
        init["post_info"],
        json!({"title": "Video đầu #thử", "privacy_level": "SELF_ONLY", "disable_duet": false, "disable_comment": false, "disable_stitch": false})
    );
    assert_eq!(
        init["source_info"],
        json!({"source": "FILE_UPLOAD", "video_size": 21 * MIB, "chunk_size": 10 * MIB, "total_chunk_count": 2})
    );
    let log = bench.mock.log.lock().unwrap();
    let parts: Vec<_> = log
        .iter()
        .filter(|call| call.is("PUT", "/upload/"))
        .collect();
    let ranges: Vec<_> = parts
        .iter()
        .map(|call| call.headers["content-range"].as_str())
        .collect();
    assert_eq!(
        ranges,
        [
            "bytes 0-10485759/22020096",
            "bytes 10485760-22020095/22020096"
        ]
    );
    assert_eq!(parts[1].body.len() as u64, 11 * MIB);
    assert!(
        parts
            .iter()
            .all(|call| call.headers["content-type"] == "video/mp4"
                && !call.headers.contains_key("authorization"))
    );
    drop(log);

    let listed = bench
        .publisher
        .remote_posts(&bench.store, account.id)
        .unwrap();
    assert_eq!(
        (listed[0].id.as_str(), listed[0].text.as_str()),
        ("7300000000000000001", "Video đầu")
    );
    assert!(
        bench
            .publisher
            .delete_remote(&bench.store, account.id, "7300000000000000001")
            .is_err()
    );

    // A rejected refresh surfaces TikTok's reason and leaves the stored secret alone.
    secrets::save(
        bench.publisher.secrets.as_ref(),
        &secret_ref,
        &secrets::Secret {
            refresh_token: Some("STALE".into()),
            ..secret
        },
    )
    .unwrap();
    let failed = bench
        .publisher
        .refresh(&bench.store, account.id)
        .unwrap_err()
        .to_string();
    assert!(failed.contains("invalid_grant") && failed.contains("Refresh token is invalid"));
}

#[test]
fn drafts_follow_each_platform_rules() {
    let draft = |format: &str, caption: &str| DraftInput {
        account_id: 1,
        format: format.into(),
        caption: caption.into(),
        title: String::new(),
        privacy: String::new(),
        media_url: None,
        asset_id: None,
        render_job_id: None,
    };
    let with = |mut base: DraftInput, change: fn(&mut DraftInput)| {
        change(&mut base);
        base
    };
    let ok = |platform, variant, draft: &DraftInput, kind| {
        check_draft(platform, variant, draft, kind).is_ok()
    };
    use Platform::{Facebook, Instagram, Threads, Tiktok};

    assert!(ok(Threads, "", &draft("text", "Chào"), None));
    assert!(!ok(Threads, "", &draft("text", "  "), None));
    assert!(!ok(Threads, "", &draft("text", &"á".repeat(501)), None));
    assert!(ok(Threads, "", &draft("text", &"á".repeat(500)), None));
    assert!(!ok(Threads, "", &draft("reel", "x"), None));
    assert!(
        !ok(Threads, "", &draft("image", "x"), None),
        "media is required"
    );
    let url = with(draft("image", ""), |d| {
        d.media_url = Some("https://a.example/x.jpg".into())
    });
    assert!(ok(Threads, "", &url, None));
    assert!(!ok(
        Threads,
        "",
        &with(url.clone(), |d| d.media_url =
            Some("http://a.example/x.jpg".into())),
        None
    ));
    assert!(!ok(
        Threads,
        "",
        &with(url.clone(), |d| d.media_url =
            Some("file:///C:/x.jpg".into())),
        None
    ));
    assert!(
        !ok(
            Threads,
            "",
            &with(url.clone(), |d| d.asset_id = Some(1)),
            Some("image")
        ),
        "one source only"
    );
    let local = with(draft("image", ""), |d| d.asset_id = Some(1));
    assert!(
        !ok(Threads, "", &local, Some("image")),
        "Threads has no file upload"
    );
    assert!(!ok(
        Threads,
        "",
        &with(draft("text", "x"), |d| d.media_url =
            Some("https://a.example/x.jpg".into())),
        None
    ));
    assert!(!ok(
        Threads,
        "",
        &with(draft("text", "x"), |d| d.privacy = "SELF_ONLY".into()),
        None
    ));

    assert!(ok(Facebook, "", &local, Some("image")));
    assert!(
        !ok(Facebook, "", &local, Some("video")),
        "kind must match the format"
    );
    assert!(!ok(Facebook, "", &local, None), "the asset must exist");
    let export = with(draft("reel", ""), |d| d.render_job_id = Some(1));
    assert!(ok(Facebook, "", &export, None));
    assert!(!ok(
        Facebook,
        "",
        &with(draft("image", ""), |d| d.render_job_id = Some(1)),
        None
    ));
    assert!(!ok(
        Facebook,
        "",
        &with(draft("text", "x"), |d| d.title = "t".repeat(256)),
        None
    ));

    assert!(!ok(Instagram, INSTAGRAM_LOGIN, &draft("text", "x"), None));
    assert!(!ok(Instagram, INSTAGRAM_LOGIN, &export, None));
    assert!(ok(Instagram, FACEBOOK_LOGIN, &export, None));
    assert!(
        !ok(Instagram, FACEBOOK_LOGIN, &local, Some("image")),
        "images are URL only"
    );
    assert!(!ok(
        Instagram,
        FACEBOOK_LOGIN,
        &draft("image", &"a".repeat(2201)),
        None
    ));

    let video = with(draft("video", "x"), |d| d.asset_id = Some(1));
    assert!(
        !ok(Tiktok, "", &video, Some("video")),
        "privacy is required"
    );
    let private = with(video.clone(), |d| d.privacy = "SELF_ONLY".into());
    assert!(ok(Tiktok, "", &private, Some("video")));
    assert!(!ok(
        Tiktok,
        "",
        &with(private.clone(), |d| d.privacy = "EVERYONE".into()),
        Some("video")
    ));
    let by_url = with(draft("video", "x"), |d| {
        d.media_url = Some("https://a.example/x.mp4".into());
        d.privacy = "SELF_ONLY".into();
    });
    assert!(
        !ok(Tiktok, "", &by_url, None),
        "TikTok direct post takes a file"
    );
    // TikTok counts UTF-16 units, so an emoji costs two.
    assert!(!ok(
        Tiktok,
        "",
        &with(private.clone(), |d| d.caption = "😀".repeat(1101)),
        Some("video")
    ));
    assert!(ok(
        Tiktok,
        "",
        &with(private, |d| d.caption = "😀".repeat(1100)),
        Some("video")
    ));
}

#[test]
fn drafts_from_exports_wait_for_a_finished_render() {
    let bench = Bench::new(Mock::start(|call, _| {
        match (call.method.as_str(), call.path.as_str()) {
            ("GET", "/v26.0/me") => (200, json!({"id": "900", "name": "Trang"})),
            ("POST", "/v26.0/900/videos") => (200, json!({"id": "66"})),
            _ => (200, json!({})),
        }
    }));
    let page = bench.connect("facebook", "", "PAGETOKEN");
    let project = bench.store.create_project("Xuất").unwrap();
    let output = bench.media.join("Kết quả.mp4");
    let snapshot = TimelineSnapshot {
        version: 2,
        tracks: vec![TrackEdit {
            kind: "video".into(),
            clips: vec![ClipEdit {
                asset_id: 1,
                start_ms: 0,
                end_ms: 1000,
                position_ms: 0,
                layer: 0,
                look: Default::default(),
            }],
        }],
        titles: vec![],
        aspect: Default::default(),
        lanes: Vec::new(),
        export_range: None,
        adjustments: Vec::new(),
    };
    let render = bench
        .store
        .create_render_job(project.id, &snapshot, output.to_str().unwrap())
        .unwrap();
    let mut draft = bench.draft(page, "video", "Video đã xuất");
    draft.render_job_id = Some(render.id);
    assert!(
        bench.store.create_publish_job(&draft).is_err(),
        "the render is still queued"
    );

    bench
        .store
        .set_render_status(render.id, &["queued"], "done", None)
        .unwrap();
    let job = bench.store.create_publish_job(&draft).unwrap();
    assert_eq!(
        (job.media.as_str(), job.media_label.as_deref()),
        ("render", output.to_str())
    );
    // The exported file is missing: the job fails without calling the platform.
    bench.mock.clear();
    assert_eq!(bench.run(job.id).status, "failed");
    assert!(bench.mock.calls().is_empty());
    fs::write(&output, b"RENDERED").unwrap();
    let job = bench.run(job.id);
    assert_eq!(
        (job.status.as_str(), job.remote_id.as_deref()),
        ("published", Some("66"))
    );
    assert!(
        bench
            .mock
            .call("POST", "/v26.0/900/videos")
            .text()
            .contains("RENDERED")
    );

    // Drafts and failures can be discarded, the published record stays.
    assert!(bench.store.delete_publish_job(job.id).is_err());
    let spare = bench
        .store
        .create_publish_job(&bench.draft(page, "text", "Nháp"))
        .unwrap();
    bench.store.delete_publish_job(spare.id).unwrap();
    assert_eq!(bench.store.publish_jobs().unwrap().len(), 1);
    drop(bench.store);
    // A worker that died with the app leaves a retryable failure, not a stuck job.
    let _ = Path::new(&bench.db_path);
}
