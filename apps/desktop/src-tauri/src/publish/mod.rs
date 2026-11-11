//! Publishing to Threads, Facebook Pages, Instagram and TikTok through their official APIs.
//!
//! Tokens live in the OS keychain, SQLite keeps references and job state, and nothing is
//! sent before the caller has recorded the user's approval of that exact job.

mod facebook;
pub mod http;
mod instagram;
mod records;
pub mod secrets;
#[cfg(test)]
mod tests;
mod threads;
mod tiktok;

use std::{
    path::PathBuf,
    time::{SystemTime, UNIX_EPOCH},
};

use reqwest::Url;
use serde::{Deserialize, Serialize};

use crate::{
    library::authorized_asset,
    model::{Result, StudioError},
    store::Store,
};
use http::{Api, Endpoints};
use secrets::{Secret, SecretStore};

pub const INSTAGRAM_LOGIN: &str = "instagram_login";
pub const FACEBOOK_LOGIN: &str = "facebook_login";
const TIKTOK_PRIVACY: [&str; 4] = [
    "PUBLIC_TO_EVERYONE",
    "MUTUAL_FOLLOW_FRIENDS",
    "FOLLOWER_OF_CREATOR",
    "SELF_ONLY",
];
const WEEK: i64 = 7 * 24 * 60 * 60;

#[derive(Clone, Copy, Debug, PartialEq, Eq)]
pub enum Platform {
    Threads,
    Facebook,
    Instagram,
    Tiktok,
}

impl Platform {
    pub fn parse(value: &str) -> Result<Self> {
        Ok(match value {
            "threads" => Self::Threads,
            "facebook" => Self::Facebook,
            "instagram" => Self::Instagram,
            "tiktok" => Self::Tiktok,
            _ => return Err(StudioError::Input("Nền tảng không được hỗ trợ.")),
        })
    }

    pub fn as_str(self) -> &'static str {
        match self {
            Self::Threads => "threads",
            Self::Facebook => "facebook",
            Self::Instagram => "instagram",
            Self::Tiktok => "tiktok",
        }
    }

    pub fn label(self) -> &'static str {
        match self {
            Self::Threads => "Threads",
            Self::Facebook => "Facebook Page",
            Self::Instagram => "Instagram",
            Self::Tiktok => "TikTok",
        }
    }
}

/// What an account can do through the API, so the UI only offers real options.
#[derive(Clone, Debug, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct Capabilities {
    pub formats: Vec<&'static str>,
    /// Formats that accept a public URL.
    pub url_media: Vec<&'static str>,
    /// Formats that accept a file from the library or a finished export.
    pub local_media: Vec<&'static str>,
    pub delete: bool,
    pub edit: bool,
    pub refresh: bool,
    pub privacy: bool,
    pub caption_limit: usize,
}

pub fn capabilities(platform: Platform, variant: &str) -> Capabilities {
    let through_page = variant == FACEBOOK_LOGIN;
    match platform {
        Platform::Threads => Capabilities {
            formats: vec!["text", "image", "video"],
            url_media: vec!["image", "video"],
            local_media: vec![],
            delete: true,
            edit: false,
            refresh: true,
            privacy: false,
            caption_limit: 500,
        },
        Platform::Facebook => Capabilities {
            formats: vec!["text", "image", "video", "reel"],
            url_media: vec!["image", "video", "reel"],
            local_media: vec!["image", "video", "reel"],
            delete: true,
            edit: true,
            refresh: false,
            privacy: false,
            caption_limit: 60_000,
        },
        Platform::Instagram => Capabilities {
            formats: vec!["image", "reel"],
            url_media: vec!["image", "reel"],
            local_media: if through_page { vec!["reel"] } else { vec![] },
            delete: through_page,
            edit: false,
            refresh: !through_page,
            privacy: false,
            caption_limit: 2200,
        },
        Platform::Tiktok => Capabilities {
            formats: vec!["video"],
            url_media: vec![],
            local_media: vec!["video"],
            delete: false,
            edit: false,
            refresh: true,
            privacy: true,
            caption_limit: 2200,
        },
    }
}

#[derive(Clone, Debug)]
pub struct Account {
    pub id: i64,
    pub platform: Platform,
    pub variant: String,
    pub remote_id: String,
    pub name: String,
    pub secret_ref: String,
    pub expires_at: Option<i64>,
}

#[derive(Debug, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct SocialAccount {
    pub id: i64,
    pub platform: &'static str,
    pub variant: String,
    pub remote_id: String,
    pub name: String,
    pub expires_at: Option<i64>,
    pub capabilities: Capabilities,
}

