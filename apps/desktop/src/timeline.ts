import type { Aspect, ClipLook, Cue, EditorTrack, MediaKind, Timeline, TimelineSnapshot, TitleStyle, Track, TransformKey, TransitionKind } from "./desktop";

// Limits mirror src-tauri/src/timeline.rs, which is the authority on save.
export const TIMELINE_VERSION = 3;
export const MAX_LAYERS = 12;
export const MAX_TRACK_CLIPS = 200;
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
export function previousVisual(clips: Clip[], target: Clip) {
  return target.track === "video" ? clips.find((clip) => clip.key !== target.key && sameLane(clip, target)
    && clipFinish(clip) === target.positionMs && clip.available && target.available) : undefined;
}
export function transitionBetween(left: Clip, right: Clip) {
  const transition = right.look?.transition;
  if (!transition || !sameLane(left, right) || !left.available || !right.available || clipFinish(left) !== right.positionMs
    || left.assetId !== transition.fromAssetId || left.startMs !== transition.fromStartMs) return undefined;
  return { kind: transition.kind, durationMs: Math.min(transition.durationMs, clipLength(left), clipLength(right)) };
}
export function setTransition(clips: Clip[], target: Clip, kind: TransitionKind | null, durationMs: number) {
  const previous = previousVisual(clips, target);
  if (kind && !previous) return clips;
  return updateAppearance(clips, { ...target, look: { ...target.look, transition: kind && previous ? {
    kind, durationMs: clamp(Math.round(durationMs), 100, 3000), fromAssetId: previous.assetId, fromStartMs: previous.startMs,
  } : undefined } });
}
export const defaultLook: ClipLook = {
  brightness: 0, contrast: 100, saturation: 100, opacity: 100, scale: 100, x: 0, y: 0, volume: 100, fadeMs: 0, motion: "none",
  speed: 100, rotate: 0, flip: false, temperature: 0, effect: "none", keyColor: "none", ellipse: false,
  denoise: false, sharpen: false, stabilize: false, opticalFlow: false, cleanAudio: false,
};
export const defaultTitle: TitleStyle = { text: "Tiêu đề", size: 7, x: 0, y: 66, color: "white" };
export const captionStyle: TitleStyle = { text: "Nhập phụ đề", size: 5, x: 0, y: 86, color: "white", caption: true, background: true };
export const totalMs = (clips: Clip[]) => clips.reduce((end, clip) => Math.max(end, clipFinish(clip)), 0);
const clamp = (value: number, low: number, high: number) => Math.min(Math.max(value, low), high);
export const transformProperties = ["x", "y", "scale", "rotate", "opacity"] as const;

export function lookAt(clip: Clip, elapsed: number): ClipLook {
  const look = { ...defaultLook, ...clip.look };
  const keys = look.keyframes;
  if (!keys?.length) return look;
  const rightIndex = keys.findIndex((key) => key.atMs >= elapsed);
  const right = keys[rightIndex] ?? keys.at(-1)!;
  const left = rightIndex > 0 ? keys[rightIndex - 1] : right;
  const linear = left === right ? 0 : (elapsed - left.atMs) / (right.atMs - left.atMs);
  const t = right.smooth ? linear * linear * (3 - 2 * linear) : linear;
  for (const property of transformProperties) look[property] = left[property] + (right[property] - left[property]) * t;
  return look;
}

function transformKey(atMs: number, look: ClipLook, smooth = false): TransformKey {
  return { atMs, x: Math.round(look.x), y: Math.round(look.y), scale: Math.round(look.scale),
    rotate: Math.round(look.rotate), opacity: Math.round(look.opacity), smooth };
}

export function setTransformKey(clip: Clip, elapsed: number, look: ClipLook, toggle = false): Clip {
  if (clip.track !== "video" || elapsed < 0 || elapsed > clipLength(clip)) return clip;
  const keys = clip.look?.keyframes ?? [];
  const current = keys.find((key) => key.atMs === elapsed);
  if (!current && keys.length >= 32) throw new Error("Mỗi clip hỗ trợ tối đa 32 keyframe biến đổi.");
  const next = keys.filter((key) => key.atMs !== elapsed);
  if (!toggle || !current) next.push(transformKey(elapsed, look, current?.smooth));
  next.sort((a, b) => a.atMs - b.atMs);
  const base = { ...look, keyframes: next };
  for (const property of transformProperties) base[property] = Math.round(base[property]);
  return { ...clip, look: base };
}

