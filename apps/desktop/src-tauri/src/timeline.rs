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

#[derive(Clone, Debug, PartialEq, Eq, Serialize, Deserialize)]
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
    #[serde(skip_serializing_if = "Option::is_none")]
    pub audio_fade_in_ms: Option<u16>,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub audio_fade_out_ms: Option<u16>,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub gain_db: Option<i8>,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub edit_group: Option<u32>,
    #[serde(skip_serializing_if = "Vec::is_empty")]
    pub keyframes: Vec<TransformKey>,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub transition: Option<ClipTransition>,
    /// A video clip whose sound was moved to its own audio clip.
    #[serde(skip_serializing_if = "is_false")]
    pub audio_detached: bool,
    /// Pairs a detached audio clip with the video clip it came from.
    #[serde(skip_serializing_if = "Option::is_none")]
    pub audio_link: Option<u32>,
    /// Keeps the clip on the timeline but leaves it out of preview and export.
    #[serde(skip_serializing_if = "is_false")]
    pub disabled: bool,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub compound: Option<Compound>,
    /// Clips that share a multicam id are camera angles of one take.
    #[serde(skip_serializing_if = "Option::is_none")]
    pub multicam: Option<u32>,
    #[serde(skip_serializing_if = "Vec::is_empty")]
    pub speed_curve: Vec<SpeedPoint>,
}

/// A point on a speed curve. `at` is the position in the source range in
/// thousandths, `speed` is a percentage of normal speed.
#[derive(Clone, Copy, Debug, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase", deny_unknown_fields)]
pub struct SpeedPoint {
    pub at: u16,
    pub speed: u16,
}

/// Clips that share a compound id are edited and moved as one named block.
#[derive(Clone, Debug, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase", deny_unknown_fields)]
pub struct Compound {
    pub id: u32,
    pub name: String,
}

pub const CURVE_SEGMENTS: i64 = 24;
pub const MIN_SPEED: u16 = 10;
pub const MAX_SPEED: u16 = 1000;

fn curve_speed(points: &[SpeedPoint], at: i64) -> i64 {
    let mut previous = points[0];
    for &point in &points[1..] {
        if at <= i64::from(point.at) {
            let (a0, a1) = (i64::from(previous.at), i64::from(point.at));
            let (s0, s1) = (i64::from(previous.speed), i64::from(point.speed));
            return s0 + (s1 - s0) * (at - a0) / (a1 - a0).max(1);
        }
        previous = point;
    }
    i64::from(previous.speed)
}

/// The source range split into equal parts, each played at one speed:
/// `(source start, source end, speed percent)` relative to the clip in point.
pub fn curve_segments(source_ms: i64, points: &[SpeedPoint]) -> Vec<(i64, i64, i64)> {
    (0..CURVE_SEGMENTS)
        .map(|index| {
            let middle = (2 * index + 1) * 1000 / (2 * CURVE_SEGMENTS);
            (
                source_ms * index / CURVE_SEGMENTS,
                source_ms * (index + 1) / CURVE_SEGMENTS,
                curve_speed(points, middle).max(1),
            )
        })
        .collect()
}

fn scaled(source_ms: i64, speed: i64) -> i64 {
    source_ms.saturating_mul(100).saturating_add(speed / 2) / speed
}

#[derive(Clone, Debug, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase", deny_unknown_fields)]
pub struct TransformKey {
    pub at_ms: i64,
    pub x: i16,
    pub y: i16,
    pub scale: u16,
    pub rotate: i16,
    pub opacity: u8,
    #[serde(default)]
    pub smooth: bool,
}

#[derive(Clone, Copy, Debug, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "snake_case")]
pub enum TransitionKind {
    Black,
    Dissolve,
}

#[derive(Clone, Debug, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase", deny_unknown_fields)]
pub struct ClipTransition {
    pub kind: TransitionKind,
    pub duration_ms: u16,
    pub from_asset_id: i64,
    pub from_start_ms: i64,
}

