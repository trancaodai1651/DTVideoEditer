//! Editable timeline exchange using the Final Cut Pro 7 XML vocabulary.
use std::{
    collections::{HashMap, HashSet},
    fmt::Write as _,
    fs,
    io::Write as _,
    path::Path,
};

use reqwest::Url;
use serde::Serialize;

use crate::{
    captions::{self, Cue},
    model::{Project, Result, StudioError},
    probe, render,
    store::Store,
    timeline::{ClipEdit, Look, TimelineSnapshot},
};

const INVALID_DESTINATION: StudioError = StudioError::Input("Hãy chọn vị trí lưu có đuôi .xml.");
const OUTPUT_EXISTS: StudioError =
    StudioError::Input("Tệp XML hoặc SRT đã tồn tại. Hãy chọn tên khác.");

#[derive(Clone, Copy)]
struct Rate {
    base: u32,
    ntsc: bool,
}

impl Rate {
    const SEQUENCE: Self = Self {
        base: render::FPS,
        ntsc: false,
    };

    fn from_source(value: Option<&str>) -> Self {
        let Some((num, den)) = value.and_then(|value| value.split_once('/')) else {
            return Self::SEQUENCE;
        };
        let (Ok(num), Ok(den)) = (num.parse::<u64>(), den.parse::<u64>()) else {
            return Self::SEQUENCE;
        };
        if num == 0 || den == 0 {
            return Self::SEQUENCE;
        }
        let fps = num as f64 / den as f64;
        let base = fps.round().clamp(1., 240.) as u32;
        let ntsc = [24, 30, 60, 120].contains(&base)
            && (fps - f64::from(base) * 1000. / 1001.).abs() < 0.005;
        Self { base, ntsc }
    }

    fn frames(self, ms: i64) -> i64 {
        let ms = ms * i64::from(self.base);
        let divisor = if self.ntsc { 1001 } else { 1000 };
        (ms + divisor / 2) / divisor
    }

    fn write(self, xml: &mut String) {
        let ntsc = if self.ntsc { "TRUE" } else { "FALSE" };
        write!(
            xml,
            "<rate><timebase>{}</timebase><ntsc>{ntsc}</ntsc></rate>",
            self.base
        )
        .unwrap();
    }
}

struct Media<'a> {
    source: &'a render::Source,
    url: Url,
    rate: Rate,
    duration_ms: i64,
    audio: Option<(u8, u32)>,
}

#[derive(Clone, Copy)]
struct Id {
    serial: usize,
    track: usize,
    position: usize,
    audio: bool,
}

impl Id {
    fn kind(self) -> &'static str {
        if self.audio { "audio" } else { "video" }
    }
    fn label(self) -> String {
        format!("{}-{}", self.kind(), self.serial)
    }
    fn link(self, xml: &mut String) {
        write!(xml, "<link><linkclipref>{}</linkclipref><mediatype>{}</mediatype><trackindex>{}</trackindex><clipindex>{}</clipindex>",
            self.label(), self.kind(), self.track + 1, self.position + 1).unwrap();
        if self.audio {
            xml.push_str("<groupindex>1</groupindex>");
        }
        xml.push_str("</link>");
    }
}

struct Item<'a> {
    clip: &'a ClipEdit,
    id: Id,
    pair: Option<Id>,
    enabled: bool,
}

fn gain(look: &Look) -> f64 {
    look.gain_db.map_or(f64::from(look.volume) / 100., |db| {
        10.0_f64.powf(f64::from(db) / 20.)
    })
}

fn escaped(text: &str) -> String {
    let mut out = String::with_capacity(text.len());
    for c in text.chars() {
        match c {
            '&' => out.push_str("&amp;"),
            '<' => out.push_str("&lt;"),
            '>' => out.push_str("&gt;"),
            '"' => out.push_str("&quot;"),
            '\'' => out.push_str("&apos;"),
            '\u{0}'..='\u{8}'
            | '\u{b}'
            | '\u{c}'
            | '\u{e}'..='\u{1f}'
            | '\u{fffe}'
            | '\u{ffff}' => out.push('\u{fffd}'),
            _ => out.push(c),
        }
    }
    out
}

