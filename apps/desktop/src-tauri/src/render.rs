use std::{
    collections::HashMap,
    ffi::OsString,
    fs,
    io::{BufRead, BufReader, Read},
    path::{Path, PathBuf},
    process::Stdio,
    sync::{
        Arc,
        atomic::{AtomicBool, AtomicI64, Ordering},
    },
    thread,
    time::{Duration, Instant},
};

use wait_timeout::ChildExt;

use crate::{
    library::authorized_asset,
    model::{Result, StudioError},
    probe::{self, MediaFormat},
    store::Store,
    timeline::{
        Aspect, ClipEdit, Effect, KeyColor, Look, Motion, TimelineSnapshot, TitleAlign, TitleFont,
        TransformKey, TransitionKind, check_version, curve_segments, transition_between,
    },
};

pub const FPS: u32 = 30;
const MAX_SIDE: u32 = 3840;
const MAX_COMMAND_CHARS: usize = 30_000;
const ERROR_TAIL: usize = 600;

/// A clip's media after the grant and path checks.
pub struct Source {
    pub path: PathBuf,
    pub format: MediaFormat,
    pub kind: String,
    pub has_audio: bool,
    pub width: Option<u32>,
    pub height: Option<u32>,
}

pub struct Plan {
    pub args: Vec<OsString>,
    pub duration_ms: i64,
    pub output: PathBuf,
    titles: Vec<String>,
    graph_file: Option<OsString>,
    /// Fonts the titles use, written next to the graph as font-<name>.ttf.
    fonts: Vec<TitleFont>,
    /// LUT ids referenced as lut-<id>.cube. `execute` fills in the file contents.
    pub luts: Vec<(i64, String)>,
}

#[derive(Debug, PartialEq)]
pub enum Outcome {
    Done,
    Canceled,
}

fn seconds(ms: i64) -> String {
    format!("{}.{:03}", ms / 1000, ms % 1000)
}

fn frame_size(snapshot: &TimelineSnapshot, sources: &HashMap<i64, Source>) -> (u32, u32) {
    match snapshot.aspect {
        Aspect::Landscape => return (1920, 1080),
        Aspect::Portrait => return (1080, 1920),
        Aspect::Square => return (1080, 1080),
        Aspect::Source => {}
    }
    let even = |value: f64| ((value.round() as u32).max(16)) & !1;
    snapshot
        .clips("video")
        .iter()
        .find_map(|clip| {
            let source = sources.get(&clip.asset_id)?;
            Some((source.width?, source.height?))
        })
        .filter(|(width, height)| *width > 0 && *height > 0)
        .map(|(width, height)| {
            let scale = (f64::from(MAX_SIDE) / f64::from(width.max(height))).min(1.0);
            (
                even(f64::from(width) * scale),
                even(f64::from(height) * scale),
            )
        })
        .unwrap_or((1280, 720))
}

fn push_input(args: &mut Vec<OsString>, source: &Source, clip: &ClipEdit) {
    args.extend(source.format.input_args().map(OsString::from));
    if let Some(at) = clip.look.freeze_at_ms {
        args.extend(
            [
                "-ss".to_owned(),
                seconds(at),
                "-t".to_owned(),
                "1".to_owned(),
            ]
            .map(OsString::from),
        );
    } else if source.kind != "image" {
        // Read a little past the out point. The filter graph makes the exact cut.
        args.extend(
            [
                "-ss".to_owned(),
                seconds(clip.start_ms),
                "-t".to_owned(),
                seconds(clip.source_length_ms() + 500),
            ]
            .map(OsString::from),
        );
    }
    args.push("-i".into());
    args.push(source.path.clone().into());
}

fn audio_chain(index: usize, clip: &ClipEdit) -> String {
    let length = clip.length_ms();
    let legacy = i64::from(clip.look.fade_ms).min(length / 2);
    let fade_in = clip.look.audio_fade_in_ms.map_or(legacy, i64::from);
    let fade_out = clip.look.audio_fade_out_ms.map_or(legacy, i64::from);
    let denominator = length.max(fade_in + fade_out);
    let (fade_in, fade_out) = (
        fade_in * length / denominator,
        fade_out * length / denominator,
    );
    let mut fades = String::new();
    if fade_in > 0 {
        fades.push_str(&format!(",afade=t=in:d={}", seconds(fade_in)));
    }
    if fade_out > 0 {
        fades.push_str(&format!(
            ",afade=t=out:st={}:d={}",
            seconds(length - fade_out),
            seconds(fade_out)
        ));
    }
    let volume = clip.look.gain_db.map_or_else(
        || format!("{:.2}", f64::from(clip.look.volume) / 100.0),
        |db| format!("{db}dB"),
    );
    let clean = if clip.look.clean_audio {
        ",afftdn=nf=-28,highpass=f=70"
    } else {
        ""
    };
    let head = format!(
        "[{index}:a:0]aresample=48000,aformat=sample_fmts=fltp:channel_layouts=stereo,\
         atrim=duration={},asetpts=PTS-STARTPTS{}",
        seconds(clip.source_length_ms()),
        if clip.look.reverse { ",areverse" } else { "" }
    );
    let tail = format!(
        "volume={volume}{fades},adelay={}:all=1[a{index}]",
        clip.position_ms
    );
    if clip.look.speed_curve.len() < 2 {
        return format!("{head}{}{clean},{tail}", tempo(i64::from(clip.look.speed)));
    }
    // A speed curve plays each source segment at its own tempo, then joins them.
    let segments = curve_segments(clip.source_length_ms(), &clip.look.speed_curve);
    let outputs: String = (0..segments.len())
        .map(|part| format!("[ac{index}x{part}]"))
        .collect();
    let mut chain = vec![format!("{head}{clean},asplit={}{outputs}", segments.len())];
    for (part, (start, end, speed)) in segments.iter().enumerate() {
        chain.push(format!(
            "[ac{index}x{part}]atrim=start={}:end={},asetpts=PTS-STARTPTS{}[ap{index}x{part}]",
            seconds(*start),
            seconds(*end),
            tempo(*speed)
        ));
    }
    let parts: String = (0..segments.len())
        .map(|part| format!("[ap{index}x{part}]"))
        .collect();
    chain.push(format!("{parts}concat=n={}:v=0:a=1,{tail}", segments.len()));
    chain.join(";")
}

