//! TikTok Content Posting API: direct post of a local video in chunks.

use std::{
    fs::File,
    io::{Read, Seek, SeekFrom},
    thread,
};

use reqwest::StatusCode;
use serde_json::{Value, json};

use super::{
    Identity, Media, MediaFile, Post, PublishOptions, Published, Refreshed, RemotePost, Session,
    http::{Api, Endpoints, UPLOAD_TIMEOUT, id_of, text_of},
    secrets::Secret,
    unix_now,
};
use crate::model::{Result, StudioError};

const MIN_CHUNK: u64 = 5 * 1024 * 1024;
const CHUNK: u64 = 10 * 1024 * 1024;
const MAX_VIDEO: u64 = 4 * 1024 * 1024 * 1024;
const JSON: &str = "application/json; charset=UTF-8";

pub fn identify(api: &Api, endpoints: &Endpoints, token: &str) -> Result<Identity> {
    let data = api.tiktok(
        api.get(&format!("{}/v2/user/info/", endpoints.tiktok))
            .query(&[("fields", "open_id,display_name")])
            .bearer_auth(token),
    )?;
    let user = &data["user"];
    Ok(Identity {
        remote_id: id_of(user, "open_id")?,
        name: text_of(user, "display_name").unwrap_or_else(|| "TikTok".into()),
    })
}

fn call(session: &Session, path: &str, body: Value) -> Result<Value> {
    session.api.tiktok(
        session
            .api
            .post(&format!("{}{path}", session.endpoints.tiktok))
            .bearer_auth(session.token)
            .header("Content-Type", JSON)
            .body(body.to_string()),
    )
}

/// What the creator may choose right now. TikTok requires asking before every post.
pub fn options(session: &Session) -> Result<PublishOptions> {
    let data = call(session, "/v2/post/publish/creator_info/query/", json!({}))?;
    Ok(PublishOptions {
        privacy_levels: data["privacy_level_options"]
            .as_array()
            .into_iter()
            .flatten()
            .filter_map(|level| level.as_str().map(str::to_owned))
            .collect(),
        creator_name: text_of(&data, "creator_nickname"),
        max_video_seconds: data["max_video_post_duration_sec"].as_i64(),
    })
}

/// Chunk plan from the media transfer guide: chunks of 5 to 64 MB, the count is the
/// floor of size over chunk size, and the last chunk absorbs the remainder.
pub fn chunk_plan(bytes: u64) -> (u64, u64) {
    if bytes < MIN_CHUNK {
        (bytes, 1)
    } else {
        (CHUNK, (bytes / CHUNK).max(1))
    }
}

fn upload(session: &Session, url: &str, file: &MediaFile) -> Result<()> {
    let (chunk, count) = chunk_plan(file.bytes);
    let mut source = File::open(&file.path)?;
    for index in 0..count {
        let first = index * chunk;
        let last = if index + 1 == count {
            file.bytes - 1
        } else {
            first + chunk - 1
        };
        let mut part = vec![0; (last - first + 1) as usize];
        source.seek(SeekFrom::Start(first))?;
        source.read_exact(&mut part)?;
        // The upload URL authorises itself, so no token is attached.
        let (status, _) = session.api.send(
            session
                .api
                .put(url)
                .header("Content-Type", file.mime)
                .header(
                    "Content-Range",
                    format!("bytes {first}-{last}/{}", file.bytes),
                )
                .timeout(UPLOAD_TIMEOUT)
                .body(part),
        )?;
        if !matches!(status, StatusCode::CREATED | StatusCode::PARTIAL_CONTENT) {
            return Err(StudioError::Message(format!(
                "TikTok từ chối phần tải lên {} / {count} (HTTP {}).",
                index + 1,
                status.as_u16()
            )));
        }
    }
    Ok(())
}

fn status(session: &Session, publish_id: &str) -> Result<Value> {
    call(
        session,
        "/v2/post/publish/status/fetch/",
        json!({ "publish_id": publish_id }),
    )
}

fn await_post(session: &Session, publish_id: &str) -> Result<Published> {
    for attempt in 0..session.endpoints.polls {
        if attempt > 0 {
            thread::sleep(session.endpoints.poll);
        }
        let state = status(session, publish_id)?;
        match state["status"].as_str().unwrap_or_default() {
            "PUBLISH_COMPLETE" => {
                // The public id only appears for public posts after moderation.
                return Ok(Published {
                    remote_id: state["publicaly_available_post_id"].get(0).and_then(
                        |id| match id {
                            Value::String(text) => Some(text.clone()),
                            Value::Number(number) => Some(number.to_string()),
                            _ => None,
                        },
                    ),
                    permalink: None,
                });
            }
            "FAILED" => {
                return Err(StudioError::Message(format!(
                    "TikTok không đăng được video: {}",
                    state["fail_reason"].as_str().unwrap_or("không rõ lý do")
                )));
            }
            _ => {}
        }
    }
    Err(StudioError::Input(
        "TikTok vẫn đang xử lý video. Hãy thử lại sau để kiểm tra lượt đăng này.",
    ))
}