fn video_format(xml: &mut String, rate: Rate, width: u32, height: u32) {
    xml.push_str("<samplecharacteristics>");
    rate.write(xml);
    write!(xml, "<width>{width}</width><height>{height}</height><anamorphic>FALSE</anamorphic><pixelaspectratio>square</pixelaspectratio><fielddominance>none</fielddominance></samplecharacteristics>").unwrap();
}

fn write_item(xml: &mut String, item: &Item<'_>, media: &Media<'_>, first: bool) {
    let Item {
        clip,
        id,
        pair,
        enabled,
    } = item;
    let name = escaped(
        &media
            .source
            .path
            .file_name()
            .unwrap_or_default()
            .to_string_lossy(),
    );
    let still = media.source.kind == "image";
    let file_duration = media.rate.frames(media.duration_ms).max(1);
    let start = Rate::SEQUENCE.frames(clip.position_ms);
    let end = Rate::SEQUENCE.frames(clip.finish_ms()).max(start + 1);
    let in_frame = if still {
        0
    } else {
        media.rate.frames(clip.start_ms).min(file_duration - 1)
    };
    let out_frame = if still {
        end - start
    } else {
        media
            .rate
            .frames(clip.end_ms)
            .clamp(in_frame + 1, file_duration)
    };
    let enabled = if *enabled { "TRUE" } else { "FALSE" };
    write!(xml, "<clipitem id=\"{}\"><name>{name}</name><enabled>{enabled}</enabled><duration>{file_duration}</duration>", id.label()).unwrap();
    media.rate.write(xml);
    write!(
        xml,
        "<start>{start}</start><end>{end}</end><in>{in_frame}</in><out>{out_frame}</out>"
    )
    .unwrap();
    let asset = clip.asset_id;
    if first {
        write!(
            xml,
            "<file id=\"file-{asset}\"><name>{name}</name><pathurl>{}</pathurl>",
            escaped(media.url.as_str())
        )
        .unwrap();
        media.rate.write(xml);
        write!(xml, "<duration>{file_duration}</duration><media>").unwrap();
        if media.source.kind != "audio" {
            xml.push_str("<video>");
            video_format(
                xml,
                media.rate,
                media.source.width.unwrap_or(1920),
                media.source.height.unwrap_or(1080),
            );
            if still {
                xml.push_str("<stillframe>TRUE</stillframe>");
            }
            xml.push_str("</video>");
        }
        if let Some((channels, rate)) = media.audio {
            write!(xml, "<audio><samplecharacteristics><depth>16</depth><samplerate>{rate}</samplerate></samplecharacteristics><channelcount>{channels}</channelcount></audio>").unwrap();
        }
        xml.push_str("</media></file>");
    } else {
        write!(xml, "<file id=\"file-{asset}\"/>").unwrap();
    }
    if still {
        xml.push_str("<stillframe>TRUE</stillframe>");
    }
    if id.audio {
        xml.push_str(
            "<sourcetrack><mediatype>audio</mediatype><trackindex>1</trackindex></sourcetrack>",
        );
        let gain = gain(&clip.look);
        if (gain - 1.).abs() > f64::EPSILON {
            write!(xml, "<filter><effect><name>Audio Levels</name><effectid>audiolevels</effectid><effectcategory>audiolevels</effectcategory><effecttype>audio</effecttype><mediatype>audio</mediatype><parameter><parameterid>level</parameterid><name>Level</name><value>{gain:.6}</value></parameter></effect></filter>").unwrap();
        }
    }
    if let Some(pair) = pair {
        id.link(xml);
        pair.link(xml);
    }
    xml.push_str("</clipitem>\n");
}

fn track_count(clips: &[&ClipEdit]) -> usize {
    clips
        .iter()
        .map(|clip| usize::from(clip.layer) + 1)
        .max()
        .unwrap_or_default()
}