/// `atempo` accepts 0.5 to 100 per filter, so slower speeds are chained.
fn tempo(speed: i64) -> String {
    let mut factor = speed as f64 / 100.0;
    let mut filters = String::new();
    while factor < 0.5 {
        filters.push_str(",atempo=0.5");
        factor /= 0.5;
    }
    if (factor - 1.0).abs() > 1e-9 {
        filters.push_str(&format!(",atempo={factor:.4}"));
    }
    filters
}

/// Maps source time to output time for a speed curve, segment by segment.
fn curve_pts(clip: &ClipEdit) -> String {
    let segments = curve_segments(clip.source_length_ms(), &clip.look.speed_curve);
    let mut offset = 0;
    let mut pieces = Vec::new();
    for (start, end, speed) in &segments {
        pieces.push((
            *end,
            format!(
                "{}+(T-STARTT-{})*100/{speed}",
                seconds(offset),
                seconds(*start)
            ),
        ));
        offset += (end - start).saturating_mul(100).saturating_add(speed / 2) / speed;
    }
    let (_, last) = pieces.pop().expect("a curve has segments");
    pieces.iter().rev().fold(last, |inner, (end, value)| {
        format!("if(lt(T-STARTT,{}),{value},{inner})", seconds(*end))
    })
}

/// Tint, hue, vibrance, the tone curve and a LUT. `enable` limits them to a time span.
fn color_filters(look: &Look, enable: &str) -> String {
    let mut filters = String::new();
    if look.temperature != 0 && !enable.is_empty() {
        let heat = f64::from(look.temperature) / 500.0;
        filters.push_str(&format!(
            ",colorbalance=rm={heat:.3}:bm={:.3}:pl=1{enable}",
            -heat
        ));
    }
    if look.tint != 0 {
        filters.push_str(&format!(
            ",colorbalance=gm={:.3}:pl=1{enable}",
            -f64::from(look.tint) / 250.0
        ));
    }
    if look.hue != 0 {
        filters.push_str(&format!(",hue=h={}{enable}", look.hue));
    }
    if look.vibrance != 0 {
        filters.push_str(&format!(
            ",vibrance=intensity={:.2}{enable}",
            f64::from(look.vibrance) / 100.0
        ));
    }
    for (flag, band) in look.hsl.map(|hsl| hsl.active()).unwrap_or_default() {
        filters.push_str(&format!(
            ",huesaturation=hue={}:saturation={:.2}:intensity={:.2}:colors={flag}{enable}",
            band.hue,
            f64::from(band.saturation) / 100.0,
            f64::from(band.lightness) / 200.0
        ));
    }
    // Per-channel curves (colour wheels and RGB curves) run first; FFmpeg
    // applies the master curve as a second pass, like the preview's SVG filter.
    let mut curves = Vec::new();
    let points = |values: &[f64]| {
        let last = (values.len() - 1) as f64;
        values
            .iter()
            .enumerate()
            .map(|(index, y)| format!("{}/{y:.4}", index as f64 / last))
            .collect::<Vec<_>>()
            .join(" ")
    };
    if let Some(channels) = look.channel_points() {
        for (name, values) in ["r", "g", "b"].iter().zip(channels) {
            curves.push(format!("{name}='{}'", points(&values)));
        }
    }
    if let Some(master) = look.tone_points() {
        curves.push(format!("master='{}'", points(&master)));
    }
    if !curves.is_empty() {
        filters.push_str(&format!(",curves={}{enable}", curves.join(":")));
    }
    if let Some(id) = look.lut {
        filters.push_str(&format!(",lut3d=file=lut-{id}.cube{enable}"));
    }
    filters
}

/// Everything an adjustment layer applies to the picture below it during its span.
fn adjustment_filters(look: &Look, start_ms: i64, end_ms: i64) -> String {
    let enable = format!(
        ":enable='between(t,{},{})'",
        seconds(start_ms),
        seconds(end_ms)
    );
    let mut filters = String::new();
    if look.brightness != 0 || look.contrast != 100 || look.saturation != 100 {
        filters.push_str(&format!(
            ",eq=brightness={:.2}:contrast={:.2}:saturation={:.2}{enable}",
            f64::from(look.brightness) / 100.0,
            f64::from(look.contrast) / 100.0,
            f64::from(look.saturation) / 100.0
        ));
    }
    filters.push_str(&color_filters(look, &enable));
    filters.push_str(&match look.effect {
        Effect::None => String::new(),
        Effect::Blur => format!(",gblur=sigma=4{enable}"),
        Effect::Vignette => format!(",vignette=PI/5{enable}"),
        Effect::Grain => format!(",noise=alls=10:allf=t+u:all_seed=37{enable}"),
    });
    if look.sharpen {
        filters.push_str(&format!(",unsharp=5:5:0.85:5:5:0{enable}"));
    }
    filters
}

fn grade_filters(look: &Look) -> String {
    let mut filters = String::new();
    if look.temperature != 0 {
        let heat = f64::from(look.temperature) / 500.0;
        filters.push_str(&format!(",colorbalance=rm={heat:.3}:bm={:.3}:pl=1", -heat));
    }
    filters.push_str(&color_filters(look, ""));
    if look.denoise {
        filters.push_str(",hqdn3d=3:2:4:3");
    }
    if look.sharpen {
        filters.push_str(",unsharp=5:5:0.85:5:5:0");
    }
    filters.push_str(match look.effect {
        Effect::None => "",
        Effect::Blur => ",gblur=sigma=4",
        Effect::Vignette => ",vignette=PI/5",
        Effect::Grain => ",noise=alls=10:allf=t+u:all_seed=37",
    });
    filters
}

