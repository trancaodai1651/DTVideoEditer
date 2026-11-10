use std::{io::Read, thread, time::Duration};

use reqwest::{
    StatusCode, Url,
    blocking::{Client, RequestBuilder},
};
use serde_json::Value;

use crate::model::{Result, StudioError};

/// Newest Graph API version with a published release date when this was written.
pub const GRAPH_VERSION: &str = "v26.0";
pub const UPLOAD_TIMEOUT: Duration = Duration::from_secs(2 * 60 * 60);
const MAX_BODY: u64 = 1024 * 1024;
const RECONNECT: StudioError =
    StudioError::Input("Token đã hết hạn hoặc không hợp lệ. Hãy kết nối lại tài khoản.");

/// API hosts and polling pace. Tests point these at a local server.
pub struct Endpoints {
    pub threads: String,
    pub graph: String,
    pub graph_video: String,
    pub instagram: String,
    pub tiktok: String,
    /// Extra hosts allowed for upload URLs. Empty outside tests.
    pub upload_hosts: Vec<String>,
    pub poll: Duration,
    pub polls: u32,
}

impl Default for Endpoints {
    fn default() -> Self {
        Self {
            threads: "https://graph.threads.com".into(),
            graph: "https://graph.facebook.com".into(),
            // Meta's video overview retires graph-video.facebook.com in favour of the main host.
            graph_video: "https://graph.facebook.com".into(),
            instagram: "https://graph.instagram.com".into(),
            tiktok: "https://open.tiktokapis.com".into(),
            upload_hosts: Vec::new(),
            poll: Duration::from_secs(10),
            polls: 36,
        }
    }
}

impl Endpoints {
    /// Upload URLs come from API responses, so they must stay on the platform's own domain
    /// before a token or media is sent to them.
    pub fn upload_url(&self, raw: &str, domain: &str) -> Result<Url> {
        let refused = StudioError::Input("Nền tảng trả về địa chỉ tải lên không hợp lệ.");
        let Ok(url) = Url::parse(raw) else {
            return Err(refused);
        };
        let host = url.host_str().unwrap_or_default();
        let trusted =
            url.scheme() == "https" && (host == domain || host.ends_with(&format!(".{domain}")));
        if trusted || self.upload_hosts.iter().any(|allowed| allowed == host) {
            Ok(url)
        } else {
            Err(refused)
        }
    }
}

fn transport(error: reqwest::Error) -> StudioError {
    // The URL can carry an access token, so it never reaches an error message.
    let error = error.without_url();
    if error.is_timeout() {
        StudioError::Input("Hết thời gian chờ phản hồi từ nền tảng.")
    } else if error.is_connect() {
        StudioError::Input("Không kết nối được tới nền tảng. Kiểm tra mạng rồi thử lại.")
    } else {
        StudioError::Message(format!("Yêu cầu tới nền tảng bị lỗi: {error}"))
    }
}

fn brief(text: &str) -> String {
    text.chars().take(300).collect()
}

fn graph_error(body: &Value) -> Option<StudioError> {
    let (code, message) = if let Some(error) = body.get("error").filter(|error| error.is_object()) {
        (
            error["code"].as_i64(),
            error["error_user_msg"]
                .as_str()
                .or(error["message"].as_str()),
        )
    } else if body.get("error_type").is_some() {
        (body["code"].as_i64(), body["error_message"].as_str())
    } else {
        return None;
    };
    Some(match code {
        Some(190) => RECONNECT,
        Some(4 | 17 | 32 | 341 | 613) => {
            StudioError::Input("Nền tảng đang giới hạn tần suất. Hãy thử lại sau.")
        }
        _ => StudioError::Message(format!(
            "Nền tảng từ chối yêu cầu (mã {}): {}",
            code.unwrap_or(0),
            brief(message.unwrap_or("không có mô tả"))
        )),
    })
}

fn tiktok_error(code: &str, message: Option<&str>) -> StudioError {
    StudioError::Input(match code {
        "access_token_invalid" => return RECONNECT,
        "scope_not_authorized" | "scope_permission_missed" => {
            "Token TikTok thiếu quyền cần thiết (video.publish, video.list, user.info.basic)."
        }
        "unaudited_client_can_only_post_to_private_accounts" => {
            "Ứng dụng TikTok chưa được duyệt nên chỉ đăng riêng tư, và tài khoản phải đặt ở chế độ riêng tư."
        }
        "privacy_level_option_mismatch" => {
            "Chế độ hiển thị không nằm trong các lựa chọn TikTok cho phép với tài khoản này."
        }
        "spam_risk_too_many_posts" => "TikTok báo tài khoản đã đạt giới hạn bài đăng trong ngày.",
        "rate_limit_exceeded" => "TikTok đang giới hạn tần suất. Hãy thử lại sau.",
        _ => {
            return StudioError::Message(format!(
                "TikTok từ chối yêu cầu ({code}): {}",
                brief(message.unwrap_or("không có mô tả"))
            ));
        }
    })
}