pub fn publish(
    session: &Session,
    post: &Post,
    resume: Option<&str>,
    keep: &mut dyn FnMut(&str),
) -> Result<Published> {
    let Media::File(file) = &post.media else {
        return Err(StudioError::Input(
            "TikTok cần một tệp video trên máy từ thư viện hoặc video đã xuất.",
        ));
    };
    // An earlier attempt may already be live, or fully uploaded and still processing.
    // Anything less is started again from the first byte.
    if let Some(previous) = resume
        && let Ok(state) = status(session, previous)
    {
        let uploaded = state["uploaded_bytes"].as_u64().unwrap_or(0) >= file.bytes;
        match state["status"].as_str() {
            Some("PUBLISH_COMPLETE") => return await_post(session, previous),
            Some("PROCESSING_UPLOAD") if uploaded => return await_post(session, previous),
            _ => {}
        }
    }
    if file.bytes > MAX_VIDEO {
        return Err(StudioError::Input(
            "Video lớn hơn giới hạn 4 GB của TikTok.",
        ));
    }
    let allowed = options(session)?;
    if !allowed.privacy_levels.contains(&post.privacy) {
        return Err(StudioError::Message(format!(
            "TikTok chỉ cho tài khoản này chọn: {}.",
            allowed.privacy_levels.join(", ")
        )));
    }
    let (chunk, count) = chunk_plan(file.bytes);
    let started = call(
        session,
        "/v2/post/publish/video/init/",
        json!({
            "post_info": {
                "title": post.caption,
                "privacy_level": post.privacy,
                "disable_duet": false,
                "disable_comment": false,
                "disable_stitch": false,
            },
            "source_info": {
                "source": "FILE_UPLOAD",
                "video_size": file.bytes,
                "chunk_size": chunk,
                "total_chunk_count": count,
            },
        }),
    )?;
    let publish_id = id_of(&started, "publish_id")?;
    keep(&publish_id);
    let target = session.endpoints.upload_url(
        started["upload_url"].as_str().unwrap_or_default(),
        "tiktokapis.com",
    )?;
    upload(session, target.as_str(), file)?;
    await_post(session, &publish_id)
}

pub fn list(session: &Session) -> Result<Vec<RemotePost>> {
    let data = session.api.tiktok(
        session
            .api
            .post(&format!("{}/v2/video/list/", session.endpoints.tiktok))
            .query(&[("fields", "id,title,video_description,create_time,share_url")])
            .bearer_auth(session.token)
            .header("Content-Type", JSON)
            .body(json!({ "max_count": 20 }).to_string()),
    )?;
    Ok(data["videos"]
        .as_array()
        .into_iter()
        .flatten()
        .filter_map(|item| {
            Some(RemotePost {
                id: id_of(item, "id").ok()?,
                text: text_of(item, "video_description")
                    .filter(|text| !text.is_empty())
                    .or_else(|| text_of(item, "title"))
                    .unwrap_or_default(),
                kind: "VIDEO".into(),
                permalink: text_of(item, "share_url"),
                created_at: item["create_time"].as_i64().map(|time| time.to_string()),
            })
        })
        .collect())
}

/// Needs the app's client key and secret next to the rotating refresh token.
pub fn refresh(api: &Api, endpoints: &Endpoints, secret: &Secret) -> Result<Refreshed> {
    let (Some(refresh_token), Some(client_key), Some(client_secret)) = (
        &secret.refresh_token,
        &secret.client_key,
        &secret.client_secret,
    ) else {
        return Err(StudioError::Input(
            "Làm mới token TikTok cần refresh token, client key và client secret. Hãy kết nối lại và nhập đủ.",
        ));
    };
    let renewed = api.tiktok(
        api.post(&format!("{}/v2/oauth/token/", endpoints.tiktok))
            .form(&[
                ("client_key", client_key.as_str()),
                ("client_secret", client_secret.as_str()),
                ("grant_type", "refresh_token"),
                ("refresh_token", refresh_token.as_str()),
            ]),
    )?;
    Ok(Refreshed {
        secret: Secret {
            access_token: text_of(&renewed, "access_token")
                .ok_or(StudioError::Input("TikTok không trả về token mới."))?,
            // The refresh token rotates, so the returned one replaces the stored one.
            refresh_token: text_of(&renewed, "refresh_token")
                .or_else(|| secret.refresh_token.clone()),
            ..secret.clone()
        },
        expires_at: renewed["expires_in"]
            .as_i64()
            .map(|seconds| unix_now() + seconds),
    })
}