fn key_expression(
    look: &Look,
    time: &str,
    fallback: i32,
    value: impl Fn(&TransformKey) -> i32,
) -> String {
    let Some(last) = look.keyframes.last() else {
        return fallback.to_string();
    };
    let mut result = value(last).to_string();
    for pair in look.keyframes.windows(2).rev() {
        let (from, to) = (&pair[0], &pair[1]);
        let start = value(from);
        let delta = value(to) - start;
        let progress = format!(
            "clip(({time}-{})/{},0,1)",
            seconds(from.at_ms),
            seconds(to.at_ms - from.at_ms)
        );
        let ease = if to.smooth {
            format!("({progress})*({progress})*(3-2*({progress}))")
        } else {
            progress
        };
        result = format!(
            "if(lt({time},{}),{start}+({delta})*({ease}),{result})",
            seconds(to.at_ms)
        );
    }
    result
}

fn alpha_filters(look: &Look) -> String {
    let mut filters = String::new();
    let key = match look.key_color {
        KeyColor::None => None,
        KeyColor::Green => Some("0x00ff00"),
        KeyColor::Blue => Some("0x0000ff"),
    };
    if let Some(color) = key {
        filters.push_str(&format!(",format=yuva444p,chromakey={color}:0.17:0.08"));
    }
    let opacity_animated = !look.keyframes.is_empty();
    if !opacity_animated {
        filters.push_str(&format!(
            ",format=rgba,colorchannelmixer=aa={:.2}",
            f64::from(look.opacity) / 100.0
        ));
    }
    if look.ellipse || opacity_animated {
        let shape = if look.ellipse {
            "*lte(pow(2*X/W-1,2)+pow(2*Y/H-1,2),1)"
        } else {
            ""
        };
        let opacity = if opacity_animated {
            format!(
                "*({})/100",
                key_expression(look, "T", i32::from(look.opacity), |key| i32::from(
                    key.opacity
                ))
            )
        } else {
            String::new()
        };
        filters.push_str(&format!(",format=yuva444p,geq=lum='lum(X,Y)':cb='cb(X,Y)':cr='cr(X,Y)':a='alpha(X,Y){shape}{opacity}'"));
    }
    if opacity_animated && look.keyframes.iter().any(|key| key.rotate != 0) {
        let angle = key_expression(look, "t", i32::from(look.rotate), |key| {
            i32::from(key.rotate)
        });
        filters.push_str(&format!(",rotate=a='({angle})*PI/180':ow='ceil(hypot(iw,ih)/2)*2':oh='ceil(hypot(iw,ih)/2)*2':c=none"));
    } else if !opacity_animated && look.rotate != 0 {
        let angle = format!("{}*PI/180", look.rotate);
        filters.push_str(&format!(
            ",rotate={angle}:ow=ceil(rotw({angle})/2)*2:oh=ceil(roth({angle})/2)*2:c=none"
        ));
    }
    filters
}

