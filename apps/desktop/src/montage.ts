import type { Aspect, ClipEdit, ClipLook, Shot, TimelineSnapshot } from "./desktop";
import { beatTimes, clipFinish, clipLength, clipLevelAt, layerOf, MIN_CLIP_MS, splitClip, TIMELINE_VERSION, trimEnd } from "./timeline.ts";
import type { Clip } from "./timeline";

export type MontageStyle = "soft" | "dynamic";
export type MontageSource = { clip: Clip; shots: Shot[] };
export type MontageSound = { clip: Clip; levels: number[] };
type Segment = { clip: Clip; startMs: number; endMs: number; score: number; order: number };

const imageLength = 2800;
const maxCuts = 96;

function candidates({ clip, shots }: MontageSource, order: number): Segment[] {
  if (clip.kind === "image") return [{ clip, startMs: 0, endMs: imageLength, score: 310, order }];
  const usable = shots.filter(({ startMs, endMs }) => startMs >= clip.startMs && endMs <= clip.endMs && endMs - startMs >= MIN_CLIP_MS);
  return (usable.length ? usable : [{ startMs: clip.startMs, endMs: clip.endMs, score: 160 }]).map((shot) => ({ ...shot, clip, order }));
}

function soundtrackBeats(sounds: MontageSound[], duration: number) {
  const levels = Array.from({ length: Math.ceil(duration / 50) }, (_, index) => {
    const power = sounds.reduce((sum, { clip, levels }) => {
      const db = clipLevelAt(clip, levels, index * 50);
      return sum + (db === null ? 0 : 10 ** (db / 10));
    }, 0);
    return Math.round(Math.max(0, Math.min(255, (10 * Math.log10(power) + 60) * 255 / 60)));
  });
  return beatTimes(levels).filter((at) => at < duration);
}

function cutBoundaries(sounds: MontageSound[], duration: number, style: MontageStyle, sources: number) {
  const desired = style === "dynamic" ? 1800 : 2800;
  const minimum = Math.min(sources, Math.floor(duration / 1000), maxCuts);
  const beats = soundtrackBeats(sounds, duration);
  const cuts = [0];
  while (cuts.length < maxCuts) {
    const start = cuts[cuts.length - 1];
    const remaining = duration - start;
    const required = Math.max(1, minimum - cuts.length);
    if (cuts.length >= minimum && remaining <= desired + 650) break;
    const latest = duration - required * 1000;
    const ideal = start + Math.min(desired, Math.floor(remaining / (required + 1)));
    const nearby = beats.filter((at) => Math.abs(at - ideal) <= 700 && at - start >= 1000 && at <= latest);
    cuts.push(nearby.reduce((best, at) => Math.abs(at - ideal) < Math.abs(best - ideal) ? at : best, nearby[0] ?? ideal));
  }
  return [...cuts, duration];
}

function editSegment(piece: Segment, duration: number, positionMs: number, previous: ClipEdit | undefined, style: MontageStyle, hasSound: boolean): ClipEdit {
  const startMs = piece.startMs;
  const still = piece.clip.kind === "image";
  const look: Partial<ClipLook> = {};
  if (style === "dynamic") { look.saturation = 110; look.contrast = 104; }
  if (still) look.keyframes = [
    { atMs: 0, x: 0, y: 0, rotate: 0, opacity: 100, scale: 100 },
    { atMs: duration, x: 0, y: 0, rotate: 0, opacity: 100, scale: style === "dynamic" ? 110 : 106, smooth: true },
  ];
  else if (hasSound) look.volume = 0;
  if (previous) look.transition = {
    kind: style === "dynamic" && piece.score < 200 ? "black" : "dissolve",
    durationMs: Math.max(MIN_CLIP_MS, Math.min(style === "dynamic" ? 220 : 480, Math.floor(duration / 3))),
    fromAssetId: previous.assetId, fromStartMs: previous.startMs,
  };
  return { assetId: piece.clip.assetId, startMs, endMs: startMs + duration, positionMs, look };
}