impl From<Account> for SocialAccount {
    fn from(account: Account) -> Self {
        Self {
            capabilities: capabilities(account.platform, &account.variant),
            id: account.id,
            platform: account.platform.as_str(),
            variant: account.variant,
            remote_id: account.remote_id,
            name: account.name,
            expires_at: account.expires_at,
        }
    }
}

#[derive(Deserialize)]
#[serde(rename_all = "camelCase", deny_unknown_fields)]
pub struct ConnectInput {
    pub platform: String,
    #[serde(default)]
    pub variant: String,
    pub access_token: String,
    #[serde(default)]
    pub refresh_token: Option<String>,
    #[serde(default)]
    pub client_key: Option<String>,
    #[serde(default)]
    pub client_secret: Option<String>,
}

#[derive(Clone, Debug, Deserialize)]
#[serde(rename_all = "camelCase", deny_unknown_fields)]
pub struct DraftInput {
    pub account_id: i64,
    pub format: String,
    pub caption: String,
    #[serde(default)]
    pub title: String,
    #[serde(default)]
    pub privacy: String,
    #[serde(default)]
    pub media_url: Option<String>,
    #[serde(default)]
    pub asset_id: Option<i64>,
    #[serde(default)]
    pub render_job_id: Option<i64>,
}

#[derive(Clone, Debug, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct PublishJob {
    pub id: i64,
    pub account_id: i64,
    pub platform: String,
    pub account_name: String,
    pub format: String,
    pub caption: String,
    pub title: String,
    pub privacy: String,
    pub media: String,
    /// URL, library path or export path, for display.
    pub media_label: Option<String>,
    pub status: String,
    pub remote_id: Option<String>,
    pub permalink: Option<String>,
    pub error: Option<String>,
    pub created_at: String,
    pub published_at: Option<String>,
}

/// A job as the worker needs it.
pub struct PublishTask {
    pub account_id: i64,
    pub format: String,
    pub caption: String,
    pub title: String,
    pub privacy: String,
    pub media: String,
    pub media_url: Option<String>,
    pub asset_id: Option<i64>,
    pub render_job_id: Option<i64>,
    pub remote_ref: Option<String>,
}

#[derive(Debug, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct RemotePost {
    pub id: String,
    pub text: String,
    pub kind: String,
    pub permalink: Option<String>,
    pub created_at: Option<String>,
}

#[derive(Debug, Default, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct PublishOptions {
    pub privacy_levels: Vec<String>,
    pub creator_name: Option<String>,
    pub max_video_seconds: Option<i64>,
}

pub struct MediaFile {
    pub path: PathBuf,
    pub bytes: u64,
    pub mime: &'static str,
}

pub enum Media {
    None,
    Url(String),
    File(MediaFile),
}

pub struct Post {
    pub format: String,
    pub caption: String,
    pub title: String,
    pub privacy: String,
    pub media: Media,
}

#[derive(Debug)]
pub struct Published {
    /// None when a retry finds the post already live but cannot learn its id.
    pub remote_id: Option<String>,
    pub permalink: Option<String>,
}

pub struct Identity {
    pub remote_id: String,
    pub name: String,
}

pub struct Refreshed {
    pub secret: Secret,
    pub expires_at: Option<i64>,
}

/// One authenticated conversation with a platform.
pub struct Session<'a> {
    pub api: &'a Api,
    pub endpoints: &'a Endpoints,
    pub account: &'a Account,
    pub token: &'a str,
}

pub fn unix_now() -> i64 {
    SystemTime::now()
        .duration_since(UNIX_EPOCH)
        .map_or(0, |elapsed| elapsed.as_secs() as i64)
}

fn check_variant(platform: Platform, variant: &str) -> Result<()> {
    let valid = match platform {
        Platform::Instagram => matches!(variant, INSTAGRAM_LOGIN | FACEBOOK_LOGIN),
        _ => variant.is_empty(),
    };
    if valid {
        Ok(())
    } else {
        Err(StudioError::Input(
            "Kiểu kết nối không hợp lệ với nền tảng này.",
        ))
    }
}

fn public_url(raw: &str) -> bool {
    raw.len() <= 2000
        && Url::parse(raw).is_ok_and(|url| url.scheme() == "https" && url.host_str().is_some())
}