/// Builds the FFmpeg invocation for a snapshot. Video-track gaps render black,
/// audio gaps render silence, and a video clip's own audio is mixed with the audio track.
pub fn plan(
    snapshot: &TimelineSnapshot,
    sources: &HashMap<i64, Source>,
    output: &Path,
) -> Result<Plan> {
    check_version(snapshot)?;
    let total = snapshot.duration_ms();
    let export_duration = snapshot.export_duration_ms()?;
    if export_duration <= 0 {
        return Err(StudioError::Input("Thêm clip vào timeline trước khi xuất."));
    }
    let missing = || StudioError::Input("Media của một clip không còn khả dụng. Hãy quét lại.");
    let (width, height) = frame_size(snapshot, sources);
    let mut inputs = Vec::new();
    let mut graph = vec![format!(
        "color=c=black:s={width}x{height}:r={FPS}:d={},setsar=1[base]",
        seconds(total)
    )];
    let mut audio = vec!["[abase]".to_owned()];
    let mut index = 0;
    let mut video = "[base]".to_owned();
    let (mut visuals, hidden): (Vec<_>, Vec<_>) = snapshot
        .clips("video")
        .into_iter()
        .filter(|clip| !clip.look.disabled)
        .partition(|clip| {
            !snapshot
                .lane("video", clip.layer)
                .is_some_and(|lane| lane.hidden)
        });
    visuals.sort_by_key(|clip| (clip.layer, clip.position_ms));

    let joins: Vec<_> = visuals
        .windows(2)
        .map(|pair| transition_between(pair[0], pair[1]))
        .collect();
    for (visual_index, clip) in visuals.into_iter().enumerate() {
        let source = sources.get(&clip.asset_id).ok_or_else(missing)?;
        if source.kind == "audio" {
            return Err(StudioError::Input("Loại media không khớp với track."));
        }
        push_input(&mut inputs, source, clip);
        let length = seconds(clip.length_ms());
        let at = seconds(clip.position_ms);
        let incoming = visual_index.checked_sub(1).and_then(|index| joins[index]);
        let outgoing = joins.get(visual_index).copied().flatten();
        let hold = match outgoing {
            Some((TransitionKind::Dissolve, ms)) => ms,
            _ => 0,
        };
        let end = seconds(clip.finish_ms() + hold);
        let look = &clip.look;
        let animated = !look.keyframes.is_empty();
        let fit_scale = if animated { 100 } else { u32::from(look.scale) };
        let fit_width = (width * fit_scale / 100).max(2);
        let fit_height = (height * fit_scale / 100).max(2);
        let fade = i64::from(look.fade_ms).min(clip.length_ms() / 2);
        let fades = if fade == 0 {
            String::new()
        } else {
            format!(
                ",fade=t=in:d={}:alpha=1,fade=t=out:st={}:d={}:alpha=1",
                seconds(fade),
                seconds(clip.length_ms() - fade),
                seconds(fade)
            )
        };
        let mut join_colors = String::new();
        let mut join_alpha = String::new();
        if let Some((kind, ms)) = incoming {
            match kind {
                TransitionKind::Black => {
                    join_colors.push_str(&format!(",fade=t=in:d={}:color=black", seconds(ms / 2)))
                }
                TransitionKind::Dissolve => {
                    join_alpha.push_str(&format!(",fade=t=in:d={}:alpha=1", seconds(ms)))
                }
            }
        }
        if let Some((TransitionKind::Black, ms)) = outgoing {
            let half = ms / 2;
            join_colors.push_str(&format!(
                ",fade=t=out:st={}:d={}:color=black",
                seconds(clip.length_ms() - half),
                seconds(half)
            ));
        }
        let hold_tail = if hold == 0 {
            String::new()
        } else {
            format!(",tpad=stop_mode=clone:stop_duration={}", seconds(hold))
        };
        let stabilize = if source.kind == "video" && look.stabilize {
            "deshake=edge=mirror,"
        } else {
            ""
        };
        let flip = if look.flip { "hflip," } else { "" };
        let freeze = if look.freeze_at_ms.is_some() {
            "trim=end_frame=1,"
        } else {
            ""
        };
        let reverse = if look.reverse {
            format!(
                "trim=duration={},setpts=PTS-STARTPTS,reverse,",
                seconds(clip.source_length_ms())
            )
        } else {
            String::new()
        };
        let timing = if look.speed_curve.len() >= 2 {
            format!("setpts='({})/TB',", curve_pts(clip))
        } else if look.speed == 100 {
            String::new()
        } else {
            format!("setpts=(PTS-STARTPTS)*100/{},", look.speed)
        };
        let sampling = if source.kind == "video" && look.optical_flow {
            format!("tpad=stop_mode=clone:stop_duration=0.2,minterpolate=fps={FPS}:mi_mode=mci")
        } else {
            format!("fps={FPS}")
        };
        let grade = grade_filters(look);
        let alpha = alpha_filters(look);
        let animated_scale = if animated {
            let scale =
                key_expression(look, "t", i32::from(look.scale), |key| i32::from(key.scale));
            format!(
                ",scale=w='max(2,trunc(iw*({scale})/200)*2)':h='max(2,trunc(ih*({scale})/200)*2)':eval=frame"
            )
        } else {
            String::new()
        };
        graph.push(format!(
            "[{index}:V:0]{freeze}{stabilize}{flip}scale={fit_width}:{fit_height}:force_original_aspect_ratio=decrease:force_divisible_by=2,\
             setsar=1,{reverse}{timing}{sampling},tpad=stop_mode=clone:stop_duration={length},trim=duration={length},setpts=PTS-STARTPTS,\
             eq=brightness={:.2}:contrast={:.2}:saturation={:.2}{grade}{join_colors}{alpha},format=yuva420p{fades}{join_alpha}{animated_scale}{hold_tail},setsar=1,setpts=PTS+{at}/TB[v{index}]",
            f64::from(look.brightness) / 100.0, f64::from(look.contrast) / 100.0,
            f64::from(look.saturation) / 100.0,
        ));
        let easing = format!("max(0,1-(t-{at})/{})", seconds(clip.length_ms().min(450)));
        let (slide_x, slide_y) = match look.motion {
            Motion::None => (String::new(), String::new()),
            Motion::Slide => (format!("-(W+w)/2*{easing}"), String::new()),
            Motion::SlideRight => (format!("+(W+w)/2*{easing}"), String::new()),
            Motion::Rise => (String::new(), format!("+(H+h)/2*{easing}")),
        };
        let composed = format!("[layer{index}]");
        let (x, y) = (
            key_expression(look, &format!("(t-{at})"), i32::from(look.x), |key| {
                i32::from(key.x)
            }),
            key_expression(look, &format!("(t-{at})"), i32::from(look.y), |key| {
                i32::from(key.y)
            }),
        );
        graph.push(format!(
            "{video}[v{index}]overlay=x='(W-w)/2+W*({x})/100{slide_x}':y='(H-h)/2+H*({y})/100{slide_y}':\
             eof_action=pass:repeatlast=0:enable='gte(t,{at})*lt(t,{end})'{composed}",
        ));
        video = composed;
        if source.kind == "video"
            && source.has_audio
            && !look.audio_detached
            && look.freeze_at_ms.is_none()
            && !snapshot
                .lane("video", clip.layer)
                .is_some_and(|lane| lane.muted)
        {
            graph.push(audio_chain(index, clip));
            audio.push(format!("[a{index}]"));
        }
        index += 1;
    }
    for clip in hidden {
        let source = sources.get(&clip.asset_id).ok_or_else(missing)?;
        if source.kind == "video"
            && source.has_audio
            && !clip.look.audio_detached
            && clip.look.freeze_at_ms.is_none()
            && !snapshot
                .lane("video", clip.layer)
                .is_some_and(|lane| lane.muted)
        {
            push_input(&mut inputs, source, clip);
            graph.push(audio_chain(index, clip));
            audio.push(format!("[a{index}]"));
            index += 1;
        }
    }
    for clip in snapshot.clips("audio") {
        if clip.look.disabled
            || snapshot
                .lane("audio", clip.layer)
                .is_some_and(|lane| lane.muted)
        {
            continue;
        }
        let source = sources.get(&clip.asset_id).ok_or_else(missing)?;
        if !source.has_audio {
            return Err(StudioError::Input(
                "Một clip trên track âm thanh không có luồng âm thanh.",
            ));
        }
        push_input(&mut inputs, source, clip);
        graph.push(audio_chain(index, clip));
        audio.push(format!("[a{index}]"));
        index += 1;
    }

    let mut adjustments: Vec<_> = snapshot.adjustments.iter().collect();
    adjustments.sort_by_key(|layer| layer.layer);
    let mut luts: Vec<i64> = snapshot
        .tracks
        .iter()
        .flat_map(|track| &track.clips)
        .filter(|clip| !clip.look.disabled)
        .filter_map(|clip| clip.look.lut)
        .collect();
    for (index, layer) in adjustments.iter().enumerate() {
        if snapshot
            .lane("text", layer.layer)
            .is_some_and(|lane| lane.hidden)
        {
            continue;
        }
        let filters = adjustment_filters(
            &layer.look,
            layer.position_ms,
            layer.position_ms + layer.duration_ms,
        );
        if filters.is_empty() {
            continue;
        }
        luts.extend(layer.look.lut);
        graph.push(format!("{video}{}[adjust{index}]", &filters[1..]));
        video = format!("[adjust{index}]");
    }
    luts.sort_unstable();
    luts.dedup();
    let mut titles: Vec<_> = snapshot
        .titles
        .iter()
        .filter(|title| {
            !snapshot
                .lane("text", title.layer)
                .is_some_and(|lane| lane.hidden)
        })
        .collect();
    titles.sort_by_key(|title| title.layer);
    for (index, title) in titles.iter().enumerate() {
        let label = format!("[title{index}]");
        let hex = |value: &Option<String>| value.as_deref().map(|hex| format!("0x{}", &hex[1..]));
        let color = hex(&title.color_hex).unwrap_or_else(|| title.color.name().to_owned());
        let default_border = if title.color.name() == "black" && title.color_hex.is_none() {
            "white"
        } else {
            "black"
        };
        let border = hex(&title.stroke_hex).unwrap_or_else(|| default_border.to_owned());
        let border_width = title.stroke_width.unwrap_or(2);
        let mut style = String::new();
        if title.background || title.background_hex.is_some() {
            style.push_str(&format!(
                "box=1:boxcolor={}@{:.2}:boxborderw=8:",
                hex(&title.background_hex).unwrap_or_else(|| "black".to_owned()),
                f64::from(title.background_opacity.unwrap_or(66)) / 100.0
            ));
        }
        if title.shadow {
            style.push_str("shadowcolor=black@0.6:shadowx=3:shadowy=3:");
        }
        if let Some(spacing) = title.line_spacing {
            style.push_str(&format!("line_spacing={spacing}:"));
        }
        style.push_str(match title.align {
            TitleAlign::Left => "text_align=L:",
            TitleAlign::Center => "text_align=C:",
            TitleAlign::Right => "text_align=R:",
        });
        let (start, end) = (title.position_ms, title.position_ms + title.duration_ms);
        if let Some(fade) = title.fade_ms.filter(|ms| *ms > 0) {
            let fade = seconds(i64::from(fade).min(title.duration_ms / 2).max(1));
            style.push_str(&format!(
                "alpha='clip(min((t-{})/{fade},({}-t)/{fade}),0,1)':",
                seconds(start),
                seconds(end)
            ));
        }
        graph.push(format!(
            "{video}drawtext=fontfile=font-{}.ttf:textfile=title-{index}.txt:expansion=none:\
             fontsize=h*{}/100:fontcolor={color}:borderw={border_width}:bordercolor={border}:{style}\
             x=(w-tw)*{}/200:y=(h-th)*{}/200:enable='gte(t,{})*lt(t,{})'{label}",
            title.font.name(),
            title.size,
            title.x + 100,
            title.y + 100,
            seconds(start),
            seconds(end),
        ));
        video = label;
    }
    let mut fonts: Vec<TitleFont> = titles.iter().map(|title| title.font).collect();
    fonts.sort_by_key(|font| font.name());
    fonts.dedup();
    let (video_range, audio_range) = snapshot.export_range.map_or_else(
        || (String::new(), String::new()),
        |range| {
            let (start, end) = (seconds(range.start_ms), seconds(range.end_ms));
            (
                format!("trim=start={start}:end={end},setpts=PTS-STARTPTS,"),
                format!(",atrim=start={start}:end={end},asetpts=PTS-STARTPTS"),
            )
        },
    );
    graph.push(format!("{video}{video_range}format=yuv420p[vout]"));
    graph.push(format!(
        "anullsrc=r=48000:cl=stereo,atrim=duration={}[abase]",
        seconds(total)
    ));
    graph.push(format!(
        "{}amix=inputs={}:duration=first:normalize=0,alimiter=limit=0.95:level=0:latency=1{audio_range}[aout]",
        audio.concat(),
        audio.len()
    ));

    let mut args: Vec<OsString> = [
        "-hide_banner",
        "-loglevel",
        "error",
        "-nostdin",
        "-y",
        "-filter_complex_threads",
        "1",
    ]
    .map(OsString::from)
    .into();
    args.extend(inputs);
    let graph_index = args.len();
    args.push("-filter_complex".into());
    args.push(graph.join(";").into());
    args.extend(
        [
            "-map", "[vout]", "-map", "[aout]", "-c:v", "libx264", "-preset", "veryfast", "-crf",
            "20", "-pix_fmt", "yuv420p", "-c:a", "aac", "-b:a", "192k", "-t",
        ]
        .map(OsString::from),
    );
    args.push(seconds(export_duration).into());
    args.extend(
        [
            "-movflags",
            "+faststart",
            "-progress",
            "pipe:1",
            "-nostats",
            "-f",
            "mp4",
        ]
        .map(OsString::from),
    );
    let command_length = |args: &[OsString]| {
        args.iter().map(|arg| arg.len() + 3).sum::<usize>() + output.as_os_str().len() + 64
    };
    let graph_file = if command_length(&args) > MAX_COMMAND_CHARS {
        args[graph_index] = "-/filter_complex".into();
        Some(std::mem::replace(
            &mut args[graph_index + 1],
            "filters.txt".into(),
        ))
    } else {
        None
    };
    if command_length(&args) > MAX_COMMAND_CHARS {
        return Err(StudioError::Input(
            "Timeline có quá nhiều clip để xuất trong một lượt.",
        ));
    }
    Ok(Plan {
        args,
        duration_ms: export_duration,
        output: output.to_path_buf(),
        titles: titles.into_iter().map(|title| title.text.clone()).collect(),
        graph_file,
        fonts,
        luts: luts.into_iter().map(|id| (id, String::new())).collect(),
    })
}

