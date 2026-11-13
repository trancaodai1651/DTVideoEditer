import type { Aspect, CaptionMotion, ClipLook, Cue, EditorTrack, LaneControl, MediaKind, SpeedPoint, Timeline, TimelineSnapshot, TitleStyle, TrackPoint, Track, TransformKey, TransitionKind, ColorWheel } from "./desktop";

// Limits mirror src-tauri/src/timeline.rs, which is the authority on save.
export const TIMELINE_VERSION = 3;
export const MAX_LAYERS = 12;
export const MAX_TRACK_CLIPS = 200;
export const MAX_TITLES = 1800;
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
  kind: MediaKind | "text" | "adjustment";
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

export interface MediaDropTarget {
  positionMs: number;
  videoLayer: number;
  audioLayer: number;
  toleranceMs: number;
  playheadMs: number;
}

let serial = 0;
const newKey = () => `clip-${++serial}`;

export const playbackRate = (clip: Clip) => (clip.look?.speed ?? 100) / 100;
/** Clips whose source range is a duration rather than a span of media. */
export const isStill = (clip: Clip) => clip.kind === "image" || clip.kind === "text" || clip.kind === "adjustment" || clip.look?.freezeAtMs !== undefined;
export const clipLength = (clip: Clip): number => {
  const span = clip.endMs - clip.startMs;
  if ((clip.look?.speedCurve?.length ?? 0) >= 2) {
    return curveSegments(span, clip.look!.speedCurve!).reduce((total, [start, end, speed]) => total + scaledMs(end - start, speed), 0);
  }
  return scaledMs(span, clip.look?.speed ?? 100);
};
export const clipFinish = (clip: Clip) => clip.positionMs + clipLength(clip);
export const trackOf = (kind: MediaKind): Track => (kind === "audio" ? "audio" : "video");
export const layerOf = (clip: Clip) => clip.layer ?? 0;
export const sameLane = (left: Clip, right: Clip) => left.track === right.track && layerOf(left) === layerOf(right);
export const laneControl = (lanes: LaneControl[], track: EditorTrack, layer: number) => lanes.find((lane) => lane.track === track && lane.layer === layer);
export const clipLane = (lanes: LaneControl[], clip: Clip) => laneControl(lanes, clip.track, layerOf(clip));

export function changesLockedLane(before: Clip[], after: Clip[], lanes: LaneControl[]) {
  if (!lanes.some((lane) => lane.locked) || before === after) return false;
  const from = new Set(before);
  const to = new Set(after);
  return before.some((clip) => !to.has(clip) && clipLane(lanes, clip)?.locked)
    || after.some((clip) => !from.has(clip) && clipLane(lanes, clip)?.locked);
}
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
export const captionMotions: Record<CaptionMotion, string> = { static: "Tĩnh", highlight: "Tô sáng từng từ", reveal: "Hiện dần từng từ" };
export const captionHighlight = "#ffe34d";

export function captionWords(title: TitleStyle, length: number) {
  if (title.words?.length) return title.words;
  const count = title.text.trim().split(/\s+/u).length;
  return Array.from({ length: count }, (_, index) => ({
    startMs: Math.floor(length * index / count),
    endMs: Math.floor(length * (index + 1) / count),
  }));
}

export function withCaptionText(title: TitleStyle, text: string): TitleStyle {
  const words = title.words?.length === text.trim().split(/\s+/u).length ? title.words : undefined;
  return { ...title, text, words };
}

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
  if (before.title?.words?.length && after.title) {
    const length = clipLength(after);
    after = { ...after, title: { ...after.title, words: before.title.words.map((word) => ({
      startMs: clamp(word.startMs - offset, 0, length),
      endMs: clamp(word.endMs - offset, 0, length),
    })) } };
  }
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
  const adjustments: Clip[] = (timeline.adjustments ?? []).map(({ positionMs, durationMs, layer, look }) => ({
    key: newKey(), assetId: 0, relativePath: ADJUSTMENT_NAME, kind: "adjustment", track: "text",
    startMs: 0, endMs: durationMs, positionMs, sourceMs: null, available: true, layer, look,
  }));
  return [...media, ...titles, ...adjustments];
}

export const ADJUSTMENT_NAME = "Lớp điều chỉnh";

