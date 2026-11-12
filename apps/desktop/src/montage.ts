import type { Aspect, ClipEdit, ClipLook, Shot, TimelineSnapshot } from "./desktop";
import { beatTimes, clipFinish, clipLength, clipLevelAt, layerOf, MIN_CLIP_MS, splitClip, TIMELINE_VERSION, trimEnd } from "./timeline.ts";
import type { Clip } from "./timeline";

export type MontageStyle = "soft" | "dynamic";
export type MontageSource = { clip: Clip; shots: Shot[] };
export type MontageSound = { clip: Clip; levels: number[] };
type Segment = { clip: Clip; startMs: number; endMs: number; score: number; order: number; peakMs?: number };
type Pick = { piece: Segment; startMs: number; duration: number };

const imageLength = 2800;
/** Cut limit when the user caps the highlight length. */
const limitedCuts = 96;
/** Safety limit for automatic highlights and long soundtracks. */
const autoCuts = 600;
/** Longest requested highlight, in milliseconds. */
export const MAX_REQUESTED_MS = 600_000;

function candidates({ clip, shots }: MontageSource, order: number): Segment[] {
  if (clip.kind === "image") return [{ clip, startMs: 0, endMs: imageLength, score: 310, order }];
  const usable = shots.filter(({ startMs, endMs }) => startMs >= clip.startMs && endMs <= clip.endMs && endMs - startMs >= MIN_CLIP_MS);
  return (usable.length ? usable : [{ startMs: clip.startMs, endMs: clip.endMs, score: 160 }]).map((shot) => ({ ...shot, clip, order }));
}