/// Runs FFmpeg, reports progress in thousandths and stops on cancel or deadline.
/// The video only appears at its final path after a complete render.
pub fn run(
    ffmpeg: &Path,
    plan: &Plan,
    cancel: &AtomicBool,
    mut on_progress: impl FnMut(u16),
) -> Result<Outcome> {
    if cancel.load(Ordering::Relaxed) {
        return Ok(Outcome::Canceled);
    }
    let folder = plan
        .output
        .parent()
        .ok_or(StudioError::Input("Vị trí xuất không hợp lệ."))?;
    let partial = tempfile::Builder::new()
        .prefix(".dtedit-")
        .suffix(".mp4.part")
        .tempfile_in(folder)?
        .into_temp_path();
    let mut cmd = probe::command(ffmpeg);
    let work = if plan.titles.is_empty() && plan.graph_file.is_none() && plan.luts.is_empty() {
        None
    } else {
        let work = tempfile::tempdir()?;
        if let Some(graph) = &plan.graph_file {
            fs::write(work.path().join("filters.txt"), graph.as_encoded_bytes())?;
        }
        for (id, cube) in &plan.luts {
            fs::write(work.path().join(format!("lut-{id}.cube")), cube)?;
        }
        if !plan.titles.is_empty() {
            let find = |font: TitleFont| {
                font.candidates()
                    .into_iter()
                    .filter_map(|candidate| {
                        if candidate.starts_with('/') {
                            Some(PathBuf::from(candidate))
                        } else {
                            std::env::var_os("WINDIR").map(|dir| PathBuf::from(dir).join(candidate))
                        }
                    })
                    .find(|path| path.is_absolute() && path.is_file())
            };
            for font in &plan.fonts {
                // A missing style falls back to the regular sans font.
                let path =
                    find(*font)
                        .or_else(|| find(TitleFont::Sans))
                        .ok_or(StudioError::Input(
                            "Thiếu phông chữ Arial hoặc DejaVu Sans để xuất lớp chữ.",
                        ))?;
                fs::copy(path, work.path().join(format!("font-{}.ttf", font.name())))?;
            }
            for (index, text) in plan.titles.iter().enumerate() {
                fs::write(work.path().join(format!("title-{index}.txt")), text)?;
            }
        }
        cmd.current_dir(work.path());
        Some(work)
    };
    cmd.args(&plan.args).arg(&partial).stderr(Stdio::piped());
    let mut child = cmd.spawn()?;
    let stdout = child.stdout.take().expect("stdout is piped");
    let mut stderr = child.stderr.take().expect("stderr is piped");

    let rendered_ms = Arc::new(AtomicI64::new(0));
    let progress = {
        let rendered_ms = Arc::clone(&rendered_ms);
        thread::spawn(move || {
            for line in BufReader::new(stdout).lines().map_while(|line| line.ok()) {
                if let Some(value) = line.strip_prefix("out_time_us=")
                    && let Ok(micros) = value.trim().parse::<i64>()
                {
                    rendered_ms.store(micros / 1000, Ordering::Relaxed);
                }
            }
        })
    };
    // Drain stderr completely. Keep the first diagnostic and the tail for failures.
    let errors = thread::spawn(move || {
        let mut first = Vec::new();
        let mut tail = Vec::new();
        let mut chunk = [0; 4096];
        while let Ok(read) = stderr.read(&mut chunk) {
            if read == 0 {
                break;
            }
            let retain = read.min((2 * ERROR_TAIL).saturating_sub(first.len()));
            first.extend_from_slice(&chunk[..retain]);
            tail.extend_from_slice(&chunk[..read]);
            if tail.len() > 4 * ERROR_TAIL {
                tail.drain(..tail.len() - 4 * ERROR_TAIL);
            }
        }
        (
            String::from_utf8_lossy(&first).into_owned(),
            String::from_utf8_lossy(&tail).into_owned(),
        )
    });

    let deadline = Instant::now()
        + Duration::from_secs(120)
        + Duration::from_millis(plan.duration_ms as u64 * 40);
    let mut reported = 0;
    let status = loop {
        if let Some(status) = child.wait_timeout(Duration::from_millis(150))? {
            break Some(status);
        }
        if cancel.load(Ordering::Relaxed) || Instant::now() > deadline {
            let _ = child.kill();
            let _ = child.wait();
            break None;
        }
        let value = (rendered_ms.load(Ordering::Relaxed) * 1000 / plan.duration_ms).clamp(0, 999);
        if value as u16 != reported {
            reported = value as u16;
            on_progress(reported);
        }
    };
    let _ = progress.join();
    let (first, tail) = errors.join().unwrap_or_default();
    drop(work);

    match status {
        Some(status) if status.success() && !cancel.load(Ordering::Relaxed) => {
            partial
                .persist_noclobber(&plan.output)
                .map_err(|error| error.error)?;
            Ok(Outcome::Done)
        }
        finished => {
            if cancel.load(Ordering::Relaxed) {
                Ok(Outcome::Canceled)
            } else if finished.is_some() {
                let diagnostic = first
                    .lines()
                    .find(|line| !line.trim().is_empty())
                    .unwrap_or(tail.trim());
                let detail: String = diagnostic.chars().take(ERROR_TAIL).collect();
                Err(StudioError::Message(format!(
                    "FFmpeg không xuất được video. {detail}"
                )))
            } else {
                Err(StudioError::Input(
                    "Xuất video vượt quá thời gian cho phép.",
                ))
            }
        }
    }
}