function trimKeys(before: Clip, after: Clip, offset: number): Clip {
  const keys = before.look?.keyframes;
  if (!keys?.length) return after;
  const end = offset + clipLength(after);
  const retained = keys.filter((key) => key.atMs >= offset && key.atMs <= end).map((key) => ({ ...key, atMs: key.atMs - offset }));
  for (const boundary of [offset, end]) {
    if (boundary > keys[0].atMs && boundary < keys.at(-1)!.atMs && !keys.some((key) => key.atMs === boundary)) {
      retained.push(transformKey(boundary - offset, lookAt(before, boundary), keys.find((key) => key.atMs > boundary)?.smooth));
    }
  }
  const look = retained.length ? after.look : lookAt(before, offset);
  return { ...after, look: { ...look, keyframes: retained.sort((a, b) => a.atMs - b.atMs) } };
}

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
  if (clips.filter((clip) => clip.track === track && layerOf(clip) === layer).length >= MAX_TRACK_CLIPS) return null;
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
  if (playbackRate(before) !== playbackRate(clip) && clip.look?.keyframes?.length) {
    const rate = playbackRate(before) / playbackRate(clip);
    const keys = new Map(clip.look.keyframes.map((key) => {
      const atMs = Math.min(clipLength(clip), Math.round(key.atMs * rate));
      return [atMs, { ...key, atMs }];
    }));
    clip = { ...clip, look: { ...clip.look, keyframes: [...keys.values()] } };
  }
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

const mainTrack = (clip: Clip) => clip.track === "video" && layerOf(clip) === 0;

function validPositions(clips: Clip[]) {
  const ends = new Map<string, number>();
  for (const clip of [...clips].sort((a, b) => a.positionMs - b.positionMs)) {
    const lane = `${clip.track}-${layerOf(clip)}`;
    const end = clipFinish(clip);
    if (clip.positionMs < (ends.get(lane) ?? 0) || end > MAX_TIMELINE_MS) return false;
    ends.set(lane, end);
  }
  return true;
}

export function moveSelection(clips: Clip[], keys: ReadonlySet<string>, wantedDelta: number): Clip[] {
  const selected = clips.filter((clip) => keys.has(clip.key));
  if (!selected.length) return clips;
  const delta = clamp(Math.round(wantedDelta), -Math.min(...selected.map((clip) => clip.positionMs)), MAX_TIMELINE_MS - totalMs(selected));
  if (!delta) return clips;
  const next = clips.map((clip) => keys.has(clip.key) ? { ...clip, positionMs: clip.positionMs + delta } : clip);
  return validPositions(next) ? next : clips;
}

function shiftAfter(clips: Clip[], boundary: number, delta: number, linkage: boolean, except: string) {
  return clips.map((clip) => clip.key !== except && clip.positionMs >= boundary && (mainTrack(clip) || linkage)
    ? { ...clip, positionMs: clip.positionMs + delta } : clip);
}

export function trimClip(clips: Clip[], key: string, edge: "start" | "end", delta: number, magnet: boolean, linkage: boolean) {
  const before = clips.find((clip) => clip.key === key);
  const trim = edge === "start" ? trimStart : trimEnd;
  if (!before || !magnet || !mainTrack(before)) return trim(clips, key, delta);
  const after = (edge === "start" ? trimStart([before], key, delta, true) : trimEnd([before], key, delta))[0];
  const durationDelta = clipLength(after) - clipLength(before);
  if (!durationDelta) return clips;
  const changed = clips.map((clip) => clip.key === key ? { ...after, positionMs: before.positionMs } : clip);
  const next = shiftAfter(changed, clipFinish(before), durationDelta, linkage, key);
  return validPositions(next) ? next : clips;
}

export function deleteSelection(clips: Clip[], keys: ReadonlySet<string>, magnet: boolean, linkage: boolean) {
  const deleted = clips.filter((clip) => keys.has(clip.key));
  if (!deleted.length) return clips;
  let next = clips.filter((clip) => !keys.has(clip.key));
  if (magnet) {
    for (const clip of deleted.filter(mainTrack).sort((a, b) => b.positionMs - a.positionMs)) {
      next = shiftAfter(next, clipFinish(clip), -clipLength(clip), linkage, clip.key);
    }
  }
  return validPositions(next) ? next : clips;
}

export const groupOf = (clip: Clip) => clip.title?.editGroup ?? clip.look?.editGroup;

