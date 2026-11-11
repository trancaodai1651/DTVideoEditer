import type { Aspect, ClipLook, Cue, EditorTrack, MediaKind, Timeline, TimelineSnapshot, TitleStyle, Track } from "./desktop";

// Limits mirror src-tauri/src/timeline.rs, which is the authority on save.
export const TIMELINE_VERSION = 3;
export const MAX_LAYERS = 12;
export const MAX_TITLES = 300;
export const MIN_CLIP_MS = 100;
export const MAX_IMAGE_MS = 600_000;
export const MAX_TIMELINE_MS = 21_600_000;
export const DEFAULT_IMAGE_MS = 3000;
const HISTORY_LIMIT = 100;

/** A clip on the editing surface. `startMs..endMs` is the source range. */
export interface Clip {
  key: string;
  assetId: number;
  relativePath: string;
  kind: MediaKind | "text";
  track: EditorTrack;
  startMs: number;
  endMs: number;
  positionMs: number;
  sourceMs: number | null;
  available: boolean;
  layer?: number;
  look?: Partial<ClipLook>;
  title?: TitleStyle;
  width?: number | null;
  height?: number | null;
  hasThumbnail?: boolean;
}

export interface MediaRef {
  assetId: number;
  relativePath: string;
  kind: MediaKind;
  durationMs: number | null;
  width?: number | null;
  height?: number | null;
  hasThumbnail?: boolean;
}

let serial = 0;
const newKey = () => `clip-${++serial}`;

export const playbackRate = (clip: Clip) => (clip.look?.speed ?? 100) / 100;
export const clipLength = (clip: Clip) => {
  const speed = clip.look?.speed ?? 100;
  return Math.floor(((clip.endMs - clip.startMs) * 100 + speed / 2) / speed);
};
export const clipFinish = (clip: Clip) => clip.positionMs + clipLength(clip);
export const trackOf = (kind: MediaKind): Track => (kind === "audio" ? "audio" : "video");
export const layerOf = (clip: Clip) => clip.layer ?? 0;
export const sameLane = (left: Clip, right: Clip) => left.track === right.track && layerOf(left) === layerOf(right);
export const defaultLook: ClipLook = {
  brightness: 0, contrast: 100, saturation: 100, opacity: 100, scale: 100, x: 0, y: 0, volume: 100, fadeMs: 0, motion: "none",
  speed: 100, rotate: 0, flip: false, temperature: 0, effect: "none", keyColor: "none", ellipse: false,
  denoise: false, sharpen: false, stabilize: false, opticalFlow: false, cleanAudio: false,
};
export const defaultTitle: TitleStyle = { text: "Tiêu đề", size: 7, x: 0, y: 66, color: "white" };
export const captionStyle: TitleStyle = { text: "Nhập phụ đề", size: 5, x: 0, y: 86, color: "white", caption: true, background: true };
export const totalMs = (clips: Clip[]) => clips.reduce((end, clip) => Math.max(end, clipFinish(clip)), 0);
const clamp = (value: number, low: number, high: number) => Math.min(Math.max(value, low), high);

export function fromTimeline(timeline: Timeline): Clip[] {
  const media: Clip[] = timeline.clips.map((clip) => ({
    key: newKey(), assetId: clip.assetId, relativePath: clip.relativePath, kind: clip.kind, track: clip.track,
    startMs: clip.startMs, endMs: clip.endMs, positionMs: clip.positionMs,
    sourceMs: clip.sourceDurationMs, available: clip.available, layer: clip.layer, look: clip.look,
    width: clip.width, height: clip.height, hasThumbnail: clip.hasThumbnail,
  }));
  const titles: Clip[] = (timeline.titles ?? []).map(({ positionMs, durationMs, layer, ...title }) => ({
    key: newKey(), assetId: 0, relativePath: title.text, kind: "text", track: "text",
    startMs: 0, endMs: durationMs, positionMs, sourceMs: null, available: true, layer, title,
  }));
  return [...media, ...titles];
}

export function toSnapshot(clips: Clip[], aspect: Aspect = "source"): TimelineSnapshot {
  const titles = clips.filter((clip) => clip.title).map((clip) => ({
    ...clip.title!, positionMs: clip.positionMs, durationMs: clipLength(clip), layer: layerOf(clip),
  }));
  return {
    version: TIMELINE_VERSION,
    ...(aspect !== "source" ? { aspect } : {}),
    ...(titles.length ? { titles } : {}),
    tracks: (["video", "audio"] as const).map((kind) => ({
      kind,
      clips: clips.filter((clip) => clip.track === kind).sort((a, b) => a.positionMs - b.positionMs)
        .map(({ assetId, startMs, endMs, positionMs, layer, look }) => ({
          assetId, startMs, endMs, positionMs, ...(layer ? { layer } : {}), ...(look ? { look } : {}),
        })),
    })),
  };
}

