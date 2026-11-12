//! Voice-over with the operating system's own speech engine, caption
//! translation through the Claude API, and .cube LUT validation.

use std::{
    path::{Path, PathBuf},
    process::Stdio,
    time::{Duration, SystemTime, UNIX_EPOCH},
};

use serde::Serialize;
use serde_json::{Value, json};

use crate::{
    model::{Result, StudioError},
    probe,
    publish::secrets::SecretStore,
};

const MAX_SPEECH_CHARS: usize = 5000;
const AI_SECRET: &str = "ai-anthropic";
const TRANSLATE_MODEL: &str = "claude-opus-5-5";
const MAX_CUES: usize = 400;

#[derive(Debug, Serialize)]
pub struct Voice {
    pub name: String,
    pub language: String,
}

fn script_dir() -> Result<tempfile::TempDir> {
    Ok(tempfile::tempdir()?)
}

#[cfg(windows)]
const LIST_SCRIPT: &str = "Add-Type -AssemblyName System.Speech\n$s = New-Object System.Speech.Synthesis.SpeechSynthesizer\nforeach ($v in $s.GetInstalledVoices()) { if ($v.Enabled) { [Console]::Out.WriteLine($v.VoiceInfo.Name + '|' + $v.VoiceInfo.Culture.Name) } }\n";

#[cfg(windows)]
const SPEAK_SCRIPT: &str = "param([string]$TextPath, [string]$OutPath, [string]$Voice, [int]$Rate)\nAdd-Type -AssemblyName System.Speech\n$s = New-Object System.Speech.Synthesis.SpeechSynthesizer\nif ($Voice) { $s.SelectVoice($Voice) }\n$s.Rate = $Rate\n$s.SetOutputToWaveFile($OutPath)\n$s.Speak([IO.File]::ReadAllText($TextPath, [Text.Encoding]::UTF8))\n$s.Dispose()\n";

#[cfg(windows)]
fn powershell(script: &str, args: &[&std::ffi::OsStr], deadline: Duration) -> Option<Vec<u8>> {
    let dir = script_dir().ok()?;
    let path = dir.path().join("speech.ps1");
    // UTF-8 with BOM so Windows PowerShell reads non-ASCII voice names correctly.
    let mut bytes = vec![0xef, 0xbb, 0xbf];
    bytes.extend_from_slice(script.as_bytes());
    std::fs::write(&path, bytes).ok()?;
    let mut command = probe::command("powershell.exe");
    command
        .args([
            "-NoProfile",
            "-NonInteractive",
            "-ExecutionPolicy",
            "Bypass",
            "-File",
        ])
        .arg(&path)
        .args(args);
    probe::capture_limited(command, deadline, 1024 * 1024)
}

/// Installed voices. Windows lists SAPI voices, macOS lists `say` voices.
pub fn voices() -> Result<Vec<Voice>> {
    #[cfg(windows)]
    {
        let output = powershell(LIST_SCRIPT, &[], Duration::from_secs(20)).ok_or(
            StudioError::Input("Không đọc được danh sách giọng đọc của Windows."),
        )?;
        return Ok(String::from_utf8_lossy(&output)
            .lines()
            .filter_map(|line| line.trim().split_once('|'))
            .map(|(name, language)| Voice {
                name: name.to_owned(),
                language: language.to_owned(),
            })
            .collect());
    }
    #[cfg(target_os = "macos")]
    {
        let mut command = probe::command("/usr/bin/say");
        command.args(["-v", "?"]);
        let output = probe::capture_limited(command, Duration::from_secs(20), 1024 * 1024).ok_or(
            StudioError::Input("Không đọc được danh sách giọng đọc của macOS."),
        )?;
        return Ok(String::from_utf8_lossy(&output)
            .lines()
            .filter_map(parse_say_voice)
            .collect());
    }
    #[allow(unreachable_code)]
    Err(StudioError::Input(
        "Hệ điều hành này chưa hỗ trợ giọng đọc trên máy.",
    ))
}

