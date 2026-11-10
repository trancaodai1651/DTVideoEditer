//! Threads API. Media is only accepted as a public URL; there is no file upload.

use super::{
    Identity, Media, Post, Published, Refreshed, RemotePost, Session,
    http::{Api, Endpoints, id_of, text_of},
    secrets::Secret,
    unix_now,
};
use crate::model::{Result, StudioError};

pub fn identify(api: &Api, endpoints: &Endpoints, token: &str) -> Result<Identity> {
    let me = api.graph(
        api.get(&format!("{}/v1.0/me", endpoints.threads))
            .query(&[("fields", "id,username,name"), ("access_token", token)]),
    )?;
    Ok(Identity {
        remote_id: id_of(&me, "id")?,
        name: text_of(&me, "username")
            .or_else(|| text_of(&me, "name"))
            .unwrap_or_else(|| "Threads".into()),
    })
}

pub fn publish(
    session: &Session,
    post: &Post,
    resume: Option<&str>,
    keep: &mut dyn FnMut(&str),
) -> Result<Published> {
    let Session { api, token, .. } = *session;
    let base = format!("{}/v1.0", session.endpoints.threads);
    let user = &session.account.remote_id;

    // A container from an earlier attempt is reused so a retry cannot post twice.
    let mut container = None;
    if let Some(previous) = resume {
        let state = api.graph(
            api.get(&format!("{base}/{previous}"))
                .query(&[("fields", "id,status"), ("access_token", token)]),
        );
        match state.as_ref().map(|state| state["status"].as_str()) {
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
            let mut form = vec![("access_token", token), ("text", post.caption.as_str())];
            match (post.format.as_str(), &post.media) {
                ("text", Media::None) => form.push(("media_type", "TEXT")),
                ("image", Media::Url(url)) => {
                    form.extend([("media_type", "IMAGE"), ("image_url", url.as_str())]);
                }
                ("video", Media::Url(url)) => {
                    form.extend([("media_type", "VIDEO"), ("video_url", url.as_str())]);
                }
                _ => {
                    return Err(StudioError::Input(
                        "Threads chỉ nhận bài chữ hoặc ảnh, video qua URL công khai.",
                    ));
                }
            }
            let created = api.graph(api.post(&format!("{base}/{user}/threads")).form(&form))?;
            let id = id_of(&created, "id")?;
            keep(&id);
            id
        }
    };
    api.wait_container(
        session.endpoints,
        &format!("{base}/{container}"),
        token,
        "status",
        "error_message",
    )?;
    let published = api.graph(
        api.post(&format!("{base}/{user}/threads_publish"))
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
                "{}/v1.0/{}/threads",
                session.endpoints.threads, session.account.remote_id
            ))
            .query(&[
                ("fields", "id,media_type,text,permalink,timestamp"),
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
                text: text_of(item, "text").unwrap_or_default(),
                kind: text_of(item, "media_type").unwrap_or_default(),
                permalink: text_of(item, "permalink"),
                created_at: text_of(item, "timestamp"),
            })
        })
        .collect())
}

pub fn delete(session: &Session, remote_id: &str) -> Result<()> {
    session.api.graph(
        session
            .api
            .delete(&format!("{}/v1.0/{remote_id}", session.endpoints.threads))
            .query(&[("access_token", session.token)]),
    )?;
    Ok(())
}

/// Long-lived tokens renew with the token alone once they are a day old.
pub fn refresh(api: &Api, endpoints: &Endpoints, secret: &Secret) -> Result<Refreshed> {
    let renewed = api.graph(
        api.get(&format!("{}/refresh_access_token", endpoints.threads))
            .query(&[
                ("grant_type", "th_refresh_token"),
                ("access_token", secret.access_token.as_str()),
            ]),
    )?;
    Ok(Refreshed {
        secret: Secret {
            access_token: text_of(&renewed, "access_token")
                .ok_or(StudioError::Input("Threads không trả về token mới."))?,
            ..secret.clone()
        },
        expires_at: renewed["expires_in"]
            .as_i64()
            .map(|seconds| unix_now() + seconds),
    })
}