/** Nearest position on a track where a clip of this length overlaps nothing. */
export function place(clips: Clip[], track: EditorTrack, lengthMs: number, wantedMs: number, ignoreKey?: string, layer = 0) {
  const others = clips.filter((clip) => clip.track === track && layerOf(clip) === layer && clip.key !== ignoreKey);
  const free = (at: number) =>
    at >= 0 && others.every((other) => at >= clipFinish(other) || at + lengthMs <= other.positionMs);
  const wanted = Math.max(0, Math.round(wantedMs));
  if (free(wanted)) return wanted;
  // The end of the last clip is always free, so there is always a candidate.
  return others.flatMap((other) => [clipFinish(other), other.positionMs - lengthMs]).filter(free)
    .reduce((best, at) => (Math.abs(at - wanted) < Math.abs(best - wanted) ? at : best));
}

export const mediaLength = (media: MediaRef) => media.kind === "image" ? DEFAULT_IMAGE_MS : media.durationMs;

/** Adds media at a position, or at the end of its track. Null when it has no usable length. */
export function addClip(clips: Clip[], media: MediaRef, positionMs?: number, layer = 0): Clip[] | null {
  const lengthMs = mediaLength(media);
  if (!lengthMs || lengthMs < MIN_CLIP_MS) return null;
  const track = trackOf(media.kind);
  const wanted = positionMs ?? totalMs(clips.filter((clip) => clip.track === track && layerOf(clip) === layer));
  const position = place(clips, track, lengthMs, wanted, undefined, layer);
  if (position + lengthMs > MAX_TIMELINE_MS) return null;
  return [...clips, {
    key: newKey(), assetId: media.assetId, relativePath: media.relativePath, kind: media.kind, track,
    startMs: 0, endMs: lengthMs, positionMs: position,
    sourceMs: media.durationMs, available: true, ...(layer ? { layer } : {}),
    width: media.width, height: media.height, hasThumbnail: media.hasThumbnail,
  }];
}

export function addTitle(clips: Clip[], wantedMs: number, layer: number, title = defaultTitle): Clip[] {
  if (clips.filter((clip) => clip.kind === "text").length >= MAX_TITLES) return clips;
  const length = title.caption ? 2200 : 3000;
  return [...clips, {
    key: newKey(), assetId: 0, relativePath: title.text, kind: "text", track: "text", layer,
    startMs: 0, endMs: length, positionMs: place(clips, "text", length, wantedMs, undefined, layer),
    sourceMs: null, available: true, title,
  }];
}

export function addCaptions(clips: Clip[], cues: Cue[], offset: number): Clip[] {
  if (clips.filter((clip) => clip.kind === "text").length + cues.length > MAX_TITLES) {
    throw new Error("Timeline hỗ trợ tối đa 300 lớp chữ và câu phụ đề.");
  }
  const updated = [...clips];
  for (const cue of cues) {
    const positionMs = cue.startMs + offset;
    const end = cue.endMs + offset;
    if (positionMs < 0 || end > MAX_TIMELINE_MS || end - positionMs < MIN_CLIP_MS) {
      throw new Error("Một câu phụ đề nằm ngoài thời lượng timeline.");
    }
    const layer = Array.from({ length: MAX_LAYERS }, (_, index) => index).find((index) =>
      updated.every((clip) => clip.track !== "text" || layerOf(clip) !== index || clipFinish(clip) <= positionMs || clip.positionMs >= end));
    if (layer === undefined) throw new Error("Có quá nhiều câu phụ đề chồng thời gian.");
    updated.push({
      key: newKey(), assetId: 0, relativePath: cue.text, kind: "text", track: "text", layer,
      startMs: 0, endMs: cue.endMs - cue.startMs, positionMs, sourceMs: null, available: true,
      title: { ...captionStyle, text: cue.text },
    });
  }
  return updated;
}

export function subtitleCues(clips: Clip[]): Cue[] {
  return clips.filter((clip) => clip.title?.caption).map((clip) => ({
    startMs: clip.positionMs, endMs: clipFinish(clip), text: clip.title!.text,
  }));
}

export function updateAppearance(clips: Clip[], clip: Clip): Clip[] {
  const before = clips.find((item) => item.key === clip.key);
  if (!before) return clips;
  const changedLength = clipLength(before) !== clipLength(clip);
  if (clipLength(clip) < MIN_CLIP_MS) throw new Error("Tốc độ này làm clip ngắn hơn 100 ms.");
  const positionMs = changedLength
    ? place(clips, clip.track, clipLength(clip), clip.positionMs, clip.key, layerOf(clip)) : clip.positionMs;
  return clips.map((item) => item.key === clip.key ? { ...clip, positionMs } : item);
}

export function offsetVisual(clip: Clip, x: number, y: number): Clip {
  const look = { ...defaultLook, ...clip.look };
  const position = (value: number) => clamp(Math.round(value), -100, 100);
  if (clip.title) {
    const title = { ...clip.title, x: position(clip.title.x + x), y: position(clip.title.y + y) };
    return title.x === clip.title.x && title.y === clip.title.y ? clip : { ...clip, title };
  }
  const next = { ...look, x: position(look.x + x), y: position(look.y + y) };
  return next.x === look.x && next.y === look.y ? clip : { ...clip, look: next };
}

