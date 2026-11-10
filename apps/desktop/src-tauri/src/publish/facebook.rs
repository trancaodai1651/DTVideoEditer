//! Facebook Pages API with a Page access token.

use std::fs::File;

use reqwest::blocking::multipart::Form;
use serde_json::Value;

use super::{
    Identity, Media, MediaFile, Post, Published, RemotePost, Session,
    http::{Api, Endpoints, GRAPH_VERSION, UPLOAD_TIMEOUT, id_of, text_of},
};
use crate::model::{Result, StudioError};

const UNSUPPORTED: StudioError =
    StudioError::Input("Facebook Page không hỗ trợ kiểu bài đăng này.");

pub fn identify(api: &Api, endpoints: &Endpoints, token: &str) -> Result<Identity> {
    // `category` only exists on a Page, so a user token is refused here instead of
    // failing later when the first post is sent.
    let me = api
        .graph(
            api.get(&format!("{}/{GRAPH_VERSION}/me", endpoints.graph))
                .query(&[("fields", "id,name,category"), ("access_token", token)]),
        )
        .map_err(|error| match error {
            StudioError::Message(detail) => StudioError::Message(format!(
                "Cần Page access token có quyền pages_manage_posts. {detail}"
            )),
            other => other,
        })?;
    Ok(Identity {
        remote_id: id_of(&me, "id")?,
        name: text_of(&me, "name").unwrap_or_else(|| "Facebook Page".into()),
    })
}

fn attach(form: Form, field: &'static str, file: &MediaFile) -> Result<Form> {
    Ok(form.file(field, &file.path)?)
}

fn permalink(session: &Session, object_id: &str) -> Option<String> {
    let detail = session
        .api
        .graph(
            session
                .api
                .get(&format!(
                    "{}/{GRAPH_VERSION}/{object_id}",
                    session.endpoints.graph
                ))
                .query(&[("fields", "permalink_url"), ("access_token", session.token)]),
        )
        .ok()?;
    let link = text_of(&detail, "permalink_url")?;
    Some(if link.starts_with('/') {
        format!("https://www.facebook.com{link}")
    } else {
        link
    })
}

fn reel(session: &Session, post: &Post) -> Result<Published> {
    let Session { api, token, .. } = *session;
    let edge = format!(
        "{}/{GRAPH_VERSION}/{}/video_reels",
        session.endpoints.graph, session.account.remote_id
    );
    let started = api.graph(
        api.post(&edge)
            .form(&[("upload_phase", "start"), ("access_token", token)]),
    )?;
    let video_id = id_of(&started, "video_id")?;
    let upload = session.endpoints.upload_url(
        started["upload_url"].as_str().unwrap_or_default(),
        "facebook.com",
    )?;
    let request = api
        .post(upload.as_str())
        .header("Authorization", format!("OAuth {token}"))
        .timeout(UPLOAD_TIMEOUT);
    let request = match &post.media {
        Media::File(file) => request
            .header("offset", "0")
            .header("file_size", file.bytes.to_string())
            .header("Content-Type", "application/octet-stream")
            .body(File::open(&file.path)?),
        Media::Url(url) => request.header("file_url", url.as_str()),
        Media::None => return Err(UNSUPPORTED),
    };
    let uploaded = api.graph(request)?;
    if uploaded["success"].as_bool() != Some(true) {
        return Err(StudioError::Input(
            "Facebook không xác nhận đã nhận video của Reel.",
        ));
    }
    let mut form = vec![
        ("upload_phase", "finish"),
        ("video_id", video_id.as_str()),
        ("video_state", "PUBLISHED"),
        ("description", post.caption.as_str()),
        ("access_token", token),
    ];
    if !post.title.is_empty() {
        form.push(("title", post.title.as_str()));
    }
    api.graph(api.post(&edge).form(&form))?;
    Ok(Published {
        permalink: Some(format!("https://www.facebook.com/reel/{video_id}")),
        remote_id: Some(video_id),
    })
}

