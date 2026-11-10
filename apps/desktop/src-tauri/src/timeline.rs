use serde::{Deserialize, Serialize};

use crate::model::{Result, StudioError};

pub const TIMELINE_VERSION: u32 = 3;
pub const MAX_LAYERS: u8 = 12;
pub const MIN_CLIP_MS: i64 = 100;
pub const MAX_IMAGE_MS: i64 = 10 * 60 * 1000;
pub const MAX_TIMELINE_MS: i64 = 6 * 60 * 60 * 1000;
pub const MAX_TRACK_CLIPS: usize = 200;
pub const MAX_TITLES: usize = 300;

/// One edit point set. `start_ms..end_ms` is the range read from the source,
/// `position_ms` is where that range starts on the timeline.
#[derive(Clone, Debug, PartialEq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase", deny_unknown_fields)]
pub struct ClipEdit {
    pub asset_id: i64,
    pub start_ms: i64,
    pub end_ms: i64,
    pub position_ms: i64,
    #[serde(default, skip_serializing_if = "is_zero")]
    pub layer: u8,
    #[serde(default, skip_serializing_if = "Look::is_default")]
    pub look: Look,
}

fn is_zero(value: &u8) -> bool {
    *value == 0
}

#[derive(Clone, Copy, Debug, Default, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "snake_case")]
pub enum Motion {
    #[default]
    None,
    Slide,
    SlideRight,
    Rise,
}

#[derive(Clone, Copy, Debug, Default, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "snake_case")]
pub enum Effect {
    #[default]
    None,
    Blur,
    Vignette,
    Grain,
}

#[derive(Clone, Copy, Debug, Default, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "snake_case")]
pub enum KeyColor {
    #[default]
    None,
    Green,
    Blue,
}

#[derive(Clone, Copy, Debug, PartialEq, Eq, Serialize, Deserialize)]
#[serde(default, rename_all = "camelCase", deny_unknown_fields)]
pub struct Look {
    pub brightness: i16,
    pub contrast: u16,
    pub saturation: u16,
    pub opacity: u8,
    pub scale: u16,
    pub x: i16,
    pub y: i16,
    pub volume: u16,
    pub fade_ms: u16,
    pub motion: Motion,
    pub speed: u16,
    pub rotate: i16,
    pub flip: bool,
    pub temperature: i16,
    pub effect: Effect,
    pub key_color: KeyColor,
    pub ellipse: bool,
    pub denoise: bool,
    pub sharpen: bool,
    pub stabilize: bool,
    pub optical_flow: bool,
    pub clean_audio: bool,
}

impl Default for Look {
    fn default() -> Self {
        Self {
            brightness: 0,
            contrast: 100,
            saturation: 100,
            opacity: 100,
            scale: 100,
            x: 0,
            y: 0,
            volume: 100,
            fade_ms: 0,
            motion: Motion::None,
            speed: 100,
            rotate: 0,
            flip: false,
            temperature: 0,
            effect: Effect::None,
            key_color: KeyColor::None,
            ellipse: false,
            denoise: false,
            sharpen: false,
            stabilize: false,
            optical_flow: false,
            clean_audio: false,
        }
    }
}

impl Look {
    fn is_default(&self) -> bool {
        *self == Self::default()
    }

    fn valid(&self) -> bool {
        (-100..=100).contains(&self.brightness)
            && self.contrast <= 200
            && self.saturation <= 300
            && self.opacity <= 100
            && (10..=200).contains(&self.scale)
            && (-100..=100).contains(&self.x)
            && (-100..=100).contains(&self.y)
            && self.volume <= 200
            && self.fade_ms <= 3000
            && (50..=200).contains(&self.speed)
            && (-180..=180).contains(&self.rotate)
            && (-100..=100).contains(&self.temperature)
    }
}

#[derive(Clone, Copy, Debug, Default, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "snake_case")]
pub enum Aspect {
    #[default]
    Source,
    Landscape,
    Portrait,
    Square,
}

impl Aspect {
    fn is_source(&self) -> bool {
        *self == Self::Source
    }

    pub fn from_dimensions(width: u32, height: u32) -> Self {
        if width == height {
            Self::Square
        } else if width > height {
            Self::Landscape
        } else {
            Self::Portrait
        }
    }
}

#[derive(Clone, Debug, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase", deny_unknown_fields)]
pub struct TitleEdit {
    pub text: String,
    pub position_ms: i64,
    pub duration_ms: i64,
    pub layer: u8,
    pub size: u8,
    pub x: i16,
    pub y: i16,
    pub color: TitleColor,
    #[serde(default, skip_serializing_if = "is_false")]
    pub caption: bool,
    #[serde(default, skip_serializing_if = "is_false")]
    pub background: bool,
}

fn is_false(value: &bool) -> bool {
    !value
}

#[derive(Clone, Copy, Debug, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "snake_case")]
pub enum TitleColor {
    White,
    Yellow,
    Cyan,
    Black,
}