fn write_sequence(
    name: &str,
    snapshot: &TimelineSnapshot,
    sources: &HashMap<i64, render::Source>,
    media: &HashMap<i64, Media<'_>>,
) -> String {
    let visuals = snapshot.clips("video");
    let sounds = snapshot.clips("audio");
    let dedicated = track_count(&sounds);
    let mut video: Vec<Vec<Item<'_>>> = (0..track_count(&visuals)).map(|_| Vec::new()).collect();
    let mut audio: Vec<Vec<Item<'_>>> = (0..dedicated + video.len()).map(|_| Vec::new()).collect();
    for (serial, clip) in visuals.iter().copied().chain(sounds).enumerate() {
        let layer = usize::from(clip.layer);
        let is_audio = serial >= visuals.len();
        let kind = if is_audio { "audio" } else { "video" };
        let lane = snapshot.lane(kind, clip.layer);
        let enabled = !clip.look.disabled;
        if is_audio {
            if media[&clip.asset_id].audio.is_some() {
                let id = Id {
                    serial,
                    track: layer,
                    position: audio[layer].len(),
                    audio: true,
                };
                audio[layer].push(Item {
                    clip,
                    id,
                    pair: None,
                    enabled: enabled && !lane.is_some_and(|lane| lane.muted),
                });
            }
        } else {
            let id = Id {
                serial,
                track: layer,
                position: video[layer].len(),
                audio: false,
            };
            let pair = if media[&clip.asset_id].audio.is_some() && !clip.look.audio_detached {
                let track = dedicated + layer;
                let pair = Id {
                    serial,
                    track,
                    position: audio[track].len(),
                    audio: true,
                };
                audio[track].push(Item {
                    clip,
                    id: pair,
                    pair: Some(id),
                    enabled: enabled && !lane.is_some_and(|lane| lane.muted),
                });
                Some(pair)
            } else {
                None
            };
            video[layer].push(Item {
                clip,
                id,
                pair,
                enabled: enabled && !lane.is_some_and(|lane| lane.hidden),
            });
        }
    }
    while audio.last().is_some_and(Vec::is_empty) {
        audio.pop();
    }
    let name = escaped(name);
    let duration = Rate::SEQUENCE.frames(snapshot.duration_ms());
    let (width, height) = render::frame_size(snapshot, sources);
    let mut xml = format!(
        "<?xml version=\"1.0\" encoding=\"UTF-8\"?>\n<!DOCTYPE xmeml>\n<xmeml version=\"4\"><sequence id=\"sequence-1\"><name>{name}</name><duration>{duration}</duration>"
    );
    Rate::SEQUENCE.write(&mut xml);
    xml.push_str("<media><video><format>");
    video_format(&mut xml, Rate::SEQUENCE, width, height);
    xml.push_str("</format>");
    let mut seen = HashSet::new();
    for (index, track) in video.iter().chain(&audio).enumerate() {
        if index == video.len() {
            xml.push_str("</video><audio><numOutputChannels>2</numOutputChannels><format><samplecharacteristics><depth>16</depth><samplerate>48000</samplerate></samplecharacteristics></format>");
        }
        xml.push_str("<track>");
        for item in track {
            write_item(
                &mut xml,
                item,
                &media[&item.clip.asset_id],
                seen.insert(item.clip.asset_id),
            );
        }
        xml.push_str("<enabled>TRUE</enabled><locked>FALSE</locked></track>\n");
    }
    xml.push_str(if audio.is_empty() {
        "</video>"
    } else {
        "</audio>"
    });
    xml.push_str("</media></sequence></xmeml>\n");
    xml
}

#[derive(Serialize)]
#[serde(rename_all = "camelCase")]
pub struct ExportResult {
    pub xml_path: String,
    pub srt_path: Option<String>,
    pub has_unsupported: bool,
}

fn has_unsupported(snapshot: &TimelineSnapshot) -> bool {
    !snapshot.adjustments.is_empty()
        || snapshot.titles.iter().any(|title| !title.caption)
        || snapshot
            .tracks
            .iter()
            .flat_map(|track| &track.clips)
            .any(|clip| {
                let look = &clip.look;
                *look
                    != Look {
                        volume: look.volume,
                        gain_db: look.gain_db,
                        disabled: look.disabled,
                        audio_detached: look.audio_detached,
                        audio_link: look.audio_link,
                        ..Look::default()
                    }
            })
}

