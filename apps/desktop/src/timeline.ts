import type { MediaKind, Timeline, TimelineSnapshot, Track } from "./desktop";

// Limits mirror src-tauri/src/timeline.rs, which is the authority on save.
export const TIMELINE_VERSION = 2;
export const MIN_CLIP_MS = 100;
export const MAX_IMAGE_MS = 600_000;
export const DEFAULT_IMAGE_MS = 3000;
const HISTORY_LIMIT = 100;

/** A clip on the editing surface. `startMs..endMs` is the source range. */
export interface Clip {
  key: string;
  assetId: number;
  relativePath: string;
  kind: MediaKind;
  track: Track;
  startMs: number;
  endMs: number;
  positionMs: number;
  sourceMs: number | null;
  available: boolean;
}

export interface MediaRef {
  assetId: number;
  relativePath: string;
  kind: MediaKind;
  durationMs: number | null;
}

let serial = 0;
const newKey = () => `clip-${++serial}`;

export const clipLength = (clip: Clip) => clip.endMs - clip.startMs;
export const clipFinish = (clip: Clip) => clip.positionMs + clipLength(clip);
export const trackOf = (kind: MediaKind): Track => (kind === "audio" ? "audio" : "video");
export const totalMs = (clips: Clip[]) => clips.reduce((end, clip) => Math.max(end, clipFinish(clip)), 0);
const clamp = (value: number, low: number, high: number) => Math.min(Math.max(value, low), high);

export function fromTimeline(timeline: Timeline): Clip[] {
  return timeline.clips.map((clip) => ({
    key: newKey(), assetId: clip.assetId, relativePath: clip.relativePath, kind: clip.kind, track: clip.track,
    startMs: clip.startMs, endMs: clip.endMs, positionMs: clip.positionMs,
    sourceMs: clip.sourceDurationMs, available: clip.available,
  }));
}

export function toSnapshot(clips: Clip[]): TimelineSnapshot {
  return {
    version: TIMELINE_VERSION,
    tracks: (["video", "audio"] as const).map((kind) => ({
      kind,
      clips: clips.filter((clip) => clip.track === kind).sort((a, b) => a.positionMs - b.positionMs)
        .map(({ assetId, startMs, endMs, positionMs }) => ({ assetId, startMs, endMs, positionMs })),
    })),
  };
}

/** Nearest position on a track where a clip of this length overlaps nothing. */
export function place(clips: Clip[], track: Track, lengthMs: number, wantedMs: number, ignoreKey?: string) {
  const others = clips.filter((clip) => clip.track === track && clip.key !== ignoreKey);
  const free = (at: number) =>
    at >= 0 && others.every((other) => at >= clipFinish(other) || at + lengthMs <= other.positionMs);
  const wanted = Math.max(0, Math.round(wantedMs));
  if (free(wanted)) return wanted;
  // The end of the last clip is always free, so there is always a candidate.
  return others.flatMap((other) => [clipFinish(other), other.positionMs - lengthMs]).filter(free)
    .reduce((best, at) => (Math.abs(at - wanted) < Math.abs(best - wanted) ? at : best));
}

/** Adds media at a position, or at the end of its track. Null when it has no usable length. */
export function addClip(clips: Clip[], media: MediaRef, positionMs?: number): Clip[] | null {
  const lengthMs = media.kind === "image" ? DEFAULT_IMAGE_MS : media.durationMs;
  if (!lengthMs || lengthMs < MIN_CLIP_MS) return null;
  const track = trackOf(media.kind);
  const wanted = positionMs ?? totalMs(clips.filter((clip) => clip.track === track));
  return [...clips, {
    key: newKey(), assetId: media.assetId, relativePath: media.relativePath, kind: media.kind, track,
    startMs: 0, endMs: lengthMs, positionMs: place(clips, track, lengthMs, wanted),
    sourceMs: media.durationMs, available: true,
  }];
}

function update(clips: Clip[], key: string, change: (clip: Clip) => Clip) {
  let changed = false;
  const next = clips.map((clip) => {
    if (clip.key !== key) return clip;
    const edited = change(clip);
    changed ||= edited.startMs !== clip.startMs || edited.endMs !== clip.endMs || edited.positionMs !== clip.positionMs;
    return edited;
  });
  return changed ? next : clips;
}