export function changeLayer(clips: Clip[], key: string, layer: number): Clip[] {
  const clip = clips.find((item) => item.key === key);
  return clip ? moveClip(clips, key, clip.positionMs, layer) : clips;
}

function update(clips: Clip[], key: string, change: (clip: Clip) => Clip) {
  let changed = false;
  const next = clips.map((clip) => {
    if (clip.key !== key) return clip;
    const edited = change(clip);
    changed ||= edited.startMs !== clip.startMs || edited.endMs !== clip.endMs
      || edited.positionMs !== clip.positionMs || layerOf(edited) !== layerOf(clip);
    return edited;
  });
  return changed ? next : clips;
}

export function moveClip(clips: Clip[], key: string, wantedMs: number, layer?: number) {
  if (layer !== undefined && (!Number.isInteger(layer) || layer < 0 || layer >= MAX_LAYERS)) return clips;
  return update(clips, key, (clip) => {
    const targetLayer = layer ?? layerOf(clip);
    const length = clipLength(clip);
    const positionMs = place(clips, clip.track, length, Math.min(wantedMs, MAX_TIMELINE_MS - length), key, targetLayer);
    return positionMs + length > MAX_TIMELINE_MS ? clip : { ...clip, layer: targetLayer, positionMs };
  });
}

/** Drags the in point. The out point stays where it is on the timeline. */
export function trimStart(clips: Clip[], key: string, deltaMs: number) {
  return update(clips, key, (clip) => {
    const before = clips.filter((other) => sameLane(other, clip) && other.key !== key
      && clipFinish(other) <= clip.positionMs).reduce((end, other) => Math.max(end, clipFinish(other)), 0);
    const room = clip.positionMs - before;
    const still = clip.kind === "image" || clip.kind === "text";
    const rate = playbackRate(clip);
    const extend = still ? Math.min(room, MAX_IMAGE_MS - clipLength(clip)) : Math.min(Math.floor(room * rate), clip.startMs);
    const delta = clamp(Math.round(deltaMs * rate), -extend, clip.endMs - clip.startMs - Math.ceil(MIN_CLIP_MS * rate));
    const edited = still ? { ...clip, endMs: clip.endMs - delta } : { ...clip, startMs: clip.startMs + delta };
    return { ...edited, positionMs: clipFinish(clip) - clipLength(edited) };
  });
}

/** Drags the out point up to the source end or the next clip. */
export function trimEnd(clips: Clip[], key: string, deltaMs: number) {
  return update(clips, key, (clip) => {
    const next = clips.filter((other) => sameLane(other, clip) && other.key !== key
      && other.positionMs >= clipFinish(clip)).reduce((start, other) => Math.min(start, other.positionMs), MAX_TIMELINE_MS);
    const source = clip.kind === "image" || clip.kind === "text" ? MAX_IMAGE_MS : (clip.sourceMs ?? clip.endMs) - clip.startMs;
    const rate = playbackRate(clip);
    const shortest = Math.ceil(MIN_CLIP_MS * rate);
    const longest = Math.max(shortest, Math.min(Math.floor((next - clip.positionMs) * rate), source));
    return { ...clip, endMs: clip.startMs + clamp(clip.endMs - clip.startMs + Math.round(deltaMs * rate), shortest, longest) };
  });
}

/** Cuts a clip in two at a timeline time. Null when a piece would be too short. */
export function canSplit(clip: Clip, atMs: number) {
  const offset = Math.round(atMs) - clip.positionMs;
  return offset >= MIN_CLIP_MS && clipLength(clip) - offset >= MIN_CLIP_MS;
}

export function splitClip(clips: Clip[], key: string, atMs: number): Clip[] | null {
  const clip = clips.find((item) => item.key === key);
  if (!clip) return null;
  const offset = Math.round(atMs) - clip.positionMs;
  if (!canSplit(clip, atMs)) return null;
  const ideal = Math.round(offset * playbackRate(clip));
  for (const delta of [0, -1, 1, -2, 2]) {
    const sourceOffset = ideal + delta;
    const left = { ...clip, endMs: clip.startMs + sourceOffset };
    const right = clip.kind === "image" || clip.kind === "text"
      ? { ...clip, endMs: clip.endMs - sourceOffset, positionMs: clipFinish(left) }
      : { ...clip, startMs: clip.startMs + sourceOffset, positionMs: clipFinish(left) };
    if (clipLength(left) >= MIN_CLIP_MS && clipLength(right) >= MIN_CLIP_MS && clipFinish(right) === clipFinish(clip)) {
      return clips.flatMap((item) => (item.key === key ? [left, { ...right, key: newKey() }] : [item]));
    }
  }
  return null;
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