pub fn publish(session: &Session, post: &Post) -> Result<Published> {
    let Session { api, token, .. } = *session;
    let page = &session.account.remote_id;
    let graph = format!("{}/{GRAPH_VERSION}", session.endpoints.graph);
    let created: Value;
    let object_id = match (post.format.as_str(), &post.media) {
        ("text", Media::None) => {
            created = api.graph(
                api.post(&format!("{graph}/{page}/feed"))
                    .form(&[("message", post.caption.as_str()), ("access_token", token)]),
            )?;
            id_of(&created, "id")?
        }
        ("image", media) => {
            let url = format!("{graph}/{page}/photos");
            created = match media {
                Media::Url(link) => api.graph(api.post(&url).form(&[
                    ("url", link.as_str()),
                    ("caption", post.caption.as_str()),
                    ("access_token", token),
                ]))?,
                Media::File(file) => {
                    let form = Form::new()
                        .text("access_token", token.to_owned())
                        .text("caption", post.caption.clone());
                    api.graph(
                        api.post(&url)
                            .multipart(attach(form, "source", file)?)
                            .timeout(UPLOAD_TIMEOUT),
                    )?
                }
                Media::None => return Err(UNSUPPORTED),
            };
            // A published photo also gets a Page post, which is what the feed lists.
            id_of(&created, "post_id").or_else(|_| id_of(&created, "id"))?
        }
        ("video", media) => {
            let url = format!(
                "{}/{GRAPH_VERSION}/{page}/videos",
                session.endpoints.graph_video
            );
            let mut form = Form::new()
                .text("access_token", token.to_owned())
                .text("description", post.caption.clone());
            if !post.title.is_empty() {
                form = form.text("title", post.title.clone());
            }
            let form = match media {
                Media::Url(link) => form.text("file_url", link.clone()),
                Media::File(file) => attach(form, "source", file)?,
                Media::None => return Err(UNSUPPORTED),
            };
            created = api.graph(api.post(&url).multipart(form).timeout(UPLOAD_TIMEOUT))?;
            id_of(&created, "id")?
        }
        ("reel", _) => return reel(session, post),
        _ => return Err(UNSUPPORTED),
    };
    Ok(Published {
        permalink: permalink(session, &object_id)
            .or_else(|| Some(format!("https://www.facebook.com/{object_id}"))),
        remote_id: Some(object_id),
    })
}

pub fn list(session: &Session) -> Result<Vec<RemotePost>> {
    let page = session.api.graph(
        session
            .api
            .get(&format!(
                "{}/{GRAPH_VERSION}/{}/published_posts",
                session.endpoints.graph, session.account.remote_id
            ))
            .query(&[
                (
                    "fields",
                    "id,message,created_time,permalink_url,status_type",
                ),
                ("limit", "25"),
                ("access_token", session.token),
            ]),
    )?;
    Ok(page["data"]
        .as_array()
        .into_iter()
        .flatten()
        .filter_map(|item| {
            Some(RemotePost {
                id: id_of(item, "id").ok()?,
                text: text_of(item, "message").unwrap_or_default(),
                kind: text_of(item, "status_type").unwrap_or_default(),
                permalink: text_of(item, "permalink_url"),
                created_at: text_of(item, "created_time"),
            })
        })
        .collect())
}

pub fn edit(session: &Session, remote_id: &str, message: &str) -> Result<()> {
    session.api.graph(
        session
            .api
            .post(&format!(
                "{}/{GRAPH_VERSION}/{remote_id}",
                session.endpoints.graph
            ))
            .form(&[("message", message), ("access_token", session.token)]),
    )?;
    Ok(())
}

pub fn delete(session: &Session, remote_id: &str) -> Result<()> {
    session.api.graph(
        session
            .api
            .delete(&format!(
                "{}/{GRAPH_VERSION}/{remote_id}",
                session.endpoints.graph
            ))
            .query(&[("access_token", session.token)]),
    )?;
    Ok(())
}
