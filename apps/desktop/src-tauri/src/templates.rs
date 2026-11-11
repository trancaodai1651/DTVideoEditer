use std::time::Duration;

use serde::{Deserialize, Serialize};

use crate::{
    library::authorized_asset,
    model::{Result, StudioError},
    probe::{self, MediaFormat},
    store::Store,
    timeline::Aspect,
};

const MAX_REFERENCE_MS: i64 = 180_000;
const MIN_SCENE_MS: i64 = 500;
const MAX_SCENES: usize = 24;

#[derive(Clone, Debug, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct Template {
    pub name: String,
    pub aspect: Aspect,
    pub scene_ms: Vec<i64>,
}

#[derive(Serialize)]
pub struct TemplateEntry {
    pub id: i64,
    pub template: Template,
}

fn scene_lengths(output: &str, duration: i64) -> Vec<i64> {
    let mut last = 0;
    let mut lengths = Vec::new();
    for timestamp in output.lines().filter_map(|line| {
        line.split_whitespace()
            .find_map(|item| item.strip_prefix("pts_time:"))?
            .parse::<f64>()
            .ok()
    }) {
        let ms = (timestamp * 1000.0).round() as i64;
        if ms >= last + MIN_SCENE_MS && ms <= duration - MIN_SCENE_MS {
            lengths.push(ms - last);
            last = ms;
            if lengths.len() == MAX_SCENES - 1 {
                break;
            }
        }
    }
    lengths.push(duration - last);
    lengths
}

pub fn analyze(store: &Store, asset_id: i64, name: &str) -> Result<TemplateEntry> {
    let name = name.trim();
    if name.is_empty() || name.chars().count() > 80 || name.chars().any(char::is_control) {
        return Err(StudioError::Input(
            "Tên mẫu phải có từ 1 đến 80 ký tự hợp lệ.",
        ));
    }
    let Some(asset) = store
        .source(asset_id, false)?
        .filter(|source| source.kind == "video")
    else {
        return Err(StudioError::Input(
            "Chọn video mẫu trong thư viện đã cấp quyền.",
        ));
    };
    let Some(duration) = asset
        .duration_ms
        .filter(|ms| (MIN_SCENE_MS..=MAX_REFERENCE_MS).contains(ms))
    else {
        return Err(StudioError::Input(
            "Video mẫu cần dài từ 0,5 giây đến 3 phút.",
        ));
    };
    let (path, _) = authorized_asset(&asset)?;
    let format = MediaFormat::for_path(&path)
        .ok_or(StudioError::Input("Định dạng video mẫu chưa được hỗ trợ."))?;
    let ffmpeg = probe::find_tool("ffmpeg")
        .ok_or(StudioError::Input("Cần FFmpeg để phân tích video mẫu."))?;
    let mut command = probe::command(ffmpeg);
    command.args(["-hide_banner", "-loglevel", "error", "-nostdin", "-filter_threads", "1"])
        .args(format.input_args()).arg("-i").arg(path)
        .args(["-map", "0:V:0", "-an", "-sn", "-dn", "-vf",
            "scale=320:180:force_original_aspect_ratio=decrease,select='gt(scene,0.32)',metadata=mode=print:key=lavfi.scene_score:file=-",
            "-fps_mode", "passthrough", "-f", "null", "-"]);
    let output = probe::capture_allow_empty(command, Duration::from_secs(60)).ok_or(
        StudioError::Input("FFmpeg chưa phân tích được video mẫu trong thời gian cho phép."),
    )?;
    let aspect = asset
        .width
        .zip(asset.height)
        .map(|(width, height)| Aspect::from_dimensions(width, height))
        .unwrap_or_default();
    let template = Template {
        name: name.to_owned(),
        aspect,
        scene_ms: scene_lengths(&String::from_utf8_lossy(&output), duration),
    };
    Ok(TemplateEntry {
        id: store.insert_template(&template)?,
        template,
    })
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn skips_tiny_scenes_and_retains_reference_length() {
        let cuts = "frame:0 pts:1 pts_time:0.2\nframe:1 pts:2 pts_time:1.25\nframe:2 pts:3 pts_time:1.3\nframe:3 pts:4 pts_time:3";
        assert_eq!(scene_lengths(cuts, 4200), [1250, 1750, 1200]);
        assert_eq!(scene_lengths("", 4200), [4200]);
    }
}