impl TitleColor {
    pub fn name(self) -> &'static str {
        match self {
            Self::White => "white",
            Self::Yellow => "yellow",
            Self::Cyan => "cyan",
            Self::Black => "black",
        }
    }
}

impl ClipEdit {
    pub fn source_length_ms(&self) -> i64 {
        self.end_ms.saturating_sub(self.start_ms)
    }

    pub fn length_ms(&self) -> i64 {
        let speed = i64::from(self.look.speed.max(1));
        self.source_length_ms()
            .saturating_mul(100)
            .saturating_add(speed / 2)
            / speed
    }

    pub fn finish_ms(&self) -> i64 {
        self.position_ms.saturating_add(self.length_ms())
    }
}

#[derive(Clone, Debug, PartialEq, Serialize, Deserialize)]
#[serde(deny_unknown_fields)]
pub struct TrackEdit {
    pub kind: String,
    pub clips: Vec<ClipEdit>,
}

/// Versioned timeline contract shared by persistence, IPC and the renderer.
#[derive(Clone, Debug, PartialEq, Serialize, Deserialize)]
#[serde(deny_unknown_fields)]
pub struct TimelineSnapshot {
    pub version: u32,
    pub tracks: Vec<TrackEdit>,
    #[serde(default, skip_serializing_if = "Vec::is_empty")]
    pub titles: Vec<TitleEdit>,
    #[serde(default, skip_serializing_if = "Aspect::is_source")]
    pub aspect: Aspect,
}

impl TimelineSnapshot {
    pub fn clips(&self, kind: &str) -> Vec<&ClipEdit> {
        let mut clips: Vec<_> = self
            .tracks
            .iter()
            .filter(|track| track.kind == kind)
            .flat_map(|track| &track.clips)
            .collect();
        clips.sort_by_key(|clip| clip.position_ms);
        clips
    }

    pub fn duration_ms(&self) -> i64 {
        self.tracks
            .iter()
            .flat_map(|track| &track.clips)
            .map(ClipEdit::finish_ms)
            .chain(
                self.titles
                    .iter()
                    .map(|title| title.position_ms.saturating_add(title.duration_ms)),
            )
            .max()
            .unwrap_or(0)
    }
}

/// What validation needs to know about the asset behind a clip.
pub struct AssetFacts<'a> {
    pub kind: &'a str,
    pub duration_ms: Option<i64>,
}

pub fn check_version(snapshot: &TimelineSnapshot) -> Result<()> {
    if !matches!(snapshot.version, 2 | TIMELINE_VERSION) {
        return Err(StudioError::Input("Phiên bản timeline không được hỗ trợ."));
    }
    let mut kinds: Vec<_> = snapshot
        .tracks
        .iter()
        .map(|track| track.kind.as_str())
        .collect();
    kinds.sort_unstable();
    if kinds.iter().any(|kind| !matches!(*kind, "video" | "audio"))
        || kinds.windows(2).any(|pair| pair[0] == pair[1])
    {
        return Err(StudioError::Input("Timeline có nhóm media không hợp lệ."));
    }
    if snapshot.titles.len() > MAX_TITLES
        || snapshot.titles.iter().any(|title| {
            title.text.trim().is_empty()
                || title.text.chars().count() > 600
                || title.text.chars().any(|c| c.is_control() && c != '\n')
                || title.position_ms < 0
                || title.duration_ms < MIN_CLIP_MS
                || title.position_ms.saturating_add(title.duration_ms) > MAX_TIMELINE_MS
                || title.layer >= MAX_LAYERS
                || !(2..=24).contains(&title.size)
                || !(-100..=100).contains(&title.x)
                || !(-100..=100).contains(&title.y)
        })
    {
        return Err(StudioError::Input(
            "Nội dung hoặc thời lượng chữ nằm ngoài giới hạn.",
        ));
    }
    Ok(())
}

pub fn check_clip(track: &str, clip: &ClipEdit, asset: &AssetFacts) -> Result<()> {
    let fits_track = match asset.kind {
        "audio" => track == "audio",
        "video" | "image" => track == "video",
        _ => false,
    };
    if !fits_track {
        return Err(StudioError::Input("Loại media không khớp với track."));
    }
    if clip.layer >= MAX_LAYERS
        || !clip.look.valid()
        || (asset.kind == "image" && clip.look.speed != 100)
    {
        return Err(StudioError::Input(
            "Tầng hoặc thuộc tính clip nằm ngoài giới hạn.",
        ));
    }
    if clip.start_ms < 0
        || clip.position_ms < 0
        || clip.end_ms <= clip.start_ms
        || clip.end_ms > MAX_TIMELINE_MS
        || clip.position_ms > MAX_TIMELINE_MS
        || clip.length_ms() < MIN_CLIP_MS
        || clip.finish_ms() > MAX_TIMELINE_MS
    {
        return Err(StudioError::Input(
            "Điểm cắt của clip nằm ngoài giới hạn cho phép.",
        ));
    }
    let source_limit = match (asset.kind, asset.duration_ms) {
        ("image", _) if clip.start_ms != 0 => -1,
        ("image", _) => MAX_IMAGE_MS,
        (_, Some(duration)) => duration,
        (_, None) => -1,
    };
    if clip.end_ms > source_limit {
        return Err(StudioError::Input(
            "Điểm cắt vượt quá độ dài của tệp nguồn.",
        ));
    }
    Ok(())
}