fn same_file(left: &Path, right: &Path) -> bool {
    if cfg!(windows) {
        left.to_string_lossy()
            .eq_ignore_ascii_case(&right.to_string_lossy())
    } else {
        left == right
    }
}

/// Resolves every asset in the snapshot through its folder grant.
pub fn resolve(
    store: &Store,
    snapshot: &TimelineSnapshot,
    ffprobe: &Path,
) -> Result<HashMap<i64, Source>> {
    let unavailable = StudioError::Input("Media của một clip không còn khả dụng. Hãy quét lại.");
    let mut sources = HashMap::new();
    for clip in snapshot.tracks.iter().flat_map(|track| &track.clips) {
        if sources.contains_key(&clip.asset_id) {
            continue;
        }
        let Some(asset) = store.source(clip.asset_id, false)? else {
            return Err(unavailable);
        };
        let (path, _) = authorized_asset(&asset)?;
        let Some(format) = MediaFormat::for_path(&path) else {
            return Err(unavailable);
        };
        let has_audio = asset.kind != "image" && probe::has_audio(ffprobe, &path, &format);
        sources.insert(
            clip.asset_id,
            Source {
                path,
                format,
                kind: asset.kind,
                has_audio,
                width: asset.width,
                height: asset.height,
            },
        );
    }
    Ok(sources)
}