pub struct Api {
    client: Client,
}

impl Api {
    pub fn new(https_only: bool) -> Result<Self> {
        let client = Client::builder()
            .user_agent("AIVideoStudio/0.1")
            .connect_timeout(Duration::from_secs(15))
            .timeout(Duration::from_secs(60))
            // A redirect could forward a token to another host.
            .redirect(reqwest::redirect::Policy::none())
            .https_only(https_only)
            .build()
            .map_err(transport)?;
        Ok(Self { client })
    }

    pub fn get(&self, url: &str) -> RequestBuilder {
        self.client.get(url)
    }

    pub fn post(&self, url: &str) -> RequestBuilder {
        self.client.post(url)
    }

    pub fn put(&self, url: &str) -> RequestBuilder {
        self.client.put(url)
    }

    pub fn delete(&self, url: &str) -> RequestBuilder {
        self.client.delete(url)
    }

    /// Sends a request and parses a bounded JSON body. Non-JSON bodies become null.
    pub fn send(&self, request: RequestBuilder) -> Result<(StatusCode, Value)> {
        let response = request.send().map_err(transport)?;
        let status = response.status();
        let mut text = String::new();
        response
            .take(MAX_BODY)
            .read_to_string(&mut text)
            .map_err(|_| StudioError::Input("Không đọc được phản hồi từ nền tảng."))?;
        Ok((status, serde_json::from_str(&text).unwrap_or(Value::Null)))
    }

    /// Meta Graph style call (Facebook, Instagram, Threads).
    pub fn graph(&self, request: RequestBuilder) -> Result<Value> {
        let (status, body) = self.send(request)?;
        if let Some(error) = graph_error(&body) {
            return Err(error);
        }
        if !status.is_success() {
            return Err(StudioError::Message(format!(
                "Nền tảng trả về lỗi HTTP {}.",
                status.as_u16()
            )));
        }
        Ok(body)
    }

    /// TikTok v2 call. Returns the `data` object once `error.code` is `ok`.
    pub fn tiktok(&self, request: RequestBuilder) -> Result<Value> {
        let (status, mut body) = self.send(request)?;
        let error = &body["error"];
        if let Some(code) = error["code"].as_str().filter(|code| *code != "ok") {
            return Err(tiktok_error(code, error["message"].as_str()));
        }
        if let Some(code) = error.as_str() {
            // OAuth endpoints answer with a flat `error` string.
            return Err(tiktok_error(code, body["error_description"].as_str()));
        }
        if !status.is_success() {
            return Err(StudioError::Message(format!(
                "TikTok trả về lỗi HTTP {}.",
                status.as_u16()
            )));
        }
        Ok(match body.get_mut("data") {
            Some(data) => data.take(),
            None => body,
        })
    }

    /// Polls a Threads or Instagram media container until it can be published.
    pub fn wait_container(
        &self,
        endpoints: &Endpoints,
        url: &str,
        token: &str,
        status_field: &str,
        detail_field: &str,
    ) -> Result<()> {
        for attempt in 0..endpoints.polls {
            if attempt > 0 {
                thread::sleep(endpoints.poll);
            }
            let fields = format!("id,{status_field},{detail_field}");
            let state = self.graph(
                self.get(url)
                    .query(&[("fields", fields.as_str()), ("access_token", token)]),
            )?;
            match state[status_field].as_str().unwrap_or_default() {
                "FINISHED" => return Ok(()),
                "ERROR" | "EXPIRED" => {
                    return Err(StudioError::Message(format!(
                        "Nền tảng không xử lý được media: {}",
                        brief(state[detail_field].as_str().unwrap_or("không rõ lý do"))
                    )));
                }
                _ => {}
            }
        }
        Err(StudioError::Input(
            "Nền tảng vẫn đang xử lý media. Hãy thử lại sau để tiếp tục lượt đăng này.",
        ))
    }
}

/// Reads an id that the API may send as a string or a number.
pub fn id_of(value: &Value, key: &str) -> Result<String> {
    match &value[key] {
        Value::String(text) if !text.is_empty() => Ok(text.clone()),
        Value::Number(number) => Ok(number.to_string()),
        _ => Err(StudioError::Input(
            "Phản hồi từ nền tảng thiếu mã định danh.",
        )),
    }
}

pub fn text_of(value: &Value, key: &str) -> Option<String> {
    value[key].as_str().map(str::to_owned)
}