pub fn transition_between(left: &ClipEdit, right: &ClipEdit) -> Option<(TransitionKind, i64)> {
    let edit = right.look.transition.as_ref()?;
    if left.layer != right.layer
        || left.finish_ms() != right.position_ms
        || left.asset_id != edit.from_asset_id
        || left.start_ms != edit.from_start_ms
    {
        return None;
    }
    let length = i64::from(edit.duration_ms)
        .min(left.length_ms())
        .min(right.length_ms());
    Some((edit.kind, length))
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
            audio_fade_in_ms: None,
            audio_fade_out_ms: None,
            gain_db: None,
            edit_group: None,
            keyframes: Vec::new(),
            transition: None,
            audio_detached: false,
            audio_link: None,
            disabled: false,
            compound: None,
            multicam: None,
            speed_curve: Vec::new(),
        }
    }
}

impl Look {
    fn is_default(&self) -> bool {
        *self == Self::default()
    }

    fn valid_curve(&self) -> bool {
        let points = &self.speed_curve;
        (2..=10).contains(&points.len())
            && points[0].at == 0
            && points[points.len() - 1].at == 1000
            && points.windows(2).all(|pair| pair[0].at < pair[1].at)
            && points
                .iter()
                .all(|point| (MIN_SPEED..=MAX_SPEED).contains(&point.speed))
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
            && self.audio_fade_in_ms.is_none_or(|ms| ms <= 10_000)
            && self.audio_fade_out_ms.is_none_or(|ms| ms <= 10_000)
            && self.gain_db.is_none_or(|db| (-60..=6).contains(&db))
            && (MIN_SPEED..=MAX_SPEED).contains(&self.speed)
            && (self.speed_curve.is_empty() || self.speed == 100)
            && (self.speed_curve.is_empty() || self.valid_curve())
            && self.compound.as_ref().is_none_or(|compound| {
                let length = compound.name.chars().count();
                (1..=60).contains(&length) && !compound.name.chars().any(char::is_control)
            })
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
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub edit_group: Option<u32>,
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
        if self.look.speed_curve.len() >= 2 {
            return curve_segments(self.source_length_ms(), &self.look.speed_curve)
                .into_iter()
                .map(|(start, end, speed)| scaled(end - start, speed))
                .sum();
        }
        scaled(self.source_length_ms(), i64::from(self.look.speed.max(1)))
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

#[derive(Clone, Debug, Default, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase", deny_unknown_fields)]
pub struct LaneControl {
    pub track: String,
    pub layer: u8,
    #[serde(default)]
    pub locked: bool,
    #[serde(default)]
    pub muted: bool,
    #[serde(default)]
    pub hidden: bool,
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
    #[serde(default, skip_serializing_if = "Vec::is_empty")]
    pub lanes: Vec<LaneControl>,
    #[serde(
        default,
        rename = "exportRange",
        skip_serializing_if = "Option::is_none"
    )]
    pub export_range: Option<ExportRange>,
}

#[derive(Clone, Copy, Debug, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase", deny_unknown_fields)]
pub struct ExportRange {
    pub start_ms: i64,
    pub end_ms: i64,
}

impl TimelineSnapshot {
    pub fn lane(&self, track: &str, layer: u8) -> Option<&LaneControl> {
        self.lanes
            .iter()
            .find(|lane| lane.track == track && lane.layer == layer)
    }