export function moveClip(clips: Clip[], key: string, wantedMs: number) {
  return update(clips, key, (clip) => ({
    ...clip, positionMs: place(clips, clip.track, clipLength(clip), wantedMs, key),
  }));
}

/** Drags the in point. The out point stays where it is on the timeline. */
export function trimStart(clips: Clip[], key: string, deltaMs: number) {
  return update(clips, key, (clip) => {
    const before = clips.filter((other) => other.track === clip.track && other.key !== key
      && clipFinish(other) <= clip.positionMs).reduce((end, other) => Math.max(end, clipFinish(other)), 0);
    const room = clip.positionMs - before;
    const extend = clip.kind === "image" ? Math.min(room, MAX_IMAGE_MS - clipLength(clip)) : Math.min(room, clip.startMs);
    const delta = clamp(Math.round(deltaMs), -extend, clipLength(clip) - MIN_CLIP_MS);
    return clip.kind === "image"
      ? { ...clip, endMs: clip.endMs - delta, positionMs: clip.positionMs + delta }
      : { ...clip, startMs: clip.startMs + delta, positionMs: clip.positionMs + delta };
  });
}

/** Drags the out point up to the source end or the next clip. */
export function trimEnd(clips: Clip[], key: string, deltaMs: number) {
  return update(clips, key, (clip) => {
    const next = clips.filter((other) => other.track === clip.track && other.key !== key
      && other.positionMs >= clipFinish(clip)).reduce((start, other) => Math.min(start, other.positionMs), Infinity);
    const source = clip.kind === "image" ? MAX_IMAGE_MS : (clip.sourceMs ?? clip.endMs) - clip.startMs;
    const longest = Math.max(MIN_CLIP_MS, Math.min(next - clip.positionMs, source));
    return { ...clip, endMs: clip.startMs + clamp(clipLength(clip) + Math.round(deltaMs), MIN_CLIP_MS, longest) };
  });
}

/** Cuts a clip in two at a timeline time. Null when a piece would be too short. */
export function splitClip(clips: Clip[], key: string, atMs: number): Clip[] | null {
  const clip = clips.find((item) => item.key === key);
  if (!clip) return null;
  const offset = Math.round(atMs) - clip.positionMs;
  if (offset < MIN_CLIP_MS || clipLength(clip) - offset < MIN_CLIP_MS) return null;
  const left = { ...clip, endMs: clip.startMs + offset };
  const right = clip.kind === "image"
    ? { ...clip, key: newKey(), endMs: clip.endMs - offset, positionMs: clip.positionMs + offset }
    : { ...clip, key: newKey(), startMs: clip.startMs + offset, positionMs: clip.positionMs + offset };
  return clips.flatMap((item) => (item.key === key ? [left, right] : [item]));
}

export const removeClip = (clips: Clip[], key: string) => clips.filter((clip) => clip.key !== key);

export function clipsAt(clips: Clip[], ms: number) {
  return clips.filter((clip) => ms >= clip.positionMs && ms < clipFinish(clip));
}

/** Pulls a time onto a nearby edge so clips butt together without a gap. */
export function snap(valueMs: number, points: number[], toleranceMs: number) {
  const nearest = points.reduce((best, point) => (Math.abs(point - valueMs) < Math.abs(best - valueMs) ? point : best), Infinity);
  return Math.abs(nearest - valueMs) <= toleranceMs ? nearest : valueMs;
}

export interface History {
  past: Clip[][];
  present: Clip[];
  future: Clip[][];
}

export const newHistory = (present: Clip[] = []): History => ({ past: [], present, future: [] });

export function commit(history: History, next: Clip[]): History {
  if (next === history.present) return history;
  return { past: [...history.past, history.present].slice(-HISTORY_LIMIT), present: next, future: [] };
}

export function undo(history: History): History {
  const previous = history.past.at(-1);
  if (!previous) return history;
  return { past: history.past.slice(0, -1), present: previous, future: [history.present, ...history.future] };
}

export function redo(history: History): History {
  const [next, ...future] = history.future;
  if (!next) return history;
  return { past: [...history.past, history.present], present: next, future };
}