pub fn export(store: &Store, project: &Project, output: &Path) -> Result<ExportResult> {
    if !output.is_absolute()
        || !output
            .extension()
            .is_some_and(|ext| ext.eq_ignore_ascii_case("xml"))
    {
        return Err(INVALID_DESTINATION);
    }
    let root = dunce::canonicalize(output.parent().ok_or(INVALID_DESTINATION)?)?;
    let output = root.join(output.file_name().ok_or(INVALID_DESTINATION)?);
    let snapshot = store.snapshot(project.id)?;
    if snapshot.tracks.iter().all(|track| track.clips.is_empty()) {
        return Err(StudioError::Input(
            "Thêm video, ảnh hoặc âm thanh vào timeline trước khi xuất cho Premiere.",
        ));
    }
    let subtitles: Vec<_> = snapshot
        .titles
        .iter()
        .filter(|title| {
            title.caption
                && !snapshot
                    .lane("text", title.layer)
                    .is_some_and(|lane| lane.hidden)
        })
        .map(|title| Cue {
            start_ms: title.position_ms,
            end_ms: title.position_ms + title.duration_ms,
            text: title.text.clone(),
            words: Vec::new(),
        })
        .collect();
    let srt = (!subtitles.is_empty()).then(|| output.with_extension("srt"));
    if output.symlink_metadata().is_ok()
        || srt
            .as_ref()
            .is_some_and(|path| path.symlink_metadata().is_ok())
    {
        return Err(OUTPUT_EXISTS);
    }
    let ffprobe = probe::find_tool("ffprobe").ok_or(StudioError::Input(
        "Cần FFprobe trong PATH để đọc tốc độ khung và các kênh âm thanh.",
    ))?;
    let sources = render::resolve(store, &snapshot, &ffprobe)?;
    let mut media = HashMap::new();
    for (&id, source) in &sources {
        let streams = probe::edit_streams(&ffprobe, &source.path, &source.format).ok_or(
            StudioError::Input("FFprobe chưa đọc được nguồn trong timeline."),
        )?;
        let video = streams.iter().find(|stream| {
            stream.codec_type == "video"
                && stream
                    .disposition
                    .as_ref()
                    .and_then(|value| value.attached_pic)
                    != Some(1)
        });
        let audio = streams
            .iter()
            .find(|stream| stream.codec_type == "audio")
            .map(|stream| {
                (
                    stream.channels.unwrap_or(2),
                    stream
                        .sample_rate
                        .as_deref()
                        .and_then(|value| value.parse().ok())
                        .unwrap_or(48000),
                )
            });
        let duration = store
            .source(id, false)?
            .ok_or(StudioError::Input("Nguồn không còn trong thư viện."))?
            .duration_ms;
        let url = Url::from_file_path(&source.path).map_err(|_| {
            StudioError::Input("Đường dẫn nguồn không dùng được trong Premiere XML.")
        })?;
        let rate = if source.kind == "image" {
            Rate::SEQUENCE
        } else {
            Rate::from_source(video.and_then(|stream| stream.avg_frame_rate.as_deref()))
        };
        media.insert(
            id,
            Media {
                source,
                url,
                audio,
                rate,
                duration_ms: duration.unwrap_or_else(|| {
                    snapshot
                        .tracks
                        .iter()
                        .flat_map(|track| &track.clips)
                        .filter(|clip| clip.asset_id == id)
                        .map(ClipEdit::length_ms)
                        .max()
                        .unwrap_or(1000)
                }),
            },
        );
    }
    let mut temporary = tempfile::NamedTempFile::new_in(&root)?;
    temporary.write_all(write_sequence(&project.name, &snapshot, &sources, &media).as_bytes())?;
    temporary.as_file().sync_all()?;
    if let Some(path) = &srt {
        captions::write(path, subtitles)?;
    }
    if let Err(error) = temporary.persist_noclobber(&output) {
        if let Some(path) = &srt {
            let _ = fs::remove_file(path);
        }
        return Err(error.error.into());
    }
    Ok(ExportResult {
        xml_path: output.to_string_lossy().into_owned(),
        srt_path: srt.map(|path| path.to_string_lossy().into_owned()),
        has_unsupported: has_unsupported(&snapshot),
    })
}