pub fn check_track(clips: &[ClipEdit]) -> Result<()> {
    if clips.len() > MAX_TRACK_CLIPS * usize::from(MAX_LAYERS) {
        return Err(StudioError::Input("Track có quá nhiều clip."));
    }
    let mut order: Vec<_> = clips.iter().collect();
    order.sort_by_key(|clip| (clip.layer, clip.position_ms));
    let mut count = [0usize; MAX_LAYERS as usize];
    for clip in &order {
        let Some(layer) = count.get_mut(usize::from(clip.layer)) else {
            return Err(StudioError::Input("Tầng clip nằm ngoài giới hạn."));
        };
        *layer += 1;
        if *layer > MAX_TRACK_CLIPS {
            return Err(StudioError::Input("Tầng có quá nhiều clip."));
        }
    }
    if order
        .windows(2)
        .any(|pair| pair[0].layer == pair[1].layer && pair[1].position_ms < pair[0].finish_ms())
    {
        return Err(StudioError::Input(
            "Các clip trên cùng một track không được chồng lên nhau.",
        ));
    }
    Ok(())
}

#[cfg(test)]
mod tests {
    use super::*;

    fn clip(start_ms: i64, end_ms: i64, position_ms: i64) -> ClipEdit {
        ClipEdit {
            asset_id: 1,
            start_ms,
            end_ms,
            position_ms,
            layer: 0,
            look: Look::default(),
        }
    }

    #[test]
    fn validates_edit_points_against_source_and_track() {
        let video = AssetFacts {
            kind: "video",
            duration_ms: Some(6000),
        };
        let image = AssetFacts {
            kind: "image",
            duration_ms: None,
        };
        let unknown = AssetFacts {
            kind: "audio",
            duration_ms: None,
        };
        assert!(check_clip("video", &clip(1000, 6000, 0), &video).is_ok());
        assert!(check_clip("audio", &clip(1000, 6000, 0), &video).is_err());
        assert!(check_clip("video", &clip(1000, 6001, 0), &video).is_err());
        assert!(check_clip("video", &clip(1000, 1050, 0), &video).is_err());
        assert!(check_clip("video", &clip(-1, 500, 0), &video).is_err());
        assert!(check_clip("video", &clip(0, 500, -1), &video).is_err());
        assert!(check_clip("video", &clip(0, 9000, 0), &image).is_ok());
        assert!(check_clip("video", &clip(500, 9000, 0), &image).is_err());
        assert!(check_clip("video", &clip(0, MAX_IMAGE_MS + 1, 0), &image).is_err());
        assert!(check_clip("audio", &clip(0, 500, 0), &unknown).is_err());
    }

    #[test]
    fn rejects_overlap_and_unknown_tracks() {
        assert!(check_track(&[clip(0, 1000, 1000), clip(0, 1000, 0)]).is_ok());
        assert!(check_track(&[clip(0, 1000, 0), clip(0, 1000, 999)]).is_err());
        let snapshot = |version, kinds: &[&str]| TimelineSnapshot {
            version,
            tracks: kinds
                .iter()
                .map(|kind| TrackEdit {
                    kind: (*kind).to_owned(),
                    clips: Vec::new(),
                })
                .collect(),
            titles: vec![],
            aspect: Aspect::Source,
        };
        assert!(check_version(&snapshot(2, &["video", "audio"])).is_ok());
        assert!(check_version(&snapshot(2, &["video"])).is_ok());
        assert!(check_version(&snapshot(1, &["video"])).is_err());
        assert!(check_version(&snapshot(2, &["video", "video"])).is_err());
        assert!(check_version(&snapshot(2, &["text"])).is_err());
    }

    #[test]
    fn snapshot_json_is_camel_case_and_strict() {
        let json = r#"{"version":2,"tracks":[{"kind":"video","clips":[{"assetId":7,"startMs":0,"endMs":1500,"positionMs":250}]}]}"#;
        let snapshot: TimelineSnapshot = serde_json::from_str(json).unwrap();
        assert_eq!(snapshot.duration_ms(), 1750);
        assert_eq!(serde_json::to_string(&snapshot).unwrap(), json);
        assert!(
            serde_json::from_str::<TimelineSnapshot>(r#"{"version":2,"tracks":[],"path":"C:/x"}"#)
                .is_err()
        );
    }
}