/// The output must be an MP4 in an existing folder and must not replace a source.
pub fn checked_output(output: &Path, sources: &HashMap<i64, Source>) -> Result<PathBuf> {
    let invalid = StudioError::Input("Vị trí lưu video không hợp lệ. Hãy chọn lại nơi lưu.");
    let (Some(parent), Some(name)) = (output.parent(), output.file_name()) else {
        return Err(invalid);
    };
    let is_mp4 = output
        .extension()
        .is_some_and(|extension| extension.eq_ignore_ascii_case("mp4"));
    if !output.is_absolute() || !is_mp4 || output.is_dir() {
        return Err(invalid);
    }
    let Ok(parent) = dunce::canonicalize(parent) else {
        return Err(invalid);
    };
    let output = parent.join(name);
    if sources
        .values()
        .any(|source| same_file(&source.path, &output))
    {
        return Err(StudioError::Input(
            "Không thể ghi đè lên tệp nguồn đang dùng trong timeline.",
        ));
    }
    if fs::symlink_metadata(&output).is_ok() {
        return Err(StudioError::Input(
            "Tệp xuất đã tồn tại. Hãy chọn tên khác.",
        ));
    }
    Ok(output)
}

/// Renders a queued job. The caller records the final status.
pub fn execute(store: &Store, job_id: i64, cancel: &AtomicBool) -> Result<Outcome> {
    let task = store.render_task(job_id)?;
    if !store.set_render_status(job_id, &["queued"], "running", None)? {
        return Err(StudioError::Input(
            "Lượt xuất video không ở trạng thái chờ.",
        ));
    }
    let tool = |name: &str| probe::find_tool(name).filter(|path| probe::tool_ready(Some(path)));
    let (Some(ffmpeg), Some(ffprobe)) = (tool("ffmpeg"), tool("ffprobe")) else {
        return Err(StudioError::Input(
            "Cần FFmpeg và FFprobe trong PATH để xuất video. Xem Cài đặt.",
        ));
    };
    let sources = resolve(store, &task.snapshot, &ffprobe)?;
    let output = checked_output(Path::new(&task.output_path), &sources)?;
    let mut plan = plan(&task.snapshot, &sources, &output)?;
    for (id, cube) in &mut plan.luts {
        *cube = store.lut(*id)?;
    }
    run(&ffmpeg, &plan, cancel, |progress| {
        let _ = store.set_render_progress(job_id, progress);
    })
}

#[cfg(test)]
mod tests {
    use super::*;
    use crate::timeline::TrackEdit;

    fn source(name: &str, kind: &str, has_audio: bool) -> Source {
        let path = PathBuf::from(if cfg!(windows) { "C:\\media" } else { "/media" }).join(name);
        Source {
            format: MediaFormat::for_path(&path).unwrap(),
            path,
            kind: kind.into(),
            has_audio,
            width: Some(641),
            height: Some(360),
        }
    }

    fn clip(asset_id: i64, start_ms: i64, end_ms: i64, position_ms: i64) -> ClipEdit {
        ClipEdit {
            asset_id,
            start_ms,
            end_ms,
            position_ms,
            layer: 0,
            look: Default::default(),
        }
    }

    #[test]
    fn plans_speed_curves_disabled_clips_and_detached_audio() {
        let sources = HashMap::from([
            (1, source("a.mp4", "video", true)),
            (2, source("b.mp4", "video", true)),
        ]);
        let mut curved = clip(1, 0, 4800, 0);
        curved.look.speed_curve = vec![
            crate::timeline::SpeedPoint { at: 0, speed: 50 },
            crate::timeline::SpeedPoint {
                at: 1000,
                speed: 400,
            },
        ];
        curved.look.audio_detached = true;
        curved.look.audio_link = Some(3);
        let mut sound = clip(1, 0, 4800, 0);
        sound.look.audio_link = Some(3);
        sound.look.speed_curve = curved.look.speed_curve.clone();
        let mut off = clip(2, 0, 1000, curved.length_ms());
        off.look.disabled = true;
        let snapshot = TimelineSnapshot {
            version: 3,
            tracks: vec![
                TrackEdit {
                    kind: "video".into(),
                    clips: vec![curved.clone(), off],
                },
                TrackEdit {
                    kind: "audio".into(),
                    clips: vec![sound],
                },
            ],
            titles: vec![],
            aspect: Aspect::Source,
            lanes: Vec::new(),
            export_range: None,
            adjustments: Vec::new(),
        };
        let output = sources[&1].path.with_file_name("out.mp4");
        let plan = plan(&snapshot, &sources, &output).unwrap();
        assert_eq!(
            plan.duration_ms,
            curved.length_ms() + 1000,
            "a disabled clip keeps its time"
        );
        let args: Vec<_> = plan
            .args
            .iter()
            .map(|arg| arg.to_string_lossy().into_owned())
            .collect();
        let graph = &args[args
            .iter()
            .position(|arg| arg == "-filter_complex")
            .unwrap()
            + 1];
        // Two inputs only: the curved picture and its detached sound. The disabled clip is skipped.
        assert_eq!(args.iter().filter(|arg| *arg == "-i").count(), 2);
        assert!(graph.contains("setpts='(if(lt(T-STARTT,0.200),0.000+(T-STARTT-0.000)*100/57,"));
        assert!(graph.contains("asplit=24[ac1x0]"));
        assert!(graph.contains(
            "[ac1x0]atrim=start=0.000:end=0.200,asetpts=PTS-STARTPTS,atempo=0.5700[ap1x0]"
        ));
        assert!(graph.contains("concat=n=24:v=0:a=1,volume=1.00,adelay=0:all=1[a1]"));
        assert!(
            !graph.contains("[0:a:0]"),
            "detached video keeps its sound off"
        );
        assert!(graph.contains("[abase][a1]amix=inputs=2"));
    }

