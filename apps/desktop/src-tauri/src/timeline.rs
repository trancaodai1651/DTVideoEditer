use serde::{Deserialize, Serialize};

use crate::model::{Result, StudioError};

pub const TIMELINE_VERSION: u32 = 2;
pub const MIN_CLIP_MS: i64 = 100;
pub const MAX_IMAGE_MS: i64 = 10 * 60 * 1000;
pub const MAX_TIMELINE_MS: i64 = 6 * 60 * 60 * 1000;
pub const MAX_TRACK_CLIPS: usize = 200;

/// One edit point set. `start_ms..end_ms` is the range read from the source,
/// `position_ms` is where that range starts on the timeline.
#[derive(Clone, Debug, PartialEq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase", deny_unknown_fields)]
pub struct ClipEdit {
    pub asset_id: i64,
    pub start_ms: i64,
    pub end_ms: i64,
    pub position_ms: i64,
}

impl ClipEdit {
    pub fn length_ms(&self) -> i64 {
        self.end_ms - self.start_ms
    }

    pub fn finish_ms(&self) -> i64 {
        self.position_ms + self.length_ms()
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
    if snapshot.version != TIMELINE_VERSION {
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
        return Err(StudioError::Input(
            "Timeline chỉ có một track video và một track âm thanh.",
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
    if clip.start_ms < 0
        || clip.position_ms < 0
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
    if clips.len() > MAX_TRACK_CLIPS {
        return Err(StudioError::Input("Track có quá nhiều clip."));
    }
    let mut order: Vec<_> = clips.iter().collect();
    order.sort_by_key(|clip| clip.position_ms);
    if order
        .windows(2)
        .any(|pair| pair[1].position_ms < pair[0].finish_ms())
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