function withGroup(clip: Clip, editGroup?: number): Clip {
  return clip.title ? { ...clip, title: { ...clip.title, editGroup } } : { ...clip, look: { ...clip.look, editGroup } };
}

export function groupSelection(clips: Clip[], keys: ReadonlySet<string>, clear = false) {
  const selected = clips.filter((clip) => keys.has(clip.key));
  if (selected.length < 2 && !clear || !selected.length) return clips;
  const groups = new Set(selected.map(groupOf).filter((id) => id !== undefined));
  const nextGroup = clips.reduce((max, clip) => Math.max(max, groupOf(clip) ?? 0), 0) + 1;
  if (!clear && nextGroup > 0xffffffff) return clips;
  return clips.map((clip) => keys.has(clip.key) || groups.has(groupOf(clip) ?? -1)
    ? withGroup(clip, clear ? undefined : nextGroup) : clip);
}

export function pasteSelection(clips: Clip[], copied: Clip[], at: number): Clip[] {
  if (!copied.length) return clips;
  const earliest = Math.min(...copied.map((clip) => clip.positionMs));
  const wanted = Math.max(0, Math.round(at));
  const shifts = new Set([wanted]);
  for (const item of copied) {
    for (const existing of clips) {
      if (sameLane(item, existing)) shifts.add(clipFinish(existing) - item.positionMs + earliest);
    }
  }
  for (const start of [...shifts].filter((time) => time >= wanted).sort((a, b) => a - b)) {
    if (totalMs(copied) + start - earliest > MAX_TIMELINE_MS) return clips;
    const pasted = copied.map((clip) => ({ ...withGroup(clip), positionMs: clip.positionMs + start - earliest }));
    const next = [...clips, ...pasted];
    if (!validPositions(next)) continue;
    const counts = new Map<string, number>();
    let titles = 0;
    for (const clip of next) {
      const lane = `${clip.track}-${layerOf(clip)}`;
      if (clip.title) {
        if (++titles > MAX_TITLES) return clips;
      } else {
        const count = (counts.get(lane) ?? 0) + 1;
        if (count > MAX_TRACK_CLIPS) return clips;
        counts.set(lane, count);
      }
    }
    return [...clips, ...pasted.map((clip) => ({ ...clip, key: newKey() }))];
  }
  return clips;
}

export function audioFades(clip: Clip) {
  const length = clipLength(clip);
  const legacy = Math.min(clip.look?.fadeMs ?? 0, Math.floor(length / 2));
  const fadeIn = clip.look?.audioFadeInMs ?? legacy;
  const fadeOut = clip.look?.audioFadeOutMs ?? legacy;
  const denominator = Math.max(1, length, fadeIn + fadeOut);
  return [Math.floor(fadeIn * length / denominator), Math.floor(fadeOut * length / denominator)] as const;
}

/** Drags the in point. The out point stays where it is on the timeline. */
export function trimStart(clips: Clip[], key: string, deltaMs: number, ripple = false) {
  return update(clips, key, (clip) => {
    const before = clips.filter((other) => sameLane(other, clip) && other.key !== key
      && clipFinish(other) <= clip.positionMs).reduce((end, other) => Math.max(end, clipFinish(other)), 0);
    const room = ripple ? Infinity : clip.positionMs - before;
    const still = clip.kind === "image" || clip.kind === "text";
    const rate = playbackRate(clip);
    const extend = still ? Math.min(room, MAX_IMAGE_MS - clipLength(clip)) : Math.min(Math.floor(room * rate), clip.startMs);
    const delta = clamp(Math.round(deltaMs * rate), -extend, clip.endMs - clip.startMs - Math.ceil(MIN_CLIP_MS * rate));
    const edited = still ? { ...clip, endMs: clip.endMs - delta } : { ...clip, startMs: clip.startMs + delta };
    return trimKeys(clip, { ...edited, positionMs: clipFinish(clip) - clipLength(edited) }, clipLength(clip) - clipLength(edited));
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
    return trimKeys(clip, { ...clip, endMs: clip.startMs + clamp(clip.endMs - clip.startMs + Math.round(deltaMs * rate), shortest, longest) }, 0);
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
      const tail = trimKeys(clip, right, clipLength(left));
      return clips.flatMap((item) => item.key === key ? [trimKeys(clip, left, 0), {
        ...tail, key: newKey(), ...(tail.look?.transition ? { look: { ...tail.look, transition: undefined } } : {}),
      }] : [item]);
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