#[cfg_attr(not(target_os = "macos"), allow(dead_code))]
fn parse_say_voice(line: &str) -> Option<Voice> {
    let (head, _) = line.split_once('#')?;
    let mut parts: Vec<&str> = head.split_whitespace().collect();
    let language = parts.pop()?.to_owned();
    (!parts.is_empty()).then(|| Voice {
        name: parts.join(" "),
        language,
    })
}

fn check_speech(text: &str, voice: &str, rate: i8) -> Result<()> {
    let length = text.trim().chars().count();
    if length == 0
        || length > MAX_SPEECH_CHARS
        || text
            .chars()
            .any(|c| c.is_control() && c != '\n' && c != '\r')
    {
        return Err(StudioError::Input("Nội dung đọc cần từ 1 đến 5000 ký tự."));
    }
    if voice.chars().count() > 120
        || voice.chars().any(char::is_control)
        || !(-10..=10).contains(&rate)
    {
        return Err(StudioError::Input("Giọng đọc hoặc tốc độ không hợp lệ."));
    }
    Ok(())
}

/// Speaks text to a new WAV file in `folder` and returns its path.
pub fn speak(folder: &Path, text: &str, voice: &str, rate: i8) -> Result<PathBuf> {
    check_speech(text, voice, rate)?;
    std::fs::create_dir_all(folder)?;
    let stamp = SystemTime::now()
        .duration_since(UNIX_EPOCH)
        .map_or(0, |time| time.as_millis());
    let output = folder.join(format!("loi-doc-{stamp}.wav"));
    let work = script_dir()?;
    let text_path = work.path().join("text.txt");
    std::fs::write(&text_path, text)?;
    #[cfg(windows)]
    {
        let rate = rate.to_string();
        powershell(
            SPEAK_SCRIPT,
            &[
                "-TextPath".as_ref(),
                text_path.as_os_str(),
                "-OutPath".as_ref(),
                output.as_os_str(),
                "-Voice".as_ref(),
                voice.as_ref(),
                "-Rate".as_ref(),
                rate.as_ref(),
            ],
            Duration::from_secs(300),
        );
    }
    #[cfg(target_os = "macos")]
    {
        let mut command = probe::command("/usr/bin/say");
        if !voice.is_empty() {
            command.args(["-v", voice]);
        }
        // `say` rate is words per minute; 175 is normal speech.
        command
            .args([
                "-r",
                &(175 + i32::from(rate) * 12).to_string(),
                "--file-format=WAVE",
                "--data-format=LEI16@22050",
                "-o",
            ])
            .arg(&output)
            .arg("-f")
            .arg(&text_path)
            .stdout(Stdio::null());
        let _ = probe::capture_allow_empty(command, Duration::from_secs(300));
    }
    let _ = Stdio::null;
    if std::fs::metadata(&output).is_ok_and(|metadata| metadata.len() > 44) {
        Ok(output)
    } else {
        let _ = std::fs::remove_file(&output);
        Err(StudioError::Input(
            "Hệ điều hành chưa tạo được tệp giọng đọc. Kiểm tra giọng đã chọn.",
        ))
    }
}

pub fn has_ai_key(secrets: &dyn SecretStore) -> bool {
    secrets.get(AI_SECRET).is_ok_and(|key| !key.is_empty())
}

pub fn set_ai_key(secrets: &dyn SecretStore, key: &str) -> Result<()> {
    let key = key.trim();
    if key.is_empty() {
        return secrets.delete(AI_SECRET);
    }
    if key.len() > 300 || key.chars().any(|c| c.is_whitespace() || c.is_control()) {
        return Err(StudioError::Input("API key không hợp lệ."));
    }
    secrets.set(AI_SECRET, key)
}

fn translation_prompt(lines: &[String], language: &str) -> String {
    format!(
        "Translate each subtitle line into {language}. Keep the meaning, tone and line breaks of each line, \
         and keep names, numbers and markup as they are. Reply with only a JSON array of {} strings, one \
         translated line per input line, in the same order.\n\n{}",
        lines.len(),
        serde_json::to_string(lines).unwrap_or_default()
    )
}