export function toSnapshot(clips: Clip[], aspect: Aspect = "source", lanes: LaneControl[] = []): TimelineSnapshot {
  const titles = clips.filter((clip) => clip.title).map((clip) => ({
    ...clip.title!, positionMs: clip.positionMs, durationMs: clipLength(clip), layer: layerOf(clip),
  }));
  const adjustments = clips.filter((clip) => clip.kind === "adjustment").map((clip) => ({
    positionMs: clip.positionMs, durationMs: clipLength(clip), layer: layerOf(clip), look: clip.look ?? {},
  }));
  return {
    version: TIMELINE_VERSION,
    ...(aspect !== "source" ? { aspect } : {}),
    ...(lanes.length ? { lanes } : {}),
    ...(titles.length ? { titles } : {}),
    ...(adjustments.length ? { adjustments } : {}),
    tracks: (["video", "audio"] as const).map((kind) => ({
      kind,
      clips: clips.filter((clip) => clip.track === kind && clip.kind !== "adjustment").sort((a, b) => a.positionMs - b.positionMs)
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

export function mediaDropPlacement(clips: Clip[], media: MediaRef, target: MediaDropTarget, lanes: LaneControl[] = []) {
  const length = mediaLength(media);
  if (!length || length < MIN_CLIP_MS) return null;
  const track = trackOf(media.kind);
  const layer = track === "video" ? target.videoLayer : target.audioLayer;
  if (laneControl(lanes, track, layer)?.locked) return null;
  const row = clips.filter((clip) => clip.track === track && layerOf(clip) === layer);
  if (row.length >= MAX_TRACK_CLIPS) return null;
  const edges = [0, target.playheadMs, ...row.flatMap((clip) => [clip.positionMs, clipFinish(clip)])];
  let position = Math.min(target.positionMs, MAX_TIMELINE_MS - length);
  if (target.toleranceMs > 0) {
    const head = snap(position, edges, target.toleranceMs);
    position = head === position ? snap(position + length, edges, target.toleranceMs) - length : head;
  }
  const at = place(row, track, length, position, undefined, layer);
  return at + length <= MAX_TIMELINE_MS ? { track, layer, at, length } : null;
}

export function addDroppedMedia(clips: Clip[], files: MediaRef[], target: MediaDropTarget, lanes: LaneControl[] = []): Clip[] {
  const cursor = { video: undefined as number | undefined, audio: undefined as number | undefined };
  return files.reduce((next, media) => {
    const track = trackOf(media.kind);
    const at = cursor[track];
    const placement = mediaDropPlacement(next, media, at === undefined ? target : { ...target, positionMs: at, toleranceMs: 0 }, lanes);
    if (!placement || (at !== undefined && placement.at < at)) return next;
    const added = addClip(next, media, placement.at, placement.layer);
    if (!added) return next;
    cursor[track] = clipFinish(added[added.length - 1]);
    return added;
  }, clips);
}

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

export function addCaptions(clips: Clip[], cues: Cue[], offset: number, motion: CaptionMotion = "static"): Clip[] {
  if (clips.filter((clip) => clip.kind === "text").length + cues.length > MAX_TITLES) {
    throw new Error(`Timeline hỗ trợ tối đa ${MAX_TITLES} lớp chữ và câu phụ đề.`);
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
      title: {
        ...captionStyle, text: cue.text, words: cue.words, captionMotion: motion,
        ...(motion === "static" ? {} : { background: false, font: "bold", strokeWidth: 3, y: 68 }),
      },
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
  if (!changedLength) return clips.map((item) => item.key === clip.key ? clip : item);
  // A speed change pushes or pulls the clips after it on the same lane, like a ripple edit.
  const delta = clipLength(clip) - clipLength(before);
  const edited = clip;
  const next = clips.map((item) => item.key === edited.key ? edited
    : sameLane(item, before) && item.positionMs >= clipFinish(before) ? { ...item, positionMs: item.positionMs + delta } : item);
  if (validPositions(next)) return next;
  const positionMs = place(clips, clip.track, clipLength(clip), clip.positionMs, clip.key, layerOf(clip));
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
    const still = isStill(clip);
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
    const source = isStill(clip) ? MAX_IMAGE_MS : (clip.sourceMs ?? clip.endMs) - clip.startMs;
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
  const curved = hasCurve(clip);
  const ideal = Math.round(curved ? sourcePosition(clip, offset).offset : offset * playbackRate(clip));
  for (const delta of curved ? [0] : [0, -1, 1, -2, 2]) {
    const sourceOffset = ideal + delta;
    const fraction = Math.round(sourceOffset * 1000 / (clip.endMs - clip.startMs));
    if (curved && (fraction <= 0 || fraction >= 1000)) return null;
    const curves = curved ? [curvePart(clip.look!.speedCurve!, 0, fraction), curvePart(clip.look!.speedCurve!, fraction, 1000)] : undefined;
    const leftBase = curves ? { ...clip, look: { ...clip.look, speedCurve: curves[0] } } : clip;
    const rightBase = curves ? { ...clip, look: { ...clip.look, speedCurve: curves[1] } } : clip;
    const left = { ...leftBase, endMs: clip.startMs + sourceOffset };
    const right = isStill(clip)
      ? { ...rightBase, endMs: clip.endMs - sourceOffset, positionMs: clipFinish(left) }
      : { ...rightBase, startMs: clip.startMs + sourceOffset, positionMs: clipFinish(left) };
    if (clipLength(left) >= MIN_CLIP_MS && clipLength(right) >= MIN_CLIP_MS && (curved || clipFinish(right) === clipFinish(clip))) {
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

// ---------------------------------------------------------------------------
// Speed curves. Integer maths mirrors `curve_segments` in timeline.rs exactly.

export const CURVE_SEGMENTS = 24;
export const MIN_SPEED = 10;
export const MAX_SPEED = 1000;

export const speedCurvePresets: { id: string; label: string; points: SpeedPoint[] }[] = [
  { id: "montage", label: "Dồn nhịp", points: [{ at: 0, speed: 100 }, { at: 250, speed: 300 }, { at: 500, speed: 60 }, { at: 750, speed: 300 }, { at: 1000, speed: 100 }] },
  { id: "hero", label: "Khoảnh khắc chậm", points: [{ at: 0, speed: 200 }, { at: 400, speed: 200 }, { at: 500, speed: 30 }, { at: 600, speed: 200 }, { at: 1000, speed: 200 }] },
  { id: "bullet", label: "Viên đạn", points: [{ at: 0, speed: 300 }, { at: 450, speed: 20 }, { at: 550, speed: 20 }, { at: 1000, speed: 300 }] },
  { id: "jump", label: "Nhảy nhịp", points: [{ at: 0, speed: 100 }, { at: 300, speed: 500 }, { at: 600, speed: 100 }, { at: 1000, speed: 500 }] },
  { id: "flash-in", label: "Lướt vào", points: [{ at: 0, speed: 600 }, { at: 400, speed: 100 }, { at: 1000, speed: 100 }] },
  { id: "flash-out", label: "Lướt ra", points: [{ at: 0, speed: 100 }, { at: 600, speed: 100 }, { at: 1000, speed: 600 }] },
];

function curveSpeed(points: SpeedPoint[], at: number) {
  let previous = points[0];
  for (const point of points.slice(1)) {
    if (at <= point.at) {
      return previous.speed + Math.trunc((point.speed - previous.speed) * (at - previous.at) / Math.max(1, point.at - previous.at));
    }
    previous = point;
  }
  return previous.speed;
}

/** `[source start, source end, speed %]` relative to the in point. */
export function curveSegments(sourceMs: number, points: SpeedPoint[]): [number, number, number][] {
  return Array.from({ length: CURVE_SEGMENTS }, (_, index) => [
    Math.trunc(sourceMs * index / CURVE_SEGMENTS),
    Math.trunc(sourceMs * (index + 1) / CURVE_SEGMENTS),
    Math.max(1, curveSpeed(points, Math.trunc((2 * index + 1) * 1000 / (2 * CURVE_SEGMENTS)))),
  ]);
}

export const scaledMs = (sourceMs: number, speed: number) => Math.floor((sourceMs * 100 + Math.trunc(speed / 2)) / speed);
export const hasCurve = (clip: Clip) => (clip.look?.speedCurve?.length ?? 0) >= 2;

export function validCurve(points: SpeedPoint[]) {
  return points.length >= 2 && points.length <= 10 && points[0].at === 0 && points.at(-1)!.at === 1000
    && points.every((point, index) => point.speed >= MIN_SPEED && point.speed <= MAX_SPEED
      && Number.isInteger(point.at) && Number.isInteger(point.speed) && (index === 0 || point.at > points[index - 1].at));
}

/** Source offset (ms after the in point) and playback rate at a time inside the clip. */
export function sourcePosition(clip: Clip, elapsed: number): { offset: number; rate: number } {
  const span = clip.endMs - clip.startMs;
  if (!hasCurve(clip)) {
    const rate = playbackRate(clip);
    return { offset: Math.min(span, Math.max(0, elapsed * rate)), rate };
  }
  let output = 0;
  const segments = curveSegments(span, clip.look!.speedCurve!);
  for (const [start, end, speed] of segments) {
    const length = scaledMs(end - start, speed);
    if (elapsed < output + length) return { offset: start + Math.max(0, elapsed - output) * speed / 100, rate: speed / 100 };
    output += length;
  }
  return { offset: span, rate: segments.at(-1)![2] / 100 };
}

function curvePart(points: SpeedPoint[], from: number, to: number): SpeedPoint[] {
  const inside = points.filter((point) => point.at > from && point.at < to);
  const scale = (at: number) => Math.round((at - from) * 1000 / (to - from));
  const result = [{ at: 0, speed: curveSpeed(points, from) },
    ...inside.map((point) => ({ at: scale(point.at), speed: point.speed })),
    { at: 1000, speed: curveSpeed(points, to) }];
  return result.filter((point, index) => index === 0 || point.at > result[index - 1].at).slice(0, 10);
}

/** Applies a curve, or a constant speed when `points` is empty. Keeps the in point. */
export function setSpeed(clips: Clip[], key: string, speed: number, points: SpeedPoint[] = []): Clip[] {
  const clip = clips.find((item) => item.key === key);
  if (!clip || clip.track === "text" || clip.kind === "image") return clips;
  if (points.length && !validCurve(points)) throw new Error("Đường cong tốc độ cần 2 đến 10 điểm, tốc độ 0,1× đến 10×.");
  const speedValue = points.length ? 100 : Math.min(MAX_SPEED, Math.max(MIN_SPEED, Math.round(speed)));
  const edited = { ...clip, look: { ...clip.look, speed: speedValue, speedCurve: points.length ? points : undefined, keyframes: undefined } };
  return updateAppearance(clips, edited);
}

// ---------------------------------------------------------------------------
// Detach and restore audio.

const nextId = (clips: Clip[], read: (clip: Clip) => number | undefined) =>
  clips.reduce((max, clip) => Math.max(max, read(clip) ?? 0), 0) + 1;

export const canDetachAudio = (clip: Clip) => clip.track === "video" && clip.kind === "video" && clip.available && !clip.look?.audioDetached;

/** Moves a video clip's sound to the nearest free audio layer at the same time. */
export function detachAudio(clips: Clip[], key: string): Clip[] {
  const clip = clips.find((item) => item.key === key);
  if (!clip || !canDetachAudio(clip)) return clips;
  const link = nextId(clips, (item) => item.look?.audioLink);
  const look = clip.look ?? {};
  for (let layer = 0; layer < MAX_LAYERS; layer += 1) {
    const sound: Clip = {
      ...clip, key: newKey(), track: "audio", layer, hasThumbnail: false,
      look: {
        ...(look.speed && look.speed !== 100 ? { speed: look.speed } : {}),
        ...(look.speedCurve ? { speedCurve: look.speedCurve } : {}),
        ...(look.volume !== undefined ? { volume: look.volume } : {}),
        ...(look.gainDb !== undefined ? { gainDb: look.gainDb } : {}),
        ...(look.audioFadeInMs !== undefined ? { audioFadeInMs: look.audioFadeInMs } : {}),
        ...(look.audioFadeOutMs !== undefined ? { audioFadeOutMs: look.audioFadeOutMs } : {}),
        ...(look.cleanAudio ? { cleanAudio: true } : {}),
        audioLink: link,
      },
    };
    const next = [...clips.map((item) => item.key === key ? { ...item, look: { ...item.look, audioDetached: true, audioLink: link } } : item), sound];
    if (validPositions(next) && next.filter((item) => item.track === "audio" && layerOf(item) === layer).length <= MAX_TRACK_CLIPS) return next;
  }
  throw new Error("Không còn tầng âm thanh trống ở vị trí của clip.");
}

/** Removes every audio clip detached from the clip's link and turns the sound back on. */
export function restoreAudio(clips: Clip[], key: string): Clip[] {
  const link = clips.find((item) => item.key === key)?.look?.audioLink;
  if (link === undefined) return clips;
  return clips.filter((clip) => !(clip.track === "audio" && clip.look?.audioLink === link)).map((clip) =>
    clip.look?.audioLink === link ? { ...clip, look: { ...clip.look, audioLink: undefined, audioDetached: undefined } } : clip);
}

// ---------------------------------------------------------------------------
// Enable / disable, compound and multicam.

export function setDisabled(clips: Clip[], keys: ReadonlySet<string>, disabled: boolean): Clip[] {
  return clips.map((clip) => keys.has(clip.key) && !clip.title
    ? { ...clip, look: { ...clip.look, disabled: disabled || undefined } } : clip);
}

export const compoundOf = (clip: Clip) => clip.look?.compound;

/** Gathers media clips under one named block. Text stays outside. */
export function createCompound(clips: Clip[], keys: ReadonlySet<string>, name: string): Clip[] {
  const members = clips.filter((clip) => keys.has(clip.key) && !clip.title);
  const label = name.trim().slice(0, 60);
  if (members.length < 2 || !label) return clips;
  const old = new Set(members.map((clip) => compoundOf(clip)?.id).filter((id) => id !== undefined));
  const compound = { id: nextId(clips, (clip) => compoundOf(clip)?.id), name: label };
  return clips.map((clip) => keys.has(clip.key) && !clip.title || old.has(compoundOf(clip)?.id ?? -1)
    ? { ...clip, look: { ...clip.look, compound } } : clip);
}

export function releaseCompound(clips: Clip[], id: number): Clip[] {
  return clips.map((clip) => compoundOf(clip)?.id === id ? { ...clip, look: { ...clip.look, compound: undefined } } : clip);
}

export function renameCompound(clips: Clip[], id: number, name: string): Clip[] {
  const label = name.trim().slice(0, 60);
  if (!label) return clips;
  return clips.map((clip) => compoundOf(clip)?.id === id ? { ...clip, look: { ...clip.look, compound: { id, name: label } } } : clip);
}

export interface CompoundBlock { id: number; name: string; keys: string[]; start: number; end: number; track: EditorTrack; layer: number }

/** One block per compound, drawn on its lowest visual lane (or audio if it has no picture). */
export function compoundBlocks(clips: Clip[]): CompoundBlock[] {
  const blocks = new Map<number, CompoundBlock>();
  const rank = (track: EditorTrack, layer: number) => (track === "video" ? 0 : 100) + layer;
  for (const clip of clips) {
    const compound = compoundOf(clip);
    if (!compound) continue;
    const block = blocks.get(compound.id);
    if (!block) {
      blocks.set(compound.id, { id: compound.id, name: compound.name, keys: [clip.key], start: clip.positionMs, end: clipFinish(clip), track: clip.track, layer: layerOf(clip) });
    } else {
      block.keys.push(clip.key);
      block.start = Math.min(block.start, clip.positionMs);
      block.end = Math.max(block.end, clipFinish(clip));
      if (rank(clip.track, layerOf(clip)) < rank(block.track, block.layer)) { block.track = clip.track; block.layer = layerOf(clip); }
    }
  }
  return [...blocks.values()];
}

/** Lines up camera angles on separate video layers and shows the lowest one. */
export function createMulticam(clips: Clip[], keys: ReadonlySet<string>, keepPositions = false): Clip[] {
  const angles = clips.filter((clip) => keys.has(clip.key) && clip.track === "video" && clip.kind === "video")
    .sort((a, b) => layerOf(a) - layerOf(b));
  if (angles.length < 2 || angles.length > 9) throw new Error("Chọn 2 đến 9 clip video làm các góc máy.");
  if (new Set(angles.map(layerOf)).size !== angles.length) throw new Error("Mỗi góc máy cần nằm trên một tầng video riêng.");
  const id = nextId(clips, (clip) => clip.look?.multicam);
  const start = Math.min(...angles.map((clip) => clip.positionMs));
  const lowest = layerOf(angles[0]);
  const next = clips.map((clip) => angles.includes(clip)
    ? { ...clip, positionMs: keepPositions ? clip.positionMs : start, look: { ...clip.look, multicam: id, disabled: layerOf(clip) === lowest ? undefined : true } } : clip);
  if (!validPositions(next)) throw new Error("Không đồng bộ được: một góc máy sẽ chồng lên clip khác trên tầng của nó.");
  return next;
}

export const multicamAngles = (clips: Clip[], id: number) =>
  [...new Set(clips.filter((clip) => clip.look?.multicam === id).map(layerOf))].sort((a, b) => a - b);

/** Cuts to one angle from `atMs` until the next existing switch. */
export function switchAngle(clips: Clip[], id: number, angle: number, atMs: number): Clip[] {
  const layer = multicamAngles(clips, id)[angle];
  if (layer === undefined) return clips;
  let next = clips;
  for (const clip of clips.filter((item) => item.look?.multicam === id && atMs > item.positionMs && atMs < clipFinish(item))) {
    next = splitClip(next, clip.key, atMs) ?? next;
  }
  const members = next.filter((clip) => clip.look?.multicam === id);
  const boundary = Math.min(...members.map((clip) => clip.positionMs).filter((at) => at > atMs + 1), Infinity);
  return next.map((clip) => clip.look?.multicam === id && clip.positionMs >= atMs - 1 && clip.positionMs < boundary
    ? { ...clip, look: { ...clip.look, disabled: layerOf(clip) === layer ? undefined : true } } : clip);
}

export function releaseMulticam(clips: Clip[], id: number): Clip[] {
  return clips.map((clip) => clip.look?.multicam === id ? { ...clip, look: { ...clip.look, multicam: undefined } } : clip);
}

// ---------------------------------------------------------------------------
// Smart tools fed by local analysis.

function elapsedAtSource(clip: Clip, offset: number) {
  if (!hasCurve(clip)) return offset / playbackRate(clip);
  let low = 0;
  let high = clipLength(clip);
  for (let step = 0; step < 30; step += 1) {
    const middle = (low + high) / 2;
    if (sourcePosition(clip, middle).offset < offset) low = middle; else high = middle;
  }
  return high;
}

/** Splits a clip at source times reported by scene detection. */
export function splitAtSourceTimes(clips: Clip[], key: string, sourceTimes: number[]): Clip[] {
  let next = clips;
  let current = key;
  for (const time of [...sourceTimes].sort((a, b) => a - b)) {
    const clip = next.find((item) => item.key === current);
    if (!clip || time <= clip.startMs || time >= clip.endMs) continue;
    const split = splitClip(next, current, clip.positionMs + Math.round(elapsedAtSource(clip, time - clip.startMs)));
    if (!split) continue;
    current = split[split.findIndex((item) => item.key === current) + 1].key;
    next = split;
  }
  return next;
}

const LEVEL_MS = 50;
export const levelDb = (level: number) => level * 60 / 255 - 60;

/** Quiet stretches of at least `minMs` in source time, from 50 ms loudness levels. */
export function silentRanges(levels: number[], thresholdDb: number, minMs: number): [number, number][] {
  const ranges: [number, number][] = [];
  let start = -1;
  levels.forEach((level, index) => {
    const quiet = levelDb(level) < thresholdDb;
    if (quiet && start < 0) start = index;
    if ((!quiet || index === levels.length - 1) && start >= 0) {
      const end = quiet ? index + 1 : index;
      if ((end - start) * LEVEL_MS >= minMs) ranges.push([start * LEVEL_MS, end * LEVEL_MS]);
      start = -1;
    }
  });
  return ranges;
}

/** Cuts the quiet parts out of a clip and closes the gaps on its lane. */
export function removeSilences(clips: Clip[], key: string, levels: number[], thresholdDb = -42, minMs = 600, padMs = 120): Clip[] {
  const clip = clips.find((item) => item.key === key);
  if (!clip || clip.track === "text" || hasCurve(clip)) return clips;
  const quiet = silentRanges(levels, thresholdDb, minMs)
    .map(([start, end]) => [Math.max(clip.startMs, start + padMs), Math.min(clip.endMs, end - padMs)] as const)
    .filter(([start, end]) => end - start >= MIN_CLIP_MS);
  if (!quiet.length) return clips;
  const keep: [number, number][] = [];
  let cursor = clip.startMs;
  for (const [start, end] of quiet) {
    if (start - cursor >= MIN_CLIP_MS) keep.push([cursor, start]);
    cursor = Math.max(cursor, end);
  }
  if (clip.endMs - cursor >= MIN_CLIP_MS) keep.push([cursor, clip.endMs]);
  if (!keep.length) return clips;
  let position = clip.positionMs;
  const pieces = keep.map(([startMs, endMs]) => {
    const piece = { ...clip, key: newKey(), startMs, endMs, positionMs: position, look: { ...clip.look, keyframes: undefined, transition: undefined } };
    position += clipLength(piece);
    return piece;
  });
  const removed = clipFinish(clip) - position;
  const after = (item: Clip) => sameLane(item, clip) && item.positionMs >= clipFinish(clip);
  return [...clips.filter((item) => item.key !== key).map((item) => after(item) ? { ...item, positionMs: item.positionMs - removed } : item), ...pieces];
}

/** Onsets where loudness jumps above the recent average, at least 250 ms apart. */
export function beatTimes(levels: number[]): number[] {
  const energy = levels.map((level) => 10 ** (levelDb(level) / 10));
  const beats: number[] = [];
  for (let index = 1; index < energy.length; index += 1) {
    const window = energy.slice(Math.max(0, index - 20), index);
    const average = window.reduce((sum, value) => sum + value, 0) / window.length;
    const at = index * LEVEL_MS;
    if (levelDb(levels[index]) > -36 && energy[index] > average * 1.8 && energy[index] > energy[index - 1]
      && (!beats.length || at - beats.at(-1)! >= 250)) beats.push(at);
  }
  return beats;
}

/** Timeline times of beats inside a clip's visible range. */
export function clipBeatMarkers(clip: Clip, levels: number[]) {
  return beatTimes(levels).filter((at) => at >= clip.startMs && at < clip.endMs)
    .map((at) => clip.positionMs + Math.round(elapsedAtSource(clip, at - clip.startMs)))
    .filter((at) => at < clipFinish(clip));
}

/** Loudness in dBFS at a timeline time for one clip, or null when it is silent there. */
export function clipLevelAt(clip: Clip, levels: number[], atMs: number): number | null {
  if (atMs < clip.positionMs || atMs >= clipFinish(clip)) return null;
  const index = Math.floor((clip.startMs + sourcePosition(clip, atMs - clip.positionMs).offset) / LEVEL_MS);
  const level = levels[index];
  if (level === undefined) return null;
  const [fadeIn, fadeOut] = audioFades(clip);
  const elapsed = atMs - clip.positionMs;
  const fade = Math.min(1, fadeIn ? elapsed / fadeIn : 1, fadeOut ? (clipLength(clip) - elapsed) / fadeOut : 1);
  const gain = clip.look?.gainDb ?? 20 * Math.log10(Math.max(0.001, (clip.look?.volume ?? 100) / 100));
  return levelDb(level) + gain + 20 * Math.log10(Math.max(0.001, fade));
}

/**
 * Turns tracking points from a source clip into position keyframes on a target
 * overlay, so it follows the object. At most 32 keys, evenly spread.
 */
export function followTrack(clips: Clip[], sourceKey: string, targetKey: string, points: TrackPoint[]): Clip[] {
  const source = clips.find((clip) => clip.key === sourceKey);
  const target = clips.find((clip) => clip.key === targetKey);
  if (!source || !target || target.track !== "video" || target.key === source.key || !points.length) return clips;
  const timed = points.map((point) => ({
    at: Math.round(source.positionMs + elapsedAtSource(source, point.atMs - source.startMs) - target.positionMs),
    x: Math.max(-100, Math.min(100, Math.round((point.x - 500) / 10))),
    y: Math.max(-100, Math.min(100, Math.round((point.y - 500) / 10))),
    scale: point.scale ?? 1000,
    angle: point.angle ?? 0,
  })).filter((point) => point.at >= 0 && point.at <= clipLength(target));
  if (!timed.length) throw new Error("Đoạn đã theo dõi không trùng thời gian với lớp cần gắn.");
  const step = Math.max(1, Math.ceil(timed.length / 31));
  const chosen = timed.filter((_, index) => index % step === 0);
  if (chosen.at(-1) !== timed.at(-1)) chosen.push(timed.at(-1)!);
  const base = { ...defaultLook, ...target.look };
  const keyframes = chosen.filter((point, index) => index === 0 || point.at > chosen[index - 1].at).slice(0, 32).map((point) => ({
    atMs: point.at, x: point.x, y: point.y,
    scale: Math.max(10, Math.min(200, Math.round(base.scale * point.scale / 1000))),
    rotate: ((Math.round(base.rotate + point.angle) + 540) % 360) - 180,
    opacity: Math.round(base.opacity), smooth: true,
  }));
  return clips.map((clip) => clip.key === targetKey ? { ...clip, look: { ...base, x: keyframes[0].x, y: keyframes[0].y, keyframes } } : clip);
}

/** Every clip whose span touches a box drawn across lanes on the timeline. */
export function clipsInBox(clips: Clip[], fromMs: number, toMs: number, lanes: { track: EditorTrack; layer: number }[]) {
  const [start, end] = fromMs <= toMs ? [fromMs, toMs] : [toMs, fromMs];
  return clips.filter((clip) => clipFinish(clip) > start && clip.positionMs < end
    && lanes.some((lane) => lane.track === clip.track && lane.layer === layerOf(clip))).map((clip) => clip.key);
}

// ---------------------------------------------------------------------------
// Colour, adjustment layers, attributes, replace, freeze and reverse (0.6.0).

/** Nine points of the tone curve. Same formula as `Look::tone_points` in timeline.rs. */
export function tonePoints(look: Partial<ClipLook> | undefined): number[] | null {
  const values = [look?.exposure, look?.highlights, look?.shadows, look?.whites, look?.blacks].map((value) => value ?? 0);
  if (values.every((value) => value === 0)) return null;
  const [exposure, highlights, shadows, whites, blacks] = values.map((value) => value / 100);
  const bump = (x: number, centre: number) => Math.exp(-(((x - centre) / 0.18) ** 2));
  return Array.from({ length: 9 }, (_, index) => {
    const x = index / 8;
    let y = x * 2 ** exposure;
    y += shadows * 0.2 * bump(x, 0.25) + highlights * 0.2 * bump(x, 0.75);
    y += blacks * 0.15 * (1 - x) ** 4 + whites * 0.15 * x ** 4;
    return Math.round(Math.min(1, Math.max(0, y)) * 10_000) / 10_000;
  });
}

const IDENTITY_CURVE = [0, 250, 500, 750, 1000];

/**
 * Seventeen points per red, green and blue channel: colour wheels (lift, gamma,
 * gain) then the user RGB curves. Same formula as `Look::channel_points` in timeline.rs.
 */
export function channelPoints(look: Partial<ClipLook> | undefined): number[][] | null {
  const wheels = look?.wheels ?? {};
  const curves = look?.rgbCurves ?? {};
  const active = (wheel?: ColorWheel) => !!wheel && (wheel.amount !== 0 || wheel.luma !== 0);
  const custom = (points?: number[]) => !!points && points.some((value, index) => value !== IDENTITY_CURVE[index]);
  if (!active(wheels.lift) && !active(wheels.gamma) && !active(wheels.gain) && !custom(curves.r) && !custom(curves.g) && !custom(curves.b)) return null;
  const offset = (wheel: ColorWheel | undefined, channel: number) => !wheel ? 0
    : wheel.amount / 100 * Math.cos((wheel.hue - 120 * channel) * Math.PI / 180) + wheel.luma / 100;
  return [curves.r, curves.g, curves.b].map((custom, channel) => {
    const lift = 0.25 * offset(wheels.lift, channel);
    const gamma = 2 ** offset(wheels.gamma, channel);
    const gain = 1 + 0.5 * offset(wheels.gain, channel);
    const points = custom ?? IDENTITY_CURVE;
    return Array.from({ length: 17 }, (_, index) => {
      const x = index / 16;
      const base = Math.max(0, lift + (1 - lift) * x);
      const graded = Math.min(1, Math.max(0, gain * base ** (1 / gamma)));
      const at = graded * 4;
      const k = Math.min(3, Math.floor(at));
      const y = (points[k] + (points[k + 1] - points[k]) * (at - k)) / 1000;
      return Math.round(Math.min(1, Math.max(0, y)) * 10_000) / 10_000;
    });
  });
}

export const colorKeys = ["brightness", "contrast", "saturation", "temperature", "exposure", "highlights", "shadows", "whites", "blacks", "tint", "hue", "vibrance"] as const;

/** Adds an adjustment layer at a time on a text lane, 5 seconds or up to the end of the timeline. */
export function addAdjustment(clips: Clip[], wantedMs: number, layer: number, look: Partial<ClipLook> = {}): Clip[] {
  const end = Math.max(totalMs(clips), wantedMs + 1000);
  const length = Math.max(MIN_CLIP_MS, Math.min(5000, end - wantedMs));
  const positionMs = place(clips, "text", length, wantedMs, undefined, layer);
  return [...clips, {
    key: newKey(), assetId: 0, relativePath: ADJUSTMENT_NAME, kind: "adjustment", track: "text",
    startMs: 0, endMs: length, positionMs, sourceMs: null, available: true, layer, look,
  }];
}

/** Properties copied by Ctrl+Shift+C: appearance and sound, never timing or identity. */
const attributeSkip = new Set(["speed", "speedCurve", "keyframes", "transition", "editGroup", "compound", "multicam",
  "audioLink", "audioDetached", "disabled", "freezeAtMs", "reverse"]);

export function copyAttributes(clip: Clip): Partial<ClipLook> | TitleStyle {
  if (clip.title) {
    const style: Partial<TitleStyle> = { ...clip.title };
    delete style.text;
    delete style.editGroup;
    delete style.caption;
    return style as TitleStyle;
  }
  return Object.fromEntries(Object.entries({ ...defaultLook, ...clip.look }).filter(([key]) => !attributeSkip.has(key)));
}

/** Pastes copied attributes onto every selected clip of the matching kind. */
export function pasteAttributes(clips: Clip[], keys: ReadonlySet<string>, copied: Partial<ClipLook> | TitleStyle): Clip[] {
  const titleStyle = "size" in copied && "color" in copied;
  return clips.map((clip) => {
    if (!keys.has(clip.key)) return clip;
    if (clip.title) return titleStyle ? { ...clip, title: { ...clip.title, ...(copied as TitleStyle),
      text: clip.title.text, caption: clip.title.caption, words: clip.title.words,
      captionMotion: clip.title.caption ? (copied as TitleStyle).captionMotion : undefined, editGroup: clip.title.editGroup } } : clip;
    if (titleStyle) return clip;
    return { ...clip, look: { ...clip.look, ...(copied as Partial<ClipLook>) } };
  });
}

/** Swaps the media under a clip, keeping position, length (as far as the new media allows) and look. */
export function replaceClip(clips: Clip[], key: string, media: MediaRef): Clip[] {
  const clip = clips.find((item) => item.key === key);
  if (!clip || clip.track === "text" || trackOf(media.kind) !== clip.track && !(clip.track === "audio" && media.kind === "video")) {
    throw new Error("Chọn media cùng loại với clip (hình cho tầng video, âm thanh cho tầng âm thanh).");
  }
  const sourceNeeded = clip.endMs - clip.startMs;
  const available = media.kind === "image" ? MAX_IMAGE_MS : media.durationMs ?? 0;
  const span = Math.min(sourceNeeded, available);
  if (span < MIN_CLIP_MS) throw new Error("Media mới quá ngắn để thay clip này.");
  const look = { ...clip.look, freezeAtMs: undefined, reverse: media.kind === "image" ? undefined : clip.look?.reverse,
    speed: media.kind === "image" ? 100 : clip.look?.speed, speedCurve: media.kind === "image" ? undefined : clip.look?.speedCurve,
    transition: undefined, audioDetached: undefined, audioLink: undefined };
  return clips.map((item) => item.key === key ? {
    ...item, assetId: media.assetId, relativePath: media.relativePath, kind: media.kind, startMs: 0, endMs: span,
    sourceMs: media.durationMs, width: media.width, height: media.height, hasThumbnail: media.hasThumbnail, available: true, look,
  } : item);
}

/**
 * Freeze frame at the playhead: splits the video clip and inserts a still of
 * the current frame, pushing everything after it on the lane.
 */
export function freezeFrame(clips: Clip[], key: string, atMs: number, holdMs = 3000): Clip[] {
  const clip = clips.find((item) => item.key === key);
  if (!clip || clip.kind !== "video" || clip.track !== "video" || isStill(clip) || atMs < clip.positionMs || atMs >= clipFinish(clip)) {
    throw new Error("Đặt playhead trên một clip video để tạo khung hình tĩnh.");
  }
  const offset = sourcePosition(clip, atMs - clip.positionMs).offset;
  const frameMs = Math.round(clip.look?.reverse ? clip.endMs - offset : clip.startMs + offset);
  const split = canSplit(clip, atMs) ? splitClip(clips, key, atMs) ?? clips : clips;
  const before = split.find((item) => item.key === key)!;
  const insertAt = atMs <= clip.positionMs ? clip.positionMs : clipFinish(before);
  const hold: Clip = {
    ...clip, key: newKey(), startMs: 0, endMs: holdMs, positionMs: insertAt,
    look: { ...clip.look, freezeAtMs: frameMs, speed: 100, speedCurve: undefined, reverse: undefined, keyframes: undefined,
      transition: undefined, audioDetached: undefined, audioLink: undefined, multicam: undefined },
  };
  return [...split.map((item) => sameLane(item, clip) && item.key !== key && item.positionMs >= insertAt
    ? { ...item, positionMs: item.positionMs + holdMs } : item), hold];
}

export const MAX_REVERSE_MS = 60_000;

export function toggleReverse(clips: Clip[], key: string): Clip[] {
  const clip = clips.find((item) => item.key === key);
  if (!clip || clip.track === "text" || isStill(clip)) throw new Error("Chỉ đảo ngược được clip video hoặc âm thanh.");
  if (hasCurve(clip)) throw new Error("Gỡ đường cong tốc độ trước khi đảo ngược clip.");
  if (clip.endMs - clip.startMs > MAX_REVERSE_MS) throw new Error("Chỉ đảo ngược đoạn nguồn dài tối đa 60 giây. Hãy cắt ngắn clip trước.");
  return clips.map((item) => item.key === key ? { ...item, look: { ...item.look, reverse: item.look?.reverse ? undefined : true, keyframes: undefined } } : item);
}

/**
 * Lines up angles by measured audio offsets before creating the multicam:
 * \`offsets[key]\` is how much later a sound heard by the reference appears in that angle.
 */
export function alignByAudio(clips: Clip[], referenceKey: string, offsets: Record<string, number>): Clip[] {
  const reference = clips.find((clip) => clip.key === referenceKey);
  if (!reference) return clips;
  return clips.map((clip) => {
    const offset = offsets[clip.key];
    if (offset === undefined || clip.key === referenceKey) return clip;
    let positionMs = reference.positionMs - Math.round(offset / playbackRate(clip));
    let startMs = clip.startMs;
    if (positionMs < 0) {
      startMs += Math.round(-positionMs * playbackRate(clip));
      positionMs = 0;
    }
    if (clip.endMs - startMs < MIN_CLIP_MS) throw new Error("Một góc máy lệch quá xa nên không còn đoạn chung với góc chính.");
    return { ...clip, startMs, positionMs };
  });
}
