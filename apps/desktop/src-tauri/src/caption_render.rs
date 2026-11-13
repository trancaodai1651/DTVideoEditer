use std::fmt::Write as _;

use crate::timeline::{CaptionMotion, CaptionWord, TitleAlign, TitleEdit, TitleFont};

pub fn script(width: u32, height: u32) -> String {
    format!(
        "[Script Info]\nScriptType: v4.00+\nPlayResX: {width}\nPlayResY: {height}\nScaledBorderAndShadow: yes\nWrapStyle: 0\n\n\
         [V4+ Styles]\nFormat: Name,Fontname,Fontsize,PrimaryColour,SecondaryColour,OutlineColour,BackColour,Bold,Italic,Underline,StrikeOut,ScaleX,ScaleY,Spacing,Angle,BorderStyle,Outline,Shadow,Alignment,MarginL,MarginR,MarginV,Encoding\n\
         Style: Caption,Arial,24,&H00FFFFFF,&H00FFFFFF,&H00000000,&H66000000,0,0,0,0,100,100,0,0,1,2,0,2,0,0,0,1\n\n\
         [Events]\nFormat: Layer,Start,End,Style,Name,MarginL,MarginR,MarginV,Effect,Text\n"
    )
}

fn timestamp(ms: i64) -> String {
    let cs = (ms + 5) / 10;
    format!(
        "{}:{:02}:{:02}.{:02}",
        cs / 360_000,
        cs / 6_000 % 60,
        cs / 100 % 60,
        cs % 100
    )
}

fn color(hex: &str) -> String {
    format!("&H{}{}{}&", &hex[5..7], &hex[3..5], &hex[1..3])
}

fn text(out: &mut String, value: &str) {
    for character in value.chars() {
        match character {
            '\n' => out.push_str(r"\N"),
            '{' => out.push_str(r"\{"),
            '}' => out.push_str(r"\}"),
            '\\' => out.push_str("\\\u{200b}"),
            _ => out.push(character),
        }
    }
}

fn transition(out: &mut String, ms: i64, tag: &str) {
    if ms == 0 {
        out.push_str(tag);
    } else {
        write!(out, r"\t({},{ms},{tag})", ms - 1).unwrap();
    }
}

pub fn dialogue(out: &mut String, title: &TitleEdit, width: u32, height: u32, layer: usize) {
    let (start, end) = (title.position_ms, title.position_ms + title.duration_ms);
    let x = f64::from(width) * f64::from(title.x + 100) / 200.;
    let y = f64::from(height) * f64::from(title.y + 100) / 200.;
    let col = match title.align {
        TitleAlign::Left => 1,
        TitleAlign::Center => 2,
        TitleAlign::Right => 3,
    };
    let row = if title.y >= 35 {
        0
    } else if title.y <= -35 {
        6
    } else {
        3
    };
    let font = match title.font {
        TitleFont::Sans | TitleFont::Bold => "Arial",
        TitleFont::Serif => "Times New Roman",
        TitleFont::Mono => "Courier New",
        TitleFont::Display => "Impact",
    };
    let base = color(
        title
            .color_hex
            .as_deref()
            .unwrap_or(match title.color.name() {
                "black" => "#000000",
                "yellow" => "#ffd400",
                "cyan" => "#00ffff",
                _ => "#ffffff",
            }),
    );
    let border = color(title.stroke_hex.as_deref().unwrap_or(
        if title.color.name() == "black" && title.color_hex.is_none() {
            "#ffffff"
        } else {
            "#000000"
        },
    ));
    let highlight = color(title.highlight_hex.as_deref().unwrap_or("#ffe34d"));
    let size = (height as f64 * f64::from(title.size) / 100.).round() as u32;
    let margin = width / 25;
    write!(
        out,
        r"Dialogue: {layer},{},{},Caption,,{margin},{margin},0,,{{\an{}\pos({x:.2},{y:.2})\fn{font}\fs{size}\b{}\bord{}\shad{}\1c{base}\3c{border}",
        timestamp(start), timestamp(end), row + col, u8::from(title.font == TitleFont::Bold),
        title.stroke_width.unwrap_or(2), if title.shadow { 3 } else { 0 },
    ).unwrap();
    if let Some(fade) = title.fade_ms.filter(|ms| *ms > 0) {
        let fade = i64::from(fade).min(title.duration_ms / 2);
        write!(out, r"\fad({fade},{fade})").unwrap();
    }
    out.push('}');

    let count = title.text.split_whitespace().count() as i64;
    let mut index = 0;
    for token in title.text.split_inclusive(char::is_whitespace) {
        let word_text = token.trim_end_matches(char::is_whitespace);
        if !word_text.is_empty() {
            let word = title
                .words
                .get(index as usize)
                .copied()
                .unwrap_or(CaptionWord {
                    start_ms: title.duration_ms * index / count,
                    end_ms: title.duration_ms * (index + 1) / count,
                });
            out.push('{');
            write!(out, r"\1c{base}").unwrap();
            if title.caption_motion == CaptionMotion::Reveal {
                out.push_str(r"\alpha&HFF&");
                transition(out, word.start_ms, r"\alpha&H00&");
            }
            if word.end_ms > word.start_ms {
                transition(out, word.start_ms, &format!(r"\1c{highlight}"));
                transition(out, word.end_ms, &format!(r"\1c{base}"));
            }
            out.push('}');
            index += 1;
        }
        text(out, token);
    }
    out.push('\n');
}