export function montageSnapshot(sources: MontageSource[], aspect: Aspect, requestedMs: number, style: MontageStyle, sounds: MontageSound[] = []): TimelineSnapshot {
  const audioStart = Math.min(...sounds.map(({ clip }) => clip.positionMs));
  const soundtrack = sounds.map(({ clip, levels }) => ({ clip: { ...clip, positionMs: clip.positionMs - audioStart }, levels }));
  const audioLength = Math.max(0, ...soundtrack.map(({ clip }) => clipFinish(clip)));
  const hasSound = soundtrack.length > 0;
  const length = Math.max(MIN_CLIP_MS, Math.min(120_000, Math.round(requestedMs), hasSound ? audioLength : Infinity));
  const groups = sources.map(candidates).filter((group) => group.length);
  const video: ClipEdit[] = [];
  let at = 0;
  function add(piece: Segment, duration: number) {
    video.push(editSegment(piece, duration, at, video[video.length - 1], style, hasSound));
    at += duration;
  }
  if (hasSound && groups.length) {
    const cuts = cutBoundaries(soundtrack, length, style, groups.length);
    let source = 0;
    for (const cut of cuts.slice(1)) {
      while (cut - at >= MIN_CLIP_MS && video.length < maxCuts) {
        const group = groups[source++ % groups.length];
        const wanted = cut - at;
        const best = group.reduce((best, piece) => {
          const value = (item: Segment) => (item.clip.kind === "image" || item.endMs - item.startMs >= wanted ? 2000 : 0) + item.score;
          return value(piece) > value(best) ? piece : best;
        });
        const usable = best.clip.kind === "image" ? wanted : Math.min(wanted, best.endMs - best.startMs);
        if (usable >= MIN_CLIP_MS) add(best, usable);
        else break;
      }
    }
  } else {
    const bestByAsset = new Map<number, Segment>();
    for (const group of groups) {
      for (const shot of group) {
        if ((bestByAsset.get(shot.clip.assetId)?.score ?? -1) < shot.score) bestByAsset.set(shot.clip.assetId, shot);
      }
    }
    const bestPerSource = [...bestByAsset.values()].sort((a, b) => b.score - a.score);
    const picks: { piece: Segment; duration: number }[] = [];
    let remaining = length;
    const chosen = bestPerSource.slice(0, Math.min(maxCuts, Math.floor(length / MIN_CLIP_MS)));
    const minimum = Math.min(1250, Math.floor(length / Math.max(1, chosen.length)));
    for (const piece of chosen) {
      const duration = Math.min(minimum, piece.endMs - piece.startMs);
      picks.push({ piece, duration });
      remaining -= duration;
    }
    for (const pick of picks) {
      const extra = Math.min(remaining, pick.piece.endMs - pick.piece.startMs - pick.duration);
      pick.duration += extra;
      remaining -= extra;
    }
    for (const piece of groups.flat().filter((shot) => !bestPerSource.includes(shot)).sort((a, b) => b.score - a.score)) {
      const duration = Math.min(remaining, piece.endMs - piece.startMs);
      if (duration < MIN_CLIP_MS || picks.length >= maxCuts) continue;
      picks.push({ piece, duration });
      remaining -= duration;
      if (remaining < MIN_CLIP_MS) break;
    }
    picks.sort((a, b) => a.piece.order - b.piece.order || a.piece.startMs - b.piece.startMs).forEach(({ piece, duration }) => add(piece, duration));
  }
  const audio = soundtrack.flatMap(({ clip }) => {
    if (at - clip.positionMs < MIN_CLIP_MS) return [];
    let used = clip;
    if (clipFinish(clip) > at) {
      const [trimmed] = splitClip([clip], clip.key, at) ?? trimEnd([clip], clip.key, at - clipFinish(clip));
      if (!trimmed || clipFinish(trimmed) > at) return [];
      used = trimmed;
    }
    const { audioLink, gainDb, volume, audioFadeInMs, audioFadeOutMs, denoise, speed, speedCurve } = used.look ?? {};
    const edit: ClipEdit = {
      assetId: used.assetId, startMs: used.startMs, endMs: used.endMs, positionMs: used.positionMs, layer: layerOf(used),
      look: { audioLink, gainDb, volume, audioFadeInMs, audioFadeOutMs: Math.min(audioFadeOutMs ?? 300, Math.floor(clipLength(used) / 2)), denoise, speed, speedCurve },
    };
    return [edit];
  });
  return { version: TIMELINE_VERSION, aspect, tracks: [{ kind: "video", clips: video }, { kind: "audio", clips: audio }] };
}