/// Checks a draft against what the target platform accepts, before anything is stored or sent.
/// `asset_kind` is the library kind when the draft points at an asset.
pub fn check_draft(
    platform: Platform,
    variant: &str,
    draft: &DraftInput,
    asset_kind: Option<&str>,
) -> Result<()> {
    let rules = capabilities(platform, variant);
    let format = draft.format.as_str();
    if !rules.formats.contains(&format) {
        return Err(StudioError::Input(
            "Nền tảng này không hỗ trợ định dạng bài đăng đã chọn.",
        ));
    }
    let units = if platform == Platform::Tiktok {
        draft.caption.encode_utf16().count()
    } else {
        draft.caption.chars().count()
    };
    if units > rules.caption_limit || draft.title.chars().count() > 255 {
        return Err(StudioError::Input(
            "Nội dung dài hơn giới hạn của nền tảng.",
        ));
    }
    let sources = [
        draft.media_url.is_some(),
        draft.asset_id.is_some(),
        draft.render_job_id.is_some(),
    ];
    let attached = sources.iter().filter(|present| **present).count();
    if format == "text" {
        if attached != 0 || draft.caption.trim().is_empty() {
            return Err(StudioError::Input(
                "Bài chữ cần nội dung và không kèm media.",
            ));
        }
    } else if attached != 1 {
        return Err(StudioError::Input(
            "Chọn đúng một nguồn media cho bài đăng.",
        ));
    } else if let Some(url) = &draft.media_url {
        if !rules.url_media.contains(&format) {
            return Err(StudioError::Input(
                "Nền tảng này không nhận media qua URL cho định dạng đã chọn.",
            ));
        }
        if !public_url(url) {
            return Err(StudioError::Input(
                "URL media phải là địa chỉ https công khai.",
            ));
        }
    } else {
        if !rules.local_media.contains(&format) {
            return Err(StudioError::Input(
                "Nền tảng này chỉ nhận media qua URL công khai cho định dạng đã chọn.",
            ));
        }
        let wanted = if format == "image" { "image" } else { "video" };
        let kind = if draft.render_job_id.is_some() {
            Some("video")
        } else {
            asset_kind
        };
        if kind != Some(wanted) {
            return Err(StudioError::Input(
                "Loại media không khớp với định dạng bài đăng.",
            ));
        }
    }
    let privacy = draft.privacy.as_str();
    if rules.privacy != TIKTOK_PRIVACY.contains(&privacy) || (!rules.privacy && !privacy.is_empty())
    {
        return Err(StudioError::Input(if rules.privacy {
            "Chọn chế độ hiển thị cho bài TikTok."
        } else {
            "Nền tảng này không dùng chế độ hiển thị."
        }));
    }
    Ok(())
}

fn media_file(path: PathBuf) -> Result<MediaFile> {
    let unusable = StudioError::Input("Tệp media của bài đăng không còn dùng được.");
    let mime = match path
        .extension()
        .and_then(|extension| extension.to_str())
        .map(str::to_ascii_lowercase)
        .as_deref()
    {
        Some("mp4" | "m4v") => "video/mp4",
        Some("mov") => "video/quicktime",
        Some("webm") => "video/webm",
        Some("jpg" | "jpeg") => "image/jpeg",
        Some("png") => "image/png",
        _ => {
            return Err(StudioError::Input(
                "Định dạng tệp này không đăng trực tiếp được. Hãy dùng MP4, MOV, WebM, JPG hoặc PNG.",
            ));
        }
    };
    let Ok(metadata) = std::fs::metadata(&path) else {
        return Err(unusable);
    };
    if !metadata.is_file() || metadata.len() == 0 {
        return Err(unusable);
    }
    Ok(MediaFile {
        bytes: metadata.len(),
        path,
        mime,
    })
}

/// Ties the store, the keychain and the platform adapters together.
pub struct Publisher {
    pub api: Api,
    pub endpoints: Endpoints,
    pub secrets: Box<dyn SecretStore>,
}

impl Publisher {
    pub fn new() -> Result<Self> {
        Ok(Self {
            api: Api::new(true)?,
            endpoints: Endpoints::default(),
            secrets: Box::new(secrets::Keychain),
        })
    }