/// Pulls the JSON array of translated lines out of the reply text.
pub fn parse_translation(text: &str, expected: usize) -> Result<Vec<String>> {
    let invalid = StudioError::Input("Bản dịch trả về không đúng định dạng. Hãy thử lại.");
    let (Some(start), Some(end)) = (text.find('['), text.rfind(']')) else {
        return Err(invalid);
    };
    let lines: Vec<String> = serde_json::from_str(&text[start..=end]).map_err(|_| invalid)?;
    if lines.len() != expected {
        return Err(StudioError::Input(
            "Số câu dịch không khớp với số câu phụ đề. Hãy thử lại.",
        ));
    }
    Ok(lines)
}

/// Translates subtitle lines with Claude. The caller has already asked the user
/// to approve sending these lines to Anthropic.
pub fn translate(
    secrets: &dyn SecretStore,
    lines: &[String],
    language: &str,
    endpoint: &str,
) -> Result<Vec<String>> {
    if lines.is_empty()
        || lines.len() > MAX_CUES
        || lines.iter().any(|line| line.chars().count() > 600)
    {
        return Err(StudioError::Input(
            "Cần từ 1 đến 400 câu phụ đề, mỗi câu tối đa 600 ký tự.",
        ));
    }
    let language = language.trim();
    if language.is_empty()
        || language.chars().count() > 40
        || language.chars().any(char::is_control)
    {
        return Err(StudioError::Input("Ngôn ngữ đích không hợp lệ."));
    }
    let key = secrets.get(AI_SECRET).map_err(|_| {
        StudioError::Input("Nhập Anthropic API key trong tab Thông minh trước khi dịch.")
    })?;
    let client = reqwest::blocking::Client::builder()
        .timeout(Duration::from_secs(600))
        .redirect(reqwest::redirect::Policy::none())
        .build()
        .map_err(|_| StudioError::Input("Không khởi tạo được kết nối HTTPS."))?;
    let body = json!({
        "model": TRANSLATE_MODEL,
        "max_tokens": 16000,
        "fallbacks": "default",
        "output_config": { "effort": "low" },
        "messages": [{ "role": "user", "content": translation_prompt(lines, language) }],
    });
    let response = client
        .post(format!("{endpoint}/v1/messages"))
        .header("x-api-key", key)
        .header("anthropic-version", "2026-10-21")
        .header("anthropic-beta", "server-side-fallback-2026-07-01")
        .json(&body)
        .send()
        .map_err(|error| {
            StudioError::Message(format!(
                "Không gửi được yêu cầu dịch: {}",
                error.without_url()
            ))
        })?;
    let status = response.status();
    let reply: Value = response
        .json()
        .map_err(|_| StudioError::Input("Phản hồi dịch không đọc được."))?;
    if !status.is_success() {
        let message = reply["error"]["message"]
            .as_str()
            .unwrap_or("không rõ lý do");
        return Err(StudioError::Message(match status.as_u16() {
            401 => "Anthropic API key không hợp lệ.".to_owned(),
            429 => "Dịch vụ dịch đang giới hạn tần suất. Hãy thử lại sau.".to_owned(),
            code => format!(
                "Dịch vụ dịch báo lỗi {code}: {}",
                message.chars().take(200).collect::<String>()
            ),
        }));
    }
    if reply["stop_reason"] == "refusal" {
        return Err(StudioError::Input("Mô hình từ chối dịch nội dung này."));
    }
    let text: String = reply["content"]
        .as_array()
        .into_iter()
        .flatten()
        .filter(|block| block["type"] == "text")
        .filter_map(|block| block["text"].as_str())
        .collect();
    parse_translation(&text, lines.len())
}