    #[test]
    fn plans_trims_gaps_stills_and_mixed_audio() {
        let sources = HashMap::from([
            (1, source("a.mp4", "video", true)),
            (2, source("b.png", "image", false)),
            (3, source("c.wav", "audio", true)),
        ]);
        let snapshot = TimelineSnapshot {
            version: 2,
            tracks: vec![
                TrackEdit {
                    kind: "video".into(),
                    clips: vec![clip(2, 0, 2000, 3500), clip(1, 1000, 3500, 500)],
                },
                TrackEdit {
                    kind: "audio".into(),
                    clips: vec![clip(3, 250, 1250, 6000)],
                },
            ],
            titles: vec![],
            aspect: Aspect::Source,
            lanes: Vec::new(),
            export_range: None,
            adjustments: Vec::new(),
        };
        let output = sources[&1].path.with_file_name("out.mp4");
        let plan = plan(&snapshot, &sources, &output).unwrap();
        assert_eq!(plan.duration_ms, 7000);
        assert_eq!(plan.output, output);
        let args: Vec<_> = plan
            .args
            .iter()
            .map(|arg| arg.to_string_lossy().into_owned())
            .collect();
        let joined = args.join(" ");
        // The trimmed video seeks to its in point, the still has no seek.
        assert!(joined.contains("-f mov -ss 1.000 -t 3.000 -i"));
        assert!(joined.contains("-f png_pipe -i"));
        assert!(joined.contains("-f wav -ss 0.250 -t 1.500 -i"));
        let graph = &args[args
            .iter()
            .position(|arg| arg == "-filter_complex")
            .unwrap()
            + 1];
        // Odd source width is rounded down to an even frame.
        assert!(graph.contains("color=c=black:s=640x360:r=30:d=7.000,"));
        assert!(graph.contains("trim=duration=2.500,setpts=PTS-STARTPTS"));
        assert!(graph.contains("tpad=stop_mode=clone:stop_duration=2.000"));
        assert!(graph.contains("[layer0][v1]overlay="));
        assert!(graph.contains(
            "atrim=duration=2.500,asetpts=PTS-STARTPTS,volume=1.00,adelay=500:all=1[a0]"
        ));
        assert!(graph.contains("adelay=6000:all=1[a2]"));
        assert!(graph.contains("atrim=duration=7.000[abase]"));
        assert!(graph.contains("[abase][a0][a2]amix=inputs=3:duration=first:normalize=0"));
        assert!(joined.ends_with("-t 7.000 -movflags +faststart -progress pipe:1 -nostats -f mp4"));

        let mut controls = snapshot;
        controls.lanes = vec![
            crate::timeline::LaneControl {
                track: "video".into(),
                hidden: true,
                ..Default::default()
            },
            crate::timeline::LaneControl {
                track: "audio".into(),
                muted: true,
                ..Default::default()
            },
        ];
        let graph_for = |settings: &TimelineSnapshot| {
            let plan = super::plan(settings, &sources, &output).unwrap();
            let index = plan
                .args
                .iter()
                .position(|arg| arg == "-filter_complex")
                .unwrap();
            plan.args[index + 1].to_string_lossy().into_owned()
        };
        let hidden = graph_for(&controls);
        assert!(!hidden.contains("overlay="));
        assert!(
            hidden.contains("adelay=500:all=1"),
            "hidden video can still be heard"
        );
        assert!(!hidden.contains("adelay=6000:all=1"));
        controls.lanes[0].hidden = false;
        controls.lanes[0].muted = true;
        let muted = graph_for(&controls);
        assert!(muted.contains("overlay="));
        assert!(!muted.contains("adelay="));
    }

    #[test]
    fn rejects_empty_timeline_missing_media_and_source_overwrite() {
        let sources = HashMap::from([(1, source("a.mp4", "video", false))]);
        let output = sources[&1].path.with_file_name("out.mp4");
        let empty = TimelineSnapshot {
            version: 2,
            tracks: Vec::new(),
            titles: vec![],
            aspect: Aspect::Source,
            lanes: Vec::new(),
            export_range: None,
            adjustments: Vec::new(),
        };
        assert!(plan(&empty, &sources, &output).is_err());
        let missing = TimelineSnapshot {
            version: 2,
            tracks: vec![TrackEdit {
                kind: "video".into(),
                clips: vec![clip(9, 0, 1000, 0)],
            }],
            titles: vec![],
            aspect: Aspect::Source,
            lanes: Vec::new(),
            export_range: None,
            adjustments: Vec::new(),
        };
        assert!(plan(&missing, &sources, &output).is_err());

        let dir = tempfile::tempdir().unwrap();
        let folder = dunce::canonicalize(dir.path()).unwrap();
        let used = HashMap::from([(
            1,
            Source {
                path: folder.join("a.mp4"),
                ..source("a.mp4", "video", false)
            },
        )]);
        assert!(checked_output(&folder.join("A.MP4"), &used).is_err() == cfg!(windows));
        assert!(checked_output(&folder.join("a.mp4"), &used).is_err());
        assert!(checked_output(&folder.join("new.mp4"), &used).is_ok());
        assert!(checked_output(&folder.join("new.mov"), &used).is_err());
        assert!(checked_output(&folder.join("missing").join("new.mp4"), &used).is_err());
        assert!(checked_output(Path::new("new.mp4"), &used).is_err());
    }
}