    fn session<'a>(&'a self, account: &'a Account, token: &'a str) -> Session<'a> {
        Session {
            api: &self.api,
            endpoints: &self.endpoints,
            account,
            token,
        }
    }

    /// Verifies a token with the platform, then stores it in the keychain and the
    /// account reference in SQLite.
    pub fn connect(&self, store: &Store, input: ConnectInput) -> Result<SocialAccount> {
        let platform = Platform::parse(&input.platform)?;
        check_variant(platform, &input.variant)?;
        let clean = |value: Option<String>| {
            value
                .map(|text| text.trim().to_owned())
                .filter(|text| !text.is_empty())
        };
        let secret = Secret {
            access_token: input.access_token.trim().to_owned(),
            refresh_token: clean(input.refresh_token),
            client_key: clean(input.client_key),
            client_secret: clean(input.client_secret),
        };
        if secret.access_token.is_empty() || secret.access_token.chars().any(char::is_whitespace) {
            return Err(StudioError::Input("Access token không hợp lệ."));
        }
        let (api, endpoints, token) = (&self.api, &self.endpoints, secret.access_token.as_str());
        let identity = match platform {
            Platform::Threads => threads::identify(api, endpoints, token),
            Platform::Facebook => facebook::identify(api, endpoints, token),
            Platform::Instagram => instagram::identify(api, endpoints, &input.variant, token),
            Platform::Tiktok => tiktok::identify(api, endpoints, token),
        }?;
        check_remote_id(&identity.remote_id)?;
        let secret_ref = format!(
            "social-{}-{}-{}",
            platform.as_str(),
            input.variant,
            identity.remote_id
        );
        secrets::save(self.secrets.as_ref(), &secret_ref, &secret)?;
        let id = store.save_social_account(
            platform.as_str(),
            &input.variant,
            &identity.remote_id,
            &identity.name,
            &secret_ref,
        )?;
        Ok(store.social_account(id)?.into())
    }

    /// Forgets the account locally. The keychain entry goes first so a failure
    /// never leaves a token without a visible account.
    pub fn disconnect(&self, store: &Store, account_id: i64) -> Result<()> {
        let account = store.social_account(account_id)?;
        self.secrets.delete(&account.secret_ref)?;
        store.delete_social_account(account_id)
    }

    fn renew(&self, store: &Store, account: &Account, secret: &Secret) -> Result<Secret> {
        let (api, endpoints) = (&self.api, &self.endpoints);
        let refreshed = match (account.platform, account.variant.as_str()) {
            (Platform::Threads, _) => threads::refresh(api, endpoints, secret),
            (Platform::Instagram, INSTAGRAM_LOGIN) => instagram::refresh(api, endpoints, secret),
            (Platform::Tiktok, _) => tiktok::refresh(api, endpoints, secret),
            _ => Err(StudioError::Input(
                "Token của kiểu kết nối này không làm mới qua API. Hãy kết nối lại khi hết hạn.",
            )),
        }?;
        secrets::save(
            self.secrets.as_ref(),
            &account.secret_ref,
            &refreshed.secret,
        )?;
        store.set_account_expiry(account.id, refreshed.expires_at)?;
        Ok(refreshed.secret)
    }

    pub fn refresh(&self, store: &Store, account_id: i64) -> Result<SocialAccount> {
        let account = store.social_account(account_id)?;
        let secret = secrets::load(self.secrets.as_ref(), &account.secret_ref)?;
        self.renew(store, &account, &secret)?;
        Ok(store.social_account(account_id)?.into())
    }

    /// The access token for a call, renewed first when it is about to expire.
    fn token(&self, store: &Store, account: &Account) -> Result<String> {
        let secret = secrets::load(self.secrets.as_ref(), &account.secret_ref)?;
        let left = account.expires_at.map(|at| at - unix_now());
        let due = match (account.platform, account.variant.as_str()) {
            // TikTok tokens last hours, so renew whenever the app can.
            (Platform::Tiktok, _) => {
                secret.refresh_token.is_some() && left.is_none_or(|seconds| seconds < 300)
            }
            (Platform::Threads, _) | (Platform::Instagram, INSTAGRAM_LOGIN) => {
                left.is_some_and(|seconds| seconds < WEEK)
            }
            _ => false,
        };
        if due && let Ok(renewed) = self.renew(store, account, &secret) {
            return Ok(renewed.access_token);
        }
        Ok(secret.access_token)
    }

    pub fn options(&self, store: &Store, account_id: i64) -> Result<PublishOptions> {
        let account = store.social_account(account_id)?;
        if account.platform != Platform::Tiktok {
            return Ok(PublishOptions::default());
        }
        let token = self.token(store, &account)?;
        tiktok::options(&self.session(&account, &token))
    }

    fn media(&self, store: &Store, task: &PublishTask) -> Result<Media> {
        let gone = StudioError::Input("Media của bài đăng không còn trong thư viện.");
        Ok(match task.media.as_str() {
            "none" => Media::None,
            "url" => Media::Url(task.media_url.clone().ok_or(gone)?),
            "asset" => {
                let Some(asset) = store.source(task.asset_id.ok_or(gone)?, false)? else {
                    return Err(StudioError::Input(
                        "Media của bài đăng không còn khả dụng. Hãy quét lại thư viện.",
                    ));
                };
                let (path, _) = authorized_asset(&asset)?;
                Media::File(media_file(path)?)
            }
            _ => {
                let job = store.render_job(task.render_job_id.ok_or(StudioError::Input(
                    "Lượt xuất video của bài đăng không còn tồn tại.",
                ))?)?;
                if job.status != "done" {
                    return Err(StudioError::Input(
                        "Video chưa xuất xong nên chưa thể đăng.",
                    ));
                }
                Media::File(media_file(PathBuf::from(job.output_path))?)
            }
        })
    }

    fn publish(&self, store: &Store, job_id: i64) -> Result<Published> {
        let task = store.publish_task(job_id)?;
        let account = store.social_account(task.account_id)?;
        let token = self.token(store, &account)?;
        let post = Post {
            media: self.media(store, &task)?,
            format: task.format,
            caption: task.caption,
            title: task.title,
            privacy: task.privacy,
        };
        let session = self.session(&account, &token);
        let resume = task.remote_ref.as_deref();
        let mut keep = |reference: &str| {
            let _ = store.set_publish_ref(job_id, reference);
        };
        match account.platform {
            Platform::Threads => threads::publish(&session, &post, resume, &mut keep),
            Platform::Facebook => facebook::publish(&session, &post),
            Platform::Instagram => instagram::publish(&session, &post, resume, &mut keep),
            Platform::Tiktok => tiktok::publish(&session, &post, resume, &mut keep),
        }
    }

    /// Publishes a job that is already in the `publishing` state and records the outcome.
    pub fn run_job(&self, store: &Store, job_id: i64) {
        let _ = match self.publish(store, job_id) {
            Ok(done) => {
                store.finish_publish(job_id, done.remote_id.as_deref(), done.permalink.as_deref())
            }
            Err(error) => store.fail_publish(job_id, &error.to_string()),
        };
    }

    pub fn remote_posts(&self, store: &Store, account_id: i64) -> Result<Vec<RemotePost>> {
        let account = store.social_account(account_id)?;
        let token = self.token(store, &account)?;
        let session = self.session(&account, &token);
        match account.platform {
            Platform::Threads => threads::list(&session),
            Platform::Facebook => facebook::list(&session),
            Platform::Instagram => instagram::list(&session),
            Platform::Tiktok => tiktok::list(&session),
        }
    }

    pub fn delete_remote(&self, store: &Store, account_id: i64, remote_id: &str) -> Result<()> {
        let account = store.social_account(account_id)?;
        check_remote_id(remote_id)?;
        if !capabilities(account.platform, &account.variant).delete {
            return Err(StudioError::Input(
                "Nền tảng này không cho xóa bài qua API với kiểu kết nối hiện tại.",
            ));
        }
        let token = self.token(store, &account)?;
        let session = self.session(&account, &token);
        match account.platform {
            Platform::Threads => threads::delete(&session, remote_id),
            Platform::Facebook => facebook::delete(&session, remote_id),
            _ => instagram::delete(&session, remote_id),
        }?;
        store.mark_remote_removed(account_id, remote_id)
    }

    pub fn edit_remote(
        &self,
        store: &Store,
        account_id: i64,
        remote_id: &str,
        message: &str,
    ) -> Result<()> {
        let account = store.social_account(account_id)?;
        check_remote_id(remote_id)?;
        let rules = capabilities(account.platform, &account.variant);
        if !rules.edit {
            return Err(StudioError::Input(
                "Nền tảng này không cho sửa bài qua API.",
            ));
        }
        if message.trim().is_empty() || message.chars().count() > rules.caption_limit {
            return Err(StudioError::Input(
                "Nội dung mới trống hoặc dài hơn giới hạn của nền tảng.",
            ));
        }
        let token = self.token(store, &account)?;
        facebook::edit(&self.session(&account, &token), remote_id, message)?;
        store.update_remote_caption(account_id, remote_id, message)
    }
}

/// Remote ids are placed in URL paths, so only the characters platforms use are allowed.
fn check_remote_id(remote_id: &str) -> Result<()> {
    let valid = !remote_id.is_empty()
        && remote_id.len() <= 128
        && remote_id
            .chars()
            .all(|c| c.is_ascii_alphanumeric() || c == '_' || c == '-');
    if valid {
        Ok(())
    } else {
        Err(StudioError::Input("Mã bài đăng không hợp lệ."))
    }
}