/** Places a window of `duration` inside the segment, leading slightly into its peak moment. */
function around(piece: Segment, duration: number) {
  if (piece.clip.kind === "image") return 0;
  const peak = piece.peakMs ?? piece.startMs + (piece.endMs - piece.startMs) / 2;
  return Math.round(Math.max(piece.startMs, Math.min(piece.endMs - duration, peak - duration * 0.4)));
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

function cutBoundaries(sounds: MontageSound[], duration: number, style: MontageStyle, sources: number, maxCuts: number) {
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

function editSegment({ piece, startMs, duration }: Pick, positionMs: number, previous: ClipEdit | undefined, style: MontageStyle, hasSound: boolean): ClipEdit {
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

/**
 * Highlights without a length limit: every window that stands out within the
 * footage (top third and at least 60% of the best score), plus each source's
 * best window. Neighbouring chosen windows of one clip stay one continuous
 * piece; single windows are trimmed around their peak moment.
 */
function automaticPicks(groups: Segment[][], style: MontageStyle): Pick[] {
  const scores = groups.flat().map(({ score }) => score).sort((a, b) => a - b);
  const best = scores[scores.length - 1] ?? 0;
  const threshold = Math.max(scores[Math.floor(scores.length * 0.67)] ?? 0, best * 0.6);
  const target = style === "dynamic" ? 2500 : 4000;
  const picks: Pick[] = [];
  for (const group of groups) {
    const top = group.reduce((a, b) => b.score > a.score ? b : a);
    const chosen = [...group].sort((a, b) => a.startMs - b.startMs).filter((piece) => piece === top || piece.score >= threshold);
    const runs: Segment[][] = [];
    for (const piece of chosen) {
      const run = runs[runs.length - 1];
      if (run && Math.abs(run[run.length - 1].endMs - piece.startMs) <= 1) run.push(piece);
      else runs.push([piece]);
    }
    for (const run of runs) {
      const first = run[0];
      if (first.clip.kind === "image") {
        picks.push({ piece: first, startMs: 0, duration: style === "dynamic" ? 2000 : imageLength });
        continue;
      }
      const peak = run.reduce((a, b) => b.score > a.score ? b : a);
      const merged: Segment = { ...peak, startMs: first.startMs, endMs: run[run.length - 1].endMs };
      const duration = Math.min(merged.endMs - merged.startMs, run.length > 1 ? Math.round(target * 2.5) : target);
      if (duration >= MIN_CLIP_MS) picks.push({ piece: merged, startMs: around(merged, duration), duration });
    }
  }
  return picks.sort((a, b) => b.piece.score - a.piece.score).slice(0, autoCuts)
    .sort((a, b) => a.piece.order - b.piece.order || a.startMs - b.startMs);
}

/** Highlights that fit a user-chosen length, keeping every source represented first. */
function limitedPicks(groups: Segment[][], length: number): Pick[] {
  const bestByAsset = new Map<number, Segment>();
  for (const group of groups) {
    for (const shot of group) {
      if ((bestByAsset.get(shot.clip.assetId)?.score ?? -1) < shot.score) bestByAsset.set(shot.clip.assetId, shot);
    }
  }
  const bestPerSource = [...bestByAsset.values()].sort((a, b) => b.score - a.score);
  const picks: { piece: Segment; duration: number }[] = [];
  let remaining = length;
  const chosen = bestPerSource.slice(0, Math.min(limitedCuts, Math.floor(length / MIN_CLIP_MS)));
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
    if (duration < MIN_CLIP_MS || picks.length >= limitedCuts) continue;
    picks.push({ piece, duration });
    remaining -= duration;
    if (remaining < MIN_CLIP_MS) break;
  }
  return picks.map(({ piece, duration }) => ({ piece, duration, startMs: piece.startMs }))
    .sort((a, b) => a.piece.order - b.piece.order || a.startMs - b.startMs);
}

/**
 * Builds a new timeline from analysed footage.
 * - With soundtrack clips the result is exactly as long as the soundtrack and cuts follow its beats.
 * - Without sound, `requestedMs` caps the length; `null` keeps every standout moment (no cap).
 */
export function montageSnapshot(sources: MontageSource[], aspect: Aspect, requestedMs: number | null, style: MontageStyle, sounds: MontageSound[] = []): TimelineSnapshot {
  const audioStart = Math.min(...sounds.map(({ clip }) => clip.positionMs));
  const soundtrack = sounds.map(({ clip, levels }) => ({ clip: { ...clip, positionMs: clip.positionMs - audioStart }, levels }));
  const audioLength = Math.max(0, ...soundtrack.map(({ clip }) => clipFinish(clip)));
  const hasSound = soundtrack.length > 0;
  const groups = sources.map(candidates).filter((group) => group.length);
  const video: ClipEdit[] = [];
  let at = 0;
  function add(pick: Pick) {
    video.push(editSegment(pick, at, video[video.length - 1], style, hasSound));
    at += pick.duration;
  }
  if (hasSound && groups.length) {
    const length = Math.max(MIN_CLIP_MS, audioLength);
    const maxCuts = Math.min(autoCuts, Math.max(limitedCuts, Math.ceil(length / 1000) + groups.length));
    const cuts = cutBoundaries(soundtrack, length, style, groups.length, maxCuts);
    // Each reuse costs a piece its lead, so long soundtracks walk through all footage before repeating.
    const usage = new Map<Segment, number>();
    let source = 0;
    for (const cut of cuts.slice(1)) {
      while (cut - at >= MIN_CLIP_MS && video.length < maxCuts) {
        const group = groups[source++ % groups.length];
        const wanted = cut - at;
        const value = (item: Segment) => (item.clip.kind === "image" || item.endMs - item.startMs >= wanted ? 2000 : 0)
          + item.score - 1200 * (usage.get(item) ?? 0);
        const best = group.reduce((best, piece) => value(piece) > value(best) ? piece : best);
        const used = usage.get(best) ?? 0;
        usage.set(best, used + 1);
        const span = best.endMs - best.startMs;
        const duration = best.clip.kind === "image" ? wanted : Math.min(wanted, span);
        if (duration < MIN_CLIP_MS) break;
        const startMs = best.clip.kind === "image" ? 0
          : used === 0 ? around(best, duration) : best.startMs + (used * duration) % (span - duration + 1);
        add({ piece: best, startMs, duration });
      }
    }
  } else if (requestedMs === null) {
    automaticPicks(groups, style).forEach(add);
  } else {
    limitedPicks(groups, Math.max(MIN_CLIP_MS, Math.min(MAX_REQUESTED_MS, Math.round(requestedMs)))).forEach(add);
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