    pub fn export_duration_ms(&self) -> Result<i64> {
        let total = self.duration_ms();
        match self.export_range {
            Some(range)
                if range.start_ms >= 0
                    && range.end_ms <= total
                    && range.end_ms.saturating_sub(range.start_ms) >= MIN_CLIP_MS =>
            {
                Ok(range.end_ms - range.start_ms)
            }
            Some(_) => Err(StudioError::Input(
                "Vùng In–Out không hợp lệ hoặc ngắn hơn 100 ms.",
            )),
            None => Ok(total),
        }
    }
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
    let mut lanes = std::collections::HashSet::new();
    if snapshot.lanes.len() > 3 * usize::from(MAX_LAYERS)
        || snapshot.lanes.iter().any(|lane| {
            lane.layer >= MAX_LAYERS
                || !matches!(lane.track.as_str(), "video" | "audio" | "text")
                || (lane.track == "text" && lane.muted)
                || (lane.track == "audio" && lane.hidden)
                || !lanes.insert((lane.track.as_str(), lane.layer))
        })
    {
        return Err(StudioError::Input("Timeline có cài đặt tầng không hợp lệ."));
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
        // A video clip's sound can sit on an audio track once it is detached.
        "video" => track == "video" || (track == "audio" && clip.look.audio_link.is_some()),
        "image" => track == "video",
        _ => false,
    };
    if !fits_track {
        return Err(StudioError::Input("Loại media không khớp với track."));
    }
    if clip.layer >= MAX_LAYERS
        || !clip.look.valid()
        || (asset.kind == "image" && (clip.look.speed != 100 || !clip.look.speed_curve.is_empty()))
        || (track != "video" && (clip.look.audio_detached || clip.look.multicam.is_some()))
        || (track == "video" && clip.look.audio_link.is_some() && !clip.look.audio_detached)
        || (track == "audio" && !clip.look.keyframes.is_empty())
        || clip.look.transition.as_ref().is_some_and(|edit| {
            track != "video"
                || !(100..=3000).contains(&edit.duration_ms)
                || edit.from_asset_id < 1
                || edit.from_start_ms < 0
        })
        || clip.look.keyframes.len() > 32
        || clip
            .look
            .keyframes
            .windows(2)
            .any(|pair| pair[0].at_ms >= pair[1].at_ms)
        || clip.look.keyframes.iter().any(|key| {
            !(0..=clip.length_ms()).contains(&key.at_ms)
                || !(-100..=100).contains(&key.x)
                || !(-100..=100).contains(&key.y)
                || !(10..=200).contains(&key.scale)
                || !(-180..=180).contains(&key.rotate)
                || key.opacity > 100
        })
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
    fn speed_curves_fix_length_and_detached_audio_fits_audio_tracks() {
        let mut curved = clip(0, 4800, 0);
        curved.look.speed_curve = vec![
            SpeedPoint { at: 0, speed: 200 },
            SpeedPoint {
                at: 1000,
                speed: 200,
            },
        ];
        assert_eq!(curved.length_ms(), 2400);
        curved.look.speed_curve = vec![
            SpeedPoint { at: 0, speed: 100 },
            SpeedPoint {
                at: 500,
                speed: 400,
            },
            SpeedPoint {
                at: 1000,
                speed: 100,
            },
        ];
        let segments = curve_segments(4800, &curved.look.speed_curve);
        assert_eq!(segments.len(), 24);
        assert_eq!((segments[0].0, segments[23].1), (0, 4800));
        assert_eq!(segments[0].2, 112);
        assert_eq!(segments[11].2, 387);
        assert_eq!(curved.length_ms(), 2213);
        let video = AssetFacts {
            kind: "video",
            duration_ms: Some(6000),
        };
        assert!(check_clip("video", &curved, &video).is_ok());
        curved.look.speed = 150;
        assert!(
            check_clip("video", &curved, &video).is_err(),
            "a curve replaces the constant speed"
        );
        curved.look.speed = 100;
        curved.look.speed_curve[1].at = 0;
        assert!(check_clip("video", &curved, &video).is_err());

        let mut sound = clip(0, 3000, 0);
        assert!(check_clip("audio", &sound, &video).is_err());
        sound.look.audio_link = Some(7);
        assert!(check_clip("audio", &sound, &video).is_ok());
        let mut picture = clip(0, 3000, 0);
        picture.look.audio_link = Some(7);
        assert!(
            check_clip("video", &picture, &video).is_err(),
            "the video side must be marked detached"
        );
        picture.look.audio_detached = true;
        assert!(check_clip("video", &picture, &video).is_ok());
        picture.look.compound = Some(Compound {
            id: 1,
            name: String::new(),
        });
        assert!(check_clip("video", &picture, &video).is_err());
        picture.look.compound = Some(Compound {
            id: 1,
            name: "Mở đầu".into(),
        });
        picture.look.multicam = Some(2);
        picture.look.disabled = true;
        assert!(check_clip("video", &picture, &video).is_ok());
        let mut slow = clip(0, 1000, 0);
        slow.look.speed = 10;
        assert_eq!(slow.length_ms(), 10_000);
        assert!(check_clip("video", &slow, &video).is_ok());
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
            lanes: Vec::new(),
            export_range: None,
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