/// Checks a .cube 3D LUT: a size between 2 and 65 and exactly size³ RGB rows.
pub fn validate_cube(text: &str) -> Result<()> {
    let invalid = StudioError::Input("Tệp LUT phải là .cube 3D hợp lệ.");
    if text.len() > 8 * 1024 * 1024 {
        return Err(StudioError::Input("Tệp LUT lớn hơn 8 MB."));
    }
    let mut size = None;
    let mut rows = 0usize;
    for line in text
        .lines()
        .map(str::trim)
        .filter(|line| !line.is_empty() && !line.starts_with('#'))
    {
        let first = line.split_whitespace().next().unwrap_or_default();
        if first == "LUT_3D_SIZE" {
            size = line
                .split_whitespace()
                .nth(1)
                .and_then(|value| value.parse::<usize>().ok());
        } else if first == "LUT_1D_SIZE" {
            return Err(invalid);
        } else if first
            .chars()
            .next()
            .is_some_and(|c| c.is_ascii_digit() || c == '-' || c == '.')
        {
            let values: Vec<f64> = line
                .split_whitespace()
                .filter_map(|value| value.parse().ok())
                .collect();
            if values.len() != 3 || values.iter().any(|value| !value.is_finite()) {
                return Err(invalid);
            }
            rows += 1;
        }
    }
    match size {
        Some(size) if (2..=65).contains(&size) && rows == size * size * size => Ok(()),
        _ => Err(invalid),
    }
}

#[cfg(test)]
mod tests {
    use super::*;
    use crate::publish::secrets::MemorySecrets;

    #[test]
    fn cube_files_need_the_declared_number_of_rows() {
        let mut cube = String::from("TITLE \"x\"\n# comment\nLUT_3D_SIZE 2\nDOMAIN_MIN 0 0 0\n");
        for index in 0..8 {
            cube.push_str(&format!(
                "{} {} {}\n",
                index & 1,
                (index >> 1) & 1,
                (index >> 2) & 1
            ));
        }
        assert!(validate_cube(&cube).is_ok());
        assert!(validate_cube(&cube.replace("LUT_3D_SIZE 2", "LUT_3D_SIZE 3")).is_err());
        assert!(validate_cube("LUT_1D_SIZE 2\n0 0 0\n1 1 1\n").is_err());
        assert!(validate_cube(&cube.replace("1 1 1", "1 1")).is_err());
    }

    #[test]
    fn translations_must_match_line_for_line() {
        assert_eq!(
            parse_translation("Here:\n[\"Xin chào\", \"Tạm biệt\"]", 2).unwrap(),
            ["Xin chào", "Tạm biệt"]
        );
        assert!(parse_translation("[\"a\"]", 2).is_err());
        assert!(parse_translation("no json", 1).is_err());
        let prompt = translation_prompt(&["Hello".into()], "Tiếng Việt");
        assert!(prompt.contains("Tiếng Việt") && prompt.contains("[\"Hello\"]"));
    }

    #[test]
    fn speech_input_and_keys_are_checked() {
        assert!(check_speech("Xin chào", "", 0).is_ok());
        assert!(check_speech("  ", "", 0).is_err());
        assert!(check_speech("a", "", 11).is_err());
        assert!(check_speech(&"a".repeat(5001), "", 0).is_err());
        let secrets = MemorySecrets::default();
        assert!(!has_ai_key(&secrets));
        assert!(set_ai_key(&secrets, "bad key").is_err());
        set_ai_key(&secrets, "sk-test").unwrap();
        assert!(has_ai_key(&secrets));
        set_ai_key(&secrets, "").unwrap();
        assert!(!has_ai_key(&secrets));
        assert!(
            translate(&secrets, &["x".into()], "vi", "http://127.0.0.1:1")
                .unwrap_err()
                .to_string()
                .contains("API key")
        );
        let voice = parse_say_voice("Linh                vi_VN    # Xin chào").unwrap();
        assert_eq!(
            (voice.name.as_str(), voice.language.as_str()),
            ("Linh", "vi_VN")
        );
    }

    #[test]
    #[cfg(windows)]
    #[ignore = "uses the Windows speech engine"]
    fn windows_speech_writes_a_wav_file() {
        let dir = tempfile::tempdir().unwrap();
        let voices = voices().unwrap();
        assert!(!voices.is_empty());
        let path = speak(dir.path(), "Xin chào, đây là thử nghiệm giọng đọc.", "", 0).unwrap();
        let bytes = std::fs::read(&path).unwrap();
        assert!(bytes.starts_with(b"RIFF") && bytes.len() > 10_000);
    }
}
