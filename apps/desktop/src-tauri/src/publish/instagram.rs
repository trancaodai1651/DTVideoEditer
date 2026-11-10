//! Instagram content publishing. Two token types are supported:
//! Instagram Login (graph.instagram.com, URL media only) and a Facebook Page token
//! (graph.facebook.com, which adds resumable upload of local Reels and deletion).

use std::fs::File;

use serde_json::Value;

use super::{
    FACEBOOK_LOGIN, Identity, Media, Post, Published, Refreshed, RemotePost, Session,
    http::{Api, Endpoints, GRAPH_VERSION, UPLOAD_TIMEOUT, id_of, text_of},
    secrets::Secret,
    unix_now,
};
use crate::model::{Result, StudioError};

fn base(endpoints: &Endpoints, variant: &str) -> String {
    let host = if variant == FACEBOOK_LOGIN {
        &endpoints.graph
    } else {
        &endpoints.instagram
    };
    format!("{host}/{GRAPH_VERSION}")
}

pub fn identify(api: &Api, endpoints: &Endpoints, variant: &str, token: &str) -> Result<Identity> {
    let url = format!("{}/me", base(endpoints, variant));
    if variant == FACEBOOK_LOGIN {
        let page = api.graph(api.get(&url).query(&[
            ("fields", "instagram_business_account{id,username}"),
            ("access_token", token),
        ]))?;
        let account = &page["instagram_business_account"];
        return Ok(Identity {
            remote_id: id_of(account, "id").map_err(|_| {
                StudioError::Input(
                    "Page này chưa liên kết tài khoản Instagram chuyên nghiệp, hoặc token không phải Page access token.",
                )
            })?,
            name: text_of(account, "username").unwrap_or_else(|| "Instagram".into()),
        });
    }
    let me = api.graph(
        api.get(&url)
            .query(&[("fields", "user_id,username"), ("access_token", token)]),
    )?;
    // The documented example wraps the profile in `data`, live responses are usually flat.
    let me = me["data"].get(0).unwrap_or(&me);
    Ok(Identity {
        remote_id: id_of(me, "user_id")?,
        name: text_of(me, "username").unwrap_or_else(|| "Instagram".into()),
    })
}

fn create_container(session: &Session, post: &Post, base: &str) -> Result<Value> {
    let Session { api, token, .. } = *session;
    let url = format!("{base}/{}/media", session.account.remote_id);
    let mut form = vec![("caption", post.caption.as_str()), ("access_token", token)];
    match (post.format.as_str(), &post.media) {
        ("image", Media::Url(link)) => form.push(("image_url", link.as_str())),
        ("reel", Media::Url(link)) => {
            form.extend([("media_type", "REELS"), ("video_url", link.as_str())]);
        }
        ("reel", Media::File(file)) if session.account.variant == FACEBOOK_LOGIN => {
            form.extend([("media_type", "REELS"), ("upload_type", "resumable")]);
            let created = api.graph(api.post(&url).form(&form))?;
            let upload = session
                .endpoints
                .upload_url(created["uri"].as_str().unwrap_or_default(), "facebook.com")?;
            let uploaded = api.graph(
                api.post(upload.as_str())
                    .header("Authorization", format!("OAuth {token}"))
                    .header("offset", "0")
                    .header("file_size", file.bytes.to_string())
                    .timeout(UPLOAD_TIMEOUT)
                    .body(File::open(&file.path)?),
            )?;
            if uploaded["success"].as_bool() != Some(true) {
                return Err(StudioError::Message(format!(
                    "Instagram không nhận video: {}",
                    uploaded["debug_info"]["message"]
                        .as_str()
                        .unwrap_or("không rõ lý do")
                )));
            }
            return Ok(created);
        }
        _ => {
            return Err(StudioError::Input(
                "Instagram nhận ảnh JPEG hoặc Reel qua URL công khai. Tệp video trên máy chỉ đăng được khi kết nối qua Facebook Page.",
            ));
        }
    }
    api.graph(api.post(&url).form(&form))
}

pub fn publish(
    session: &Session,
    post: &Post,
    resume: Option<&str>,
    keep: &mut dyn FnMut(&str),
) -> Result<Published> {
    let Session { api, token, .. } = *session;
    let base = base(session.endpoints, &session.account.variant);
    let mut container = None;
    if let Some(previous) = resume {
        let state = api.graph(
            api.get(&format!("{base}/{previous}"))
                .query(&[("fields", "id,status_code"), ("access_token", token)]),
        );
        match state.as_ref().map(|state| state["status_code"].as_str()) {
            Ok(Some("PUBLISHED")) => {
                return Ok(Published {
                    remote_id: None,
                    permalink: None,
                });
            }
            Ok(Some("FINISHED" | "IN_PROGRESS")) => container = Some(previous.to_owned()),
            _ => {}
        }
    }
    let container = match container {
        Some(id) => id,
        None => {
            let id = id_of(&create_container(session, post, &base)?, "id")?;
            keep(&id);
            id
        }
    };
    api.wait_container(
        session.endpoints,
        &format!("{base}/{container}"),
        token,
        "status_code",
        "status",
    )?;
    let published = api.graph(
        api.post(&format!(
            "{base}/{}/media_publish",
            session.account.remote_id
        ))
        .form(&[("creation_id", container.as_str()), ("access_token", token)]),
    )?;
    let id = id_of(&published, "id")?;
    let permalink = api
        .graph(
            api.get(&format!("{base}/{id}"))
                .query(&[("fields", "id,permalink"), ("access_token", token)]),
        )
        .ok()
        .and_then(|detail| text_of(&detail, "permalink"));
    Ok(Published {
        remote_id: Some(id),
        permalink,
    })
}

pub fn list(session: &Session) -> Result<Vec<RemotePost>> {
    let page = session.api.graph(
        session
            .api
            .get(&format!(
                "{}/{}/media",
                base(session.endpoints, &session.account.variant),
                session.account.remote_id
            ))
            .query(&[
                (
                    "fields",
                    "id,caption,media_type,media_product_type,permalink,timestamp",
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
                text: text_of(item, "caption").unwrap_or_default(),
                // A published Reel reports media_type VIDEO, the product type tells them apart.
                kind: text_of(item, "media_product_type")
                    .or_else(|| text_of(item, "media_type"))
                    .unwrap_or_default(),
                permalink: text_of(item, "permalink"),
                created_at: text_of(item, "timestamp"),
            })
        })
        .collect())
}

/// Only offered for Page-token accounts (see `capabilities`).
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

pub fn refresh(api: &Api, endpoints: &Endpoints, secret: &Secret) -> Result<Refreshed> {
    let renewed = api.graph(
        api.get(&format!("{}/refresh_access_token", endpoints.instagram))
            .query(&[
                ("grant_type", "ig_refresh_token"),
                ("access_token", secret.access_token.as_str()),
            ]),
    )?;
    Ok(Refreshed {
        secret: Secret {
            access_token: text_of(&renewed, "access_token")
                .ok_or(StudioError::Input("Instagram không trả về token mới."))?,
            ..secret.clone()
        },
        expires_at: renewed["expires_in"]
            .as_i64()
            .map(|seconds| unix_now() + seconds),
    })
}
