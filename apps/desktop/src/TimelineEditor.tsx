import { useEffect, useEffectEvent, useImperativeHandle, useLayoutEffect, useRef, useState } from "react";
import type { KeyboardEvent, MouseEvent, PointerEvent, Ref } from "react";
import { ContextMenu } from "./ContextMenu";
import type { MenuItem, MenuState } from "./ContextMenu";
import { fileName, mediaUrl } from "./desktop";
import type { EditorTrack, ExportRange, LaneControl, Project } from "./desktop";
import { Icon } from "./Icon";
import {
  MAX_LAYERS, MAX_TIMELINE_MS, audioFades, canDetachAudio, canSplit, changesLockedLane, clipFinish, clipLane, clipLength, clipsAt, clipsInBox, compoundBlocks,
  compoundOf, createCompound, createMulticam, deleteSelection, detachAudio, groupOf, groupSelection, hasCurve, laneControl, layerOf, mediaDropPlacement,
  moveClip, moveSelection, multicamAngles, pasteSelection, previousVisual, releaseCompound, releaseMulticam, renameCompound, restoreAudio, setDisabled,
  setSpeed, snap, speedCurvePresets, splitClip, switchAngle, totalMs, transitionBetween, trimClip,
  addAdjustment, copyAttributes, freezeFrame, isStill, pasteAttributes, replaceClip, toggleReverse,
} from "./timeline";
import type { ClipLook, TitleStyle } from "./desktop";
import type { Clip, MediaDropTarget, MediaRef } from "./timeline";
import { frameTimecode, timecode, vi } from "./vi";

const MIN_SCALE = 0.00002;
const MAX_SCALE = 0.96;
const TICKS = [100, 200, 500, 1000, 2000, 5000, 10_000, 30_000, 60_000, 120_000, 300_000, 600_000, 1_800_000, 3_600_000];
const SNAP_PX = 8;
type Mode = "move" | "start" | "end" | "fadeIn" | "fadeOut";
export type SmartAction = "scenes" | "silence" | "beats" | "track" | "speed" | "multicam";
type Tool = "select" | "split" | "left" | "right";
type SaveState = "saved" | "saving" | "error";

interface Props {
  ref: Ref<TimelineDrop>;
  project: Project | undefined;
  clips: Clip[];
  selectedKey: string | null;
  playheadMs: number;
  revision: number;
  busy: boolean;
  canUndo: boolean;
  canRedo: boolean;
  saveState: SaveState;
  lane: Lane;
  laneControls: LaneControl[];
  onLaneControl: (lane: Lane, flag: "locked" | "muted" | "hidden") => void;
  onChange: (clips: Clip[]) => boolean;
  onSelect: (key: string | null) => void;
  onPlayhead: (ms: number) => void;
  onPlay: () => void;
  onDropMedia: (media: MediaRef, target: MediaDropTarget) => void;
  onLane: (lane: Lane) => void;
  onTitle: () => void;
  onUndo: () => void;
  onRedo: () => void;
  onExport: (queueOnly: boolean) => void;
  range: ExportRange | undefined;
  onRange: (edge: "start" | "end" | "clear") => void;
  onNotify: (text: string, error: boolean) => void;
  onSmart: (action: SmartAction, key: string, keys?: string[]) => void;
  /** The media selected in the library, offered by "Replace clip". */
  replaceMedia: MediaRef | null;
}

export type Lane = { track: EditorTrack; layer: number };
export interface TimelineDrop {
  media: (item: MediaRef, clientX: number, clientY: number, commit: boolean) => void;
  clear: () => void;
  target: (x: number, y: number) => MediaDropTarget | null;
  hover: (x?: number, y?: number) => void;
  addMarkers: (times: number[]) => void;
}
const kinds = ["text", "video", "audio"] as const;
const label = { text: "Chữ", video: "Video", audio: "Âm thanh" };
const laneKey = ({ track, layer }: Lane) => `${track}-${layer}`;

export function TimelineEditor(props: Props) {
  const { project, clips, selectedKey, playheadMs, busy, lane, laneControls, onChange, onSelect, onPlayhead } = props;
  const [scale, setScale] = useState(0.06);
  const [snapping, setSnapping] = useState(true);
  const [magnet, setMagnet] = useState(false);
  const [linkage, setLinkage] = useState(true);
  const [tool, setTool] = useState<Tool>("select");
  const [multi, setMulti] = useState<string[]>([]);
  const markerStorage = `dt-edit-markers-${project?.id ?? "empty"}`;
  const [markers, setMarkers] = useState<number[]>(() => {
    try {
      const saved: unknown = JSON.parse(localStorage.getItem(markerStorage) ?? "[]");
      return Array.isArray(saved) ? saved.filter((value): value is number =>
        Number.isInteger(value) && value >= 0 && value <= MAX_TIMELINE_MS).slice(0, 100) : [];
    } catch { return []; }
  });
  const clipboard = useRef<Clip[]>([]);
  const [draft, setDraft] = useState<Clip[] | null>(null);
  const [pending, setPending] = useState<{ lane: Lane; at: number; length: number; name: string } | null>(null);
  const [nativeOver, setNativeOver] = useState(false);
  const [viewport, setViewport] = useState({ width: 600, left: 0 });
  const [extra, setExtra] = useState({ text: 0, video: 1, audio: 1 });
  const [menu, setMenu] = useState<MenuState | null>(null);
  const [expanded, setExpanded] = useState<ReadonlySet<number>>(new Set());
  /** A compound opened as its own timeline: only its clips are shown and edited. */
  const [focus, setFocus] = useState<{ id: number; name: string } | null>(null);
  const attributes = useRef<Partial<ClipLook> | TitleStyle | null>(null);
  const [box, setBox] = useState<{ left: number; top: number; width: number; height: number } | null>(null);
  const boxStart = useRef<{ x: number; y: number; pointer: number } | null>(null);
  const lastPress = useRef({ target: "", at: 0 });
  /** Pointer events report no click count, so a second press within 400 ms counts as a double click. */
  function doublePress(target: string) {
    const now = performance.now();
    const double = lastPress.current.target === target && now - lastPress.current.at < 400;
    lastPress.current = { target: double ? "" : target, at: now };
    return double;
  }
  const drag = useRef<{ key: string; keys: ReadonlySet<string>; mode: Mode; at: number; x: number; y: number; pointer: number } | null>(null);
  const scroll = useRef<HTMLDivElement>(null);
  const editor = useRef<HTMLElement>(null);
  const canvas = useRef<HTMLDivElement>(null);
  const labels = useRef<HTMLDivElement>(null);
  const scrollAfterZoom = useRef<number | null>(null);
  const all = draft ?? clips;
  const shown = focus ? all.filter((clip) => compoundOf(clip)?.id === focus.id) : all;
  const total = totalMs(shown);
  const width = Math.max(viewport.width, Math.round(Math.max(total + 1000, (pending?.at ?? 0) + (pending?.length ?? 0)) * scale));
  const tick = TICKS.find((ms) => ms * scale >= 64) ?? TICKS.at(-1)!;
  const firstTick = Math.floor(viewport.left / (tick * scale));
  const tickCount = Math.min(Math.floor(width / (tick * scale)) - firstTick + 1, Math.ceil(viewport.width / (tick * scale)) + 2);
  const zoomPercent = Math.round(100 * Math.log(scale / MIN_SCALE) / Math.log(MAX_SCALE / MIN_SCALE));
  const blocks = focus ? [] : compoundBlocks(shown).filter((block) => !expanded.has(block.id));
  const folded = new Set(blocks.flatMap((block) => block.keys));
  const selected = clips.find((clip) => clip.key === selectedKey);
  const group = selected && groupOf(selected);
  const chosen = new Set(selected ? multi.includes(selected.key) ? multi : group
    ? clips.filter((clip) => groupOf(clip) === group).map((clip) => clip.key) : [selected.key] : []);
  const cuts = clipsAt(clips, playheadMs).filter((clip) => !chosen.size || chosen.has(clip.key));
  const locked = busy || !project;
  const layerCount = (track: EditorTrack) => laneControls.filter((control) => control.track === track).reduce(
    (count, control) => Math.max(count, control.layer + 1), clips.filter((clip) => clip.track === track)
      .reduce((count, clip) => Math.max(count, layerOf(clip) + 1), extra[track]));
  const lanes = kinds.flatMap((track) => {
    const count = layerCount(track);
    return Array.from({ length: count }, (_, i) => ({ track, layer: track === "audio" ? i : count - i - 1 }));
  });
  const overlayLayer = clips.some((clip) => clip.track === "video") ? layerCount("video") : 0;
  const nextAudioLayer = clips.some((clip) => clip.track === "audio") ? layerCount("audio") : 0;
  function addLane(track: EditorTrack) {
    const layer = layerCount(track);
    if (layer >= MAX_LAYERS) return;
    setExtra((current) => ({ ...current, [track]: layer + 1 }));
    props.onLane({ track, layer });
  }

  const timeAt = (clientX: number) =>
    Math.min(MAX_TIMELINE_MS, Math.max(0, Math.round((clientX - (canvas.current?.getBoundingClientRect().left ?? 0)) / scale)));

  function measure() {
    if (!scroll.current || !labels.current) return;
    const width = Math.max(1, scroll.current.clientWidth - labels.current.offsetWidth);
    const left = scroll.current.scrollLeft;
    setViewport((old) => old.width === width && old.left === left ? old : { width, left });
  }

  useLayoutEffect(() => {
    if (!scroll.current) return;
    const observer = new ResizeObserver(measure);
    observer.observe(scroll.current);
    measure();
    return () => observer.disconnect();
  }, []);

  useLayoutEffect(() => {
    if (!scroll.current || scrollAfterZoom.current === null) return;
    scroll.current.scrollLeft = scrollAfterZoom.current;
    scrollAfterZoom.current = null;
  }, [scale]);

  function zoomTo(wanted: number, anchorMs = playheadMs, anchorX?: number) {
    const next = Math.min(MAX_SCALE, Math.max(MIN_SCALE, wanted));
    if (next === scale) return;
    const left = scroll.current?.scrollLeft ?? 0;
    const visibleX = anchorX ?? Math.max(0, Math.min(viewport.width, anchorMs * scale - left));
    scrollAfterZoom.current = Math.max(0, anchorMs * next - visibleX);
    setScale(next);
  }

  const wheelZoom = useEffectEvent((event: WheelEvent) => {
    if ((!event.ctrlKey && !event.metaKey) || !scroll.current || !labels.current) return;
    event.preventDefault();
    const x = Math.max(0, event.clientX - scroll.current.getBoundingClientRect().left - labels.current.offsetWidth);
    zoomTo(scale * (event.deltaY < 0 ? 1.18 : 1 / 1.18), timeAt(event.clientX), x);
  });
  useEffect(() => {
    const element = scroll.current;
    if (!element) return;
    const onWheel = (event: WheelEvent) => wheelZoom(event);
    element.addEventListener("wheel", onWheel, { passive: false });
    return () => element.removeEventListener("wheel", onWheel);
  }, []);

  function laneAt(x: number, y: number, track: EditorTrack): Lane | null {
    const element = document.elementFromPoint(x, y);
    if (!element || !canvas.current?.contains(element) || element.closest(".tl-ruler")) return null;
    const row = element.closest<HTMLElement>("[data-track]");
    if (row?.dataset.track === track) return { track, layer: Number(row.dataset.layer) };
    const rows = [...canvas.current.querySelectorAll<HTMLElement>(`[data-track="${track}"]`)];
    const distance = (row: HTMLElement) => {
      const bounds = row.getBoundingClientRect();
      return Math.max(0, bounds.top - y, y - bounds.bottom);
    };
    const closest = rows.reduce((best, row) => distance(row) < distance(best) ? row : best);
    return { track, layer: Number(closest.dataset.layer) };
  }

  function snapped(wanted: number, length: number, target: Lane, keys?: ReadonlySet<string>) {
    if (!snapping) return wanted;
    const edges = [0, playheadMs, ...clips.filter((clip) => !keys?.has(clip.key) && clip.track === target.track && layerOf(clip) === target.layer)
      .flatMap((clip) => [clip.positionMs, clipFinish(clip)])];
    const tolerance = SNAP_PX / scale;
    const head = snap(wanted, edges, tolerance);
    return head !== wanted ? head : snap(wanted + length, edges, tolerance) - length;
  }

  function mediaTarget(x: number, y: number): MediaDropTarget | null {
    const element = document.elementFromPoint(x, y);
    if (busy || !element || !scroll.current?.contains(element)) return null;
    const row = element.closest<HTMLElement>("[data-track]");
    const track = row?.dataset.track;
    const layer = Number(row?.dataset.layer ?? 0);
    const aboveVideo = track === "text" || !!element.closest(".tl-overlay-slot");
    const belowAudio = !!element.closest(".tl-below");
    return {
      positionMs: timeAt(Math.max(x, (scroll.current.getBoundingClientRect().left + (labels.current?.offsetWidth ?? 0)))),
      videoLayer: track === "video" ? layer : aboveVideo ? Math.min(overlayLayer, MAX_LAYERS - 1) : 0,
      audioLayer: track === "audio" ? layer : belowAudio ? Math.min(nextAudioLayer, MAX_LAYERS - 1) : 0,
      toleranceMs: snapping ? SNAP_PX / scale : 0,
      playheadMs,
    };
  }

  useImperativeHandle(props.ref, () => ({
    addMarkers(times) {
      const next = [...new Set([...markers, ...times.map(Math.round)])].filter((at) => at >= 0 && at <= MAX_TIMELINE_MS).sort((a, b) => a - b).slice(0, 100);
      setMarkers(next);
      try { localStorage.setItem(markerStorage, JSON.stringify(next)); } catch { /* Storage can be unavailable. */ }
    },
    clear: () => setPending(null),
    target: mediaTarget,
    hover: (x, y) => setNativeOver(x !== undefined && y !== undefined && !!mediaTarget(x, y)),
    media(item, x, y, commit) {
      const target = mediaTarget(x, y);
      if (!target) { setPending(null); return; }
      if (commit) {
        setPending(null);
        props.onDropMedia(item, target);
      } else {
        const placement = mediaDropPlacement(clips, item, target, laneControls);
        setPending(placement ? { lane: placement, at: placement.at, length: placement.length, name: fileName(item.relativePath) } : null);
      }
    },
  }));

  function begin(event: PointerEvent<HTMLElement>, clip: Clip, mode: Mode) {
    if (locked || event.button !== 0) return;
    event.stopPropagation();
    editor.current?.focus({ preventScroll: true });
    if (clipLane(laneControls, clip)?.locked) { setMulti([]); onSelect(clip.key); return; }
    if (tool === "split" && mode === "move") {
      if (clip.look?.compound && !expanded.has(clip.look.compound.id)) return;
      const at = Math.round(Math.round(timeAt(event.clientX) * 30 / 1000) * 1000 / 30);
      const next = splitClip(clips, clip.key, at);
      if (next) { onChange(next); onPlayhead(at); }
      return;
    }
    const members = groupOf(clip) ? clips.filter((item) => groupOf(item) === groupOf(clip)).map((item) => item.key) : [clip.key];
    if (tool === "left" || tool === "right") {
      const selection = clips.filter((item) => tool === "right" ? item.positionMs >= clip.positionMs : item.positionMs <= clip.positionMs);
      setMulti(selection.map((item) => item.key));
      onSelect(clip.key);
      return;
    }
    if (event.ctrlKey || event.metaKey || event.shiftKey) {
      const next = new Set(chosen);
      if (members.every((key) => next.has(key))) members.forEach((key) => next.delete(key));
      else members.forEach((key) => next.add(key));
      setMulti([...next]);
      onSelect(next.has(clip.key) ? clip.key : next.values().next().value ?? null);
      return;
    }
    const selection = chosen.has(clip.key) ? chosen : new Set(members);
    setMulti([...selection]);
    canvas.current?.setPointerCapture(event.pointerId);
    onSelect(clip.key);
    drag.current = { key: clip.key, keys: selection, mode, at: timeAt(event.clientX), x: event.clientX, y: event.clientY, pointer: event.pointerId };
  }

  function dragResult(event: PointerEvent<HTMLElement>) {
    const active = drag.current;
    if (!active || locked || active.pointer !== event.pointerId) return clips;
    const clip = clips.find((item) => item.key === active.key);
    if (!clip || Math.hypot(event.clientX - active.x, event.clientY - active.y) < 3) return clips;
    const delta = timeAt(event.clientX) - active.at;
    if (active.mode === "move") {
      const target = laneAt(event.clientX, event.clientY, clip.track);
      if (!target) return clips;
      const at = snapped(clip.positionMs + delta, clipLength(clip), target, active.keys);
      return active.keys.size > 1 ? moveSelection(clips, active.keys, at - clip.positionMs)
        : moveClip(clips, clip.key, at, target.layer);
    }
    if (active.mode === "fadeIn" || active.mode === "fadeOut") {
      const [fadeIn, fadeOut] = audioFades(clip);
      const length = clipLength(clip);
      const value = active.mode === "fadeIn" ? fadeIn + delta : fadeOut - delta;
      const other = active.mode === "fadeIn" ? fadeOut : fadeIn;
      const next = Math.round(Math.max(0, Math.min(10_000, length - other, value)) / 10) * 10;
      const key = active.mode === "fadeIn" ? "audioFadeInMs" : "audioFadeOutMs";
      if (next === (active.mode === "fadeIn" ? fadeIn : fadeOut)) return clips;
      return clips.map((item) => item.key === clip.key ? { ...item, look: { ...item.look, [key]: next } } : item);
    }
    return trimClip(clips, clip.key, active.mode, delta, magnet, linkage);
  }

  function finish(event: PointerEvent<HTMLElement>) {
    if (drag.current?.pointer !== event.pointerId) return;
    const key = drag.current.key;
    const next = dragResult(event);
    cancelDrag();
    if (next === clips || !onChange(next)) return;
    const moved = next.find((clip) => clip.key === key)!;
    props.onLane({ track: moved.track, layer: layerOf(moved) });
  }

  function cancelDrag() {
    drag.current = null;
    setDraft(null);
  }

  function split(all = false) {
    const targets = (all ? clipsAt(clips, playheadMs) : cuts).filter((clip) => !clipLane(laneControls, clip)?.locked);
    const next = targets.reduce<Clip[]>((current, clip) => splitClip(current, clip.key, playheadMs) ?? current, clips);
    if (next !== clips) onChange(next);
  }

  function remove() {
    if (!chosen.size || locked) return;
    const next = deleteSelection(clips, chosen, magnet, linkage);
    if (next === clips || !onChange(next)) return;
    setMulti([]);
    onSelect(null);
  }

  function nudge(clip: Clip, deltaMs: number) {
    const next = chosen.size > 1 ? moveSelection(clips, chosen, deltaMs) : moveClip(clips, clip.key, clip.positionMs + deltaMs);
    if (next !== clips) onChange(next);
  }

  function apply(change: () => Clip[], done?: string) {
    try {
      const next = change();
      if (next !== clips && onChange(next) && done) props.onNotify(done, false);
    } catch (error) {
      props.onNotify(error instanceof Error ? error.message : String(error), true);
    }
  }

  function copy(cut = false) {
    clipboard.current = clips.filter((clip) => chosen.has(clip.key));
    if (cut) remove();
  }

  function paste(at = playheadMs) {
    const next = pasteSelection(clips, clipboard.current, at);
    if (next !== clips && onChange(next)) {
      setMulti(next.slice(clips.length).map((clip) => clip.key));
      onSelect(next[clips.length].key);
    }
  }

  function selectBlock(keys: string[]) {
    setMulti(keys);
    onSelect(keys[0] ?? null);
  }

  function open(event: MouseEvent, label: string, items: MenuItem[]) {
    event.preventDefault();
    event.stopPropagation();
    if (locked) return;
    editor.current?.focus({ preventScroll: true });
    setMenu({ x: event.clientX, y: event.clientY, label, items });
  }

  function clipMenu(event: MouseEvent, clip: Clip) {
    const members = chosen.has(clip.key) ? chosen : new Set(groupOf(clip)
      ? clips.filter((item) => groupOf(item) === groupOf(clip)).map((item) => item.key) : [clip.key]);
    if (!chosen.has(clip.key)) { setMulti([...members]); onSelect(clip.key); }
    const picked = clips.filter((item) => members.has(item.key));
    const lockedLane = !!clipLane(laneControls, clip)?.locked;
    const media = clip.track !== "text";
    const compound = compoundOf(clip);
    const cam = clip.look?.multicam;
    const anyDisabled = picked.some((item) => item.look?.disabled);
    const items: MenuItem[] = [
      { label: "Cắt", shortcut: "Ctrl+X", disabled: lockedLane, action: () => { clipboard.current = picked; apply(() => deleteSelection(clips, members, magnet, linkage)); } },
      { label: "Sao chép", shortcut: "Ctrl+C", action: () => { clipboard.current = picked; } },
      { label: "Dán tại playhead", shortcut: "Ctrl+V", disabled: !clipboard.current.length, action: () => paste() },
      { label: "Nhân bản ngay sau", shortcut: "Ctrl+D", action: () => { clipboard.current = picked; paste(Math.max(...picked.map(clipFinish))); } },
      { label: "Xóa", shortcut: "Delete", danger: true, disabled: lockedLane, action: () => apply(() => deleteSelection(clips, members, magnet, linkage)) },
      "separator",
      { label: "Tách tại playhead", shortcut: "Ctrl+B", disabled: lockedLane || !canSplit(clip, playheadMs), action: () => apply(() => splitClip(clips, clip.key, playheadMs) ?? clips) },
      { label: "Sao chép thuộc tính", shortcut: "Ctrl+Shift+C", action: () => { attributes.current = copyAttributes(clip); } },
      { label: "Dán thuộc tính", shortcut: "Ctrl+Shift+V", disabled: lockedLane || !attributes.current, action: () => attributes.current && apply(() => pasteAttributes(clips, members, attributes.current!), "Đã dán thuộc tính.") },
      { label: props.replaceMedia ? `Thay bằng ${fileName(props.replaceMedia.relativePath)}` : "Thay clip (chọn media trong thư viện trước)", disabled: lockedLane || !props.replaceMedia || clip.track === "text",
        action: () => props.replaceMedia && apply(() => replaceClip(clips, clip.key, props.replaceMedia!), "Đã thay media, giữ vị trí và hiệu chỉnh.") },
      ...(clip.kind === "video" && clip.track === "video" && !isStill(clip) ? [{ label: "Khung hình tĩnh tại playhead (3 giây)", disabled: lockedLane || playheadMs < clip.positionMs || playheadMs >= clipFinish(clip),
        action: () => apply(() => freezeFrame(clips, clip.key, playheadMs), "Đã chèn khung hình tĩnh 3 giây.") }] : []),
      ...(media && clip.kind !== "image" && !isStill(clip) && clip.kind !== "adjustment" ? [{ label: clip.look?.reverse ? "Bỏ đảo ngược" : "Đảo ngược", checked: !!clip.look?.reverse, disabled: lockedLane,
        action: () => apply(() => toggleReverse(clips, clip.key)) }] : []),
      { label: anyDisabled ? "Bật lại clip" : "Tắt clip", shortcut: "V", disabled: lockedLane || !media, action: () => apply(() => setDisabled(clips, members, !anyDisabled)) },
    ];
    if (clip.track === "video" && clip.kind === "video") {
      items.push(clip.look?.audioDetached
        ? { label: "Khôi phục âm thanh", action: () => apply(() => restoreAudio(clips, clip.key), "Đã gộp âm thanh về clip video.") }
        : { label: "Tách âm thanh", shortcut: "Ctrl+Shift+S", disabled: lockedLane || !canDetachAudio(clip), action: () => apply(() => detachAudio(clips, clip.key), "Đã tách âm thanh sang tầng âm thanh.") });
    }
    if (clip.track === "audio" && clip.look?.audioLink !== undefined) {
      items.push({ label: "Gộp lại vào video", action: () => apply(() => restoreAudio(clips, clip.key), "Đã gộp âm thanh về clip video.") });
    }
    if (media && clip.kind !== "image") {
      items.push("separator", { heading: "Tốc độ" });
      for (const speed of [50, 100, 200]) {
        items.push({ label: (speed / 100) + "×", checked: !hasCurve(clip) && (clip.look?.speed ?? 100) === speed, disabled: lockedLane,
          action: () => apply(() => setSpeed(clips, clip.key, speed)) });
      }
      for (const preset of speedCurvePresets.slice(0, 4)) {
        items.push({ label: "Đường cong · " + preset.label, disabled: lockedLane, action: () => apply(() => setSpeed(clips, clip.key, 100, preset.points)) });
      }
      items.push({ label: "Chỉnh đường cong…", disabled: lockedLane, action: () => props.onSmart("speed", clip.key) });
    }
    items.push("separator", { heading: "Nhóm và dựng nâng cao" });
    items.push({ label: "Nhóm", shortcut: "Ctrl+G", disabled: picked.length < 2, action: () => apply(() => groupSelection(clips, members)) });
    if (picked.some(groupOf)) items.push({ label: "Bỏ nhóm", shortcut: "Ctrl+Shift+G", action: () => apply(() => groupSelection(clips, members, true)) });
    if (compound) {
      items.push(
        { label: "Mở timeline con của compound", action: () => { setFocus(compound); setMulti([]); onSelect(null); } },
        { label: expanded.has(compound.id) ? "Thu gọn compound" : "Mở compound", action: () => setExpanded((current) => {
          const next = new Set(current);
          if (next.has(compound.id)) next.delete(compound.id); else next.add(compound.id);
          return next;
        }) },
        { label: "Đổi tên compound…", action: () => {
          const name = window.prompt("Tên compound", compound.name);
          if (name) apply(() => renameCompound(clips, compound.id, name));
        } },
        { label: "Tách compound", action: () => apply(() => releaseCompound(clips, compound.id), "Đã tách compound thành các clip.") },
      );
    } else {
      items.push({ label: "Tạo compound", shortcut: "Alt+G", disabled: picked.filter((item) => item.track !== "text").length < 2,
        action: () => apply(() => createCompound(clips, members, "Compound " + (compoundBlocks(clips).length + 1)), "Đã tạo compound. Nhấp đúp để mở.") });
    }
    if (cam !== undefined) {
      const angles = multicamAngles(clips, cam);
      angles.forEach((_, index) => items.push({ label: "Chuyển sang góc " + (index + 1) + " tại playhead", shortcut: String(index + 1),
        action: () => apply(() => switchAngle(clips, cam, index, playheadMs)) }));
      items.push({ label: "Gỡ multicam", action: () => apply(() => releaseMulticam(clips, cam)) });
    } else if (picked.filter((item) => item.track === "video" && item.kind === "video").length >= 2) {
      items.push({ label: "Tạo multicam (đồng bộ theo điểm đầu)", action: () => apply(() => createMulticam(clips, members), "Đã đồng bộ góc máy. Nhấn 1–9 để chuyển góc tại playhead.") });
      items.push({ label: "Tạo multicam (đồng bộ theo âm thanh)", action: () => props.onSmart("multicam", clip.key, [...members]) });
    }
    if (media) {
      items.push("separator", { heading: "Công cụ thông minh" });
      if (clip.kind === "video") items.push({ label: "Dò cảnh và tách", action: () => props.onSmart("scenes", clip.key) });
      if (clip.kind !== "image") {
        items.push({ label: "Xóa khoảng lặng", action: () => props.onSmart("silence", clip.key) });
        items.push({ label: "Đánh dấu nhịp nhạc", action: () => props.onSmart("beats", clip.key) });
      }
      if (clip.track === "video" && layerOf(clip) > 0) items.push({ label: "Bám theo chuyển động…", action: () => props.onSmart("track", clip.key) });
    }
    items.push("separator", { label: lockedLane ? "Mở khóa tầng" : "Khóa tầng", action: () => props.onLaneControl({ track: clip.track, layer: layerOf(clip) }, "locked") });
    open(event, "Thao tác với clip", items);
  }

  function laneMenu(event: MouseEvent, target: Lane) {
    const control = laneControl(laneControls, target.track, target.layer);
    const items: MenuItem[] = [
      { label: "Khóa tầng", checked: !!control?.locked, action: () => props.onLaneControl(target, "locked") },
      ...(target.track !== "audio" ? [{ label: "Ẩn hình", checked: !!control?.hidden, action: () => props.onLaneControl(target, "hidden") }] : []),
      ...(target.track !== "text" ? [{ label: "Tắt tiếng", checked: !!control?.muted, action: () => props.onLaneControl(target, "muted") }] : []),
      "separator",
      { label: "Chọn tất cả trên tầng", action: () => selectBlock(clips.filter((clip) => clip.track === target.track && layerOf(clip) === target.layer).map((clip) => clip.key)) },
      { label: "Thêm tầng " + label[target.track].toLowerCase(), disabled: layerCount(target.track) >= MAX_LAYERS, action: () => addLane(target.track) },
    ];
    open(event, "Thao tác với tầng", items);
  }

  function canvasMenu(event: MouseEvent) {
    const at = timeAt(event.clientX);
    open(event, "Thao tác với timeline", [
      { label: "Dán tại đây", shortcut: "Ctrl+V", disabled: !clipboard.current.length, action: () => paste(at) },
      { label: "Đặt playhead tại đây", action: () => onPlayhead(at) },
      { label: "Chọn tất cả", shortcut: "Ctrl+A", disabled: !clips.length, action: () => selectBlock(clips.map((clip) => clip.key)) },
      "separator",
      { label: "Thêm chữ tại playhead", action: props.onTitle },
      { label: "Thêm/gỡ marker", shortcut: "M", action: marker },
      { label: "Đặt điểm In", shortcut: "I", disabled: !total, action: () => props.onRange("start") },
      { label: "Đặt điểm Out", shortcut: "O", disabled: !total, action: () => props.onRange("end") },
      { label: "Bỏ vùng In–Out", disabled: !props.range, action: () => props.onRange("clear") },
      "separator",
      { label: "Hít mép", shortcut: "N", checked: snapping, action: () => setSnapping(!snapping) },
      { label: "Dồn clip chính", shortcut: "P", checked: magnet, action: () => setMagnet(!magnet) },
      { label: "Liên kết", shortcut: "~", checked: linkage, action: () => setLinkage(!linkage) },
      { label: "Vừa khung", shortcut: "Shift+Z", disabled: !total, action: fit },
    ]);
  }

  function beginBox(event: PointerEvent<HTMLElement>) {
    if (locked || event.button !== 0 || !canvas.current) return;
    boxStart.current = { x: event.clientX, y: event.clientY, pointer: event.pointerId };
    canvas.current.setPointerCapture(event.pointerId);
  }

  function boxRect(event: PointerEvent<HTMLElement>) {
    const start = boxStart.current;
    const bounds = canvas.current?.getBoundingClientRect();
    if (!start || !bounds) return null;
    return { left: Math.min(start.x, event.clientX) - bounds.left, top: Math.min(start.y, event.clientY) - bounds.top,
      width: Math.abs(event.clientX - start.x), height: Math.abs(event.clientY - start.y) };
  }

  function finishBox(event: PointerEvent<HTMLElement>) {
    const start = boxStart.current;
    boxStart.current = null;
    setBox(null);
    if (!start || start.pointer !== event.pointerId || !canvas.current || Math.hypot(event.clientX - start.x, event.clientY - start.y) < 5) return;
    const [top, bottom] = [Math.min(start.y, event.clientY), Math.max(start.y, event.clientY)];
    const rows = [...canvas.current.querySelectorAll<HTMLElement>(".tl-lane[data-track]")].filter((row) => {
      const bounds = row.getBoundingClientRect();
      return bounds.bottom > top && bounds.top < bottom;
    }).map((row) => ({ track: row.dataset.track as EditorTrack, layer: Number(row.dataset.layer) }));
    const keys = clipsInBox(clips, timeAt(start.x), timeAt(event.clientX), rows);
    const blocksHit = blocks.filter((block) => keys.some((key) => block.keys.includes(key))).flatMap((block) => block.keys);
    selectBlock([...new Set([...keys, ...blocksHit])]);
  }

  function marker() {
    const at = Math.round(playheadMs);
    const next = markers.includes(at) ? markers.filter((value) => value !== at)
      : [...markers, at].sort((a, b) => a - b).slice(0, 100);
    setMarkers(next);
    try { localStorage.setItem(markerStorage, JSON.stringify(next)); } catch { /* Storage can be unavailable. */ }
  }

  function keys(event: KeyboardEvent<HTMLElement>) {
    if (locked || (event.target instanceof HTMLElement && event.target.closest("input, select, textarea, [contenteditable=true]"))) return;
    const key = event.key.toLowerCase();
    if (event.altKey) {
      if (key === "g" && chosen.size > 1) {
        apply(() => createCompound(clips, chosen, `Compound ${compoundBlocks(clips).length + 1}`), "Đã tạo compound. Nhấp đúp để mở.");
        event.preventDefault();
      }
      return;
    }
    if (event.ctrlKey || event.metaKey) {
      if (key === "b") split(event.shiftKey);
      else if (key === "a") { setMulti(clips.map((clip) => clip.key)); onSelect(clips[0]?.key ?? null); }
      else if (key === "g") onChange(groupSelection(clips, chosen, event.shiftKey));
      else if (key === "c" && event.shiftKey && selected) attributes.current = copyAttributes(selected);
      else if (key === "v" && event.shiftKey && attributes.current && chosen.size) apply(() => pasteAttributes(clips, chosen, attributes.current!), "Đã dán thuộc tính.");
      else if (key === "c" || key === "x") copy(key === "x");
      else if (key === "v") paste();
      else if (key === "d" && chosen.size) {
        clipboard.current = clips.filter((clip) => chosen.has(clip.key));
        paste(Math.max(...clipboard.current.map(clipFinish)));
      } else if (key === "r" && selected && selected.track !== "text") {
        props.onSmart("speed", selected.key);
      } else if (key === "s" && event.shiftKey && selected) {
        apply(() => selected.look?.audioDetached ? restoreAudio(clips, selected.key) : detachAudio(clips, selected.key));
      } else return;
      event.preventDefault();
      return;
    }
    const camera = selected?.look?.multicam;
    if (camera !== undefined && /^[1-9]$/.test(event.key)) {
      apply(() => switchAngle(clips, camera, Number(event.key) - 1, playheadMs));
      event.preventDefault();
      return;
    }
    if (event.key === "Delete" || event.key === "Backspace") remove();
    else if (key === "v" && chosen.size) apply(() => setDisabled(clips, chosen, !clips.some((clip) => chosen.has(clip.key) && clip.look?.disabled)));
    else if (key === "s") split();
    else if (key === "b" && event.shiftKey && selected && selected.track !== "text") props.onSmart("speed", selected.key);
    else if ((key === "q" || key === "w") && !event.shiftKey) {
      // Delete the part of the clip before (Q) or after (W) the playhead and close the gap.
      const target = selected && clipsAt([selected], playheadMs).length ? selected
        : clipsAt(clips, playheadMs).find((clip) => clip.track === "video" && layerOf(clip) === 0);
      if (target && !clipLane(laneControls, target)?.locked) {
        apply(() => key === "q"
          ? trimClip(clips, target.key, "start", playheadMs - target.positionMs, true, linkage)
          : trimClip(clips, target.key, "end", playheadMs - clipFinish(target), true, linkage));
      }
    }
    else if (key === "a") setTool("select");
    else if (key === "b") setTool("split");
    else if (key === "[") setTool("left");
    else if (key === "]") setTool("right");
    else if (key === "p") setMagnet(!magnet);
    else if (key === "n") setSnapping(!snapping);
    else if (key === "~") setLinkage(!linkage);
    else if (key === "i") props.onRange("start");
    else if (key === "o") props.onRange("end");
    else if (key === "m" && event.shiftKey) {
      const next = markers.find((value) => value > playheadMs && value <= total);
      if (next !== undefined) onPlayhead(next);
    }
    else if (key === "m") marker();
    else if (key === "z" && event.shiftKey) fit();
    else if (event.key === "ArrowLeft" || event.key === "ArrowRight") {
      const direction = event.key === "ArrowLeft" ? -1 : 1;
      if (event.shiftKey && selected) nudge(selected, direction * 100);
      else onPlayhead(Math.round((Math.round(playheadMs * 30 / 1000) + direction) * 1000 / 30));
    }
    else if (event.key === "ArrowUp" || event.key === "ArrowDown") {
      const edges = clips.flatMap((clip) => [clip.positionMs, clipFinish(clip)]);
      onPlayhead(event.key === "ArrowUp" ? Math.max(0, ...edges.filter((at) => at < playheadMs))
        : Math.min(total, ...edges.filter((at) => at > playheadMs)));
    }
    else if (key === "home" || key === "end") onPlayhead(key === "home" ? 0 : total);
    else if (key === " " && !(event.target instanceof HTMLButtonElement)) props.onPlay();
    else return;
    event.preventDefault();
  }

  function fit() {
    zoomTo(Math.max(1, viewport.width - 16) / (total + 1000), 0, 0);
    if (scroll.current) scroll.current.scrollLeft = 0;
  }

  function ghost(track: EditorTrack, layer: number) {
    if (pending?.lane.track !== track || pending.lane.layer !== layer) return null;
    return <div className="tl-drop-ghost" style={{ left: pending.at * scale, width: Math.max(6, pending.length * scale) }} aria-hidden="true">{pending.name}</div>;
  }

  const showOverlaySlot = overlayLayer > 0 && overlayLayer < MAX_LAYERS;

  return (
    <section ref={editor} tabIndex={-1} className={`panel timeline${nativeOver ? " native-over" : ""}`} aria-labelledby="timeline-heading" onKeyDown={keys}>
      <div className="panel-head">
        <div>
          <div className="panel-title"><Icon name="timeline" /><h2 id="timeline-heading">{vi.timeline}</h2></div>
          <p>{project ? vi.timelineHint : vi.noProjectTimeline}</p>
        </div>
        {project && <span className="count-pill project-pill" title={project.name}>{project.name}</span>}
      </div>

      <div className="tl-toolbar" role="toolbar" aria-label={vi.timelineTools}>
        <button type="button" id="timeline-undo" className="icon-button" title={vi.undo} aria-label={vi.undo}
          disabled={locked || !props.canUndo} onClick={props.onUndo}><Icon name="undo" size={16} /></button>
        <button type="button" id="timeline-redo" className="icon-button" title={vi.redo} aria-label={vi.redo}
          disabled={locked || !props.canRedo} onClick={props.onRedo}><Icon name="redo" size={16} /></button>
        <select className="tl-tool" aria-label="Công cụ con trỏ" value={tool} onChange={(event) => setTool(event.target.value as Tool)}>
          <option value="select">Chọn (A)</option><option value="split">Dao cắt (B)</option>
          <option value="left">Chọn sang trái ([)</option><option value="right">Chọn sang phải (])</option>
        </select>
        <button type="button" className="button secondary compact" title="Tách tại playhead (Ctrl+B)"
          disabled={locked || !cuts.some((clip) => canSplit(clip, playheadMs))} onClick={() => split()}>
          <Icon name="split" size={16} />{vi.split}
        </button>
        <button type="button" className="button secondary compact danger" disabled={locked || !selected} onClick={remove}>
          <Icon name="trash" size={16} />{vi.removeClip}
        </button>
        <span className="tl-time" aria-live="off">{frameTimecode(playheadMs)} / {frameTimecode(total)}</span>
        <span className={`tl-save ${props.saveState}`}>{project ? vi.saveState[props.saveState] : ""}</span>
        <button type="button" className="icon-button" aria-pressed={magnet} aria-label="Dồn clip" title="Dồn clip trên Video 1 sau khi trim hoặc xóa (P)"
          onClick={() => setMagnet(!magnet)}><Icon name="magnet" size={15} /></button>
        <button type="button" className="icon-button" aria-pressed={snapping} aria-label="Hít mép" title="Hít vào playhead và mép clip (N)"
          onClick={() => setSnapping(!snapping)}><Icon name="snap" size={15} /></button>
        <button type="button" className="icon-button" aria-pressed={linkage} aria-label="Liên kết" title="Dịch các lớp phía sau theo Video 1 khi dồn clip (~)"
          onClick={() => setLinkage(!linkage)}><Icon name="link" size={15} /></button>
        <div className="tl-zoom" role="group" aria-label="Thu phóng timeline">
          <button type="button" className="icon-button" title={vi.zoomOut} aria-label={vi.zoomOut}
            disabled={scale <= MIN_SCALE} onClick={() => zoomTo(scale / 1.5)}><Icon name="zoomOut" size={16} /></button>
          <input type="range" min={0} max={100} value={zoomPercent} aria-label="Thu phóng timeline"
            title="Kéo thanh hoặc giữ Ctrl / ⌘ và cuộn chuột trên timeline"
            onChange={(event) => zoomTo(MIN_SCALE * (MAX_SCALE / MIN_SCALE) ** (Number(event.currentTarget.value) / 100))} />
          <button type="button" className="icon-button" title={vi.zoomIn} aria-label={vi.zoomIn}
            disabled={scale >= MAX_SCALE} onClick={() => zoomTo(scale * 1.5)}><Icon name="zoomIn" size={16} /></button>
          <button type="button" className="button secondary compact" title="Hiện toàn bộ timeline"
            disabled={!total} onClick={fit}>Vừa khung</button>
        </div>
        <button type="button" className="button secondary compact" disabled={locked || total === 0} aria-label="Thêm vào hàng đợi xuất"
          onClick={() => props.onExport(true)}>Xếp hàng</button>
        <button type="button" className="button primary compact" disabled={locked || total === 0} aria-label="Xuất và chạy hàng đợi"
          onClick={() => props.onExport(false)}><Icon name="export" size={16} />Xuất</button>
      </div>
      <div className="tl-toolbar layer-toolbar">
        {kinds.map((track) => <button key={track} type="button" className="button secondary compact"
          disabled={locked || layerCount(track) >= MAX_LAYERS} onClick={() => addLane(track)}>+ Tầng {label[track].toLowerCase()}</button>)}
        <button type="button" className="button secondary compact" disabled={locked} onClick={props.onTitle}>+ Chữ tại playhead</button>
        <button type="button" className="button secondary compact" disabled={locked}
          onClick={() => apply(() => addAdjustment(clips, playheadMs, lane.track === "text" ? lane.layer : 0), "Đã thêm lớp điều chỉnh. Chỉnh màu trong Thuộc tính.")}>+ Lớp điều chỉnh</button>
        <button type="button" className="button secondary compact" disabled={locked || chosen.size < 2}
          onClick={() => onChange(groupSelection(clips, chosen))}>Nhóm</button>
        <button type="button" className="button secondary compact" disabled={locked || !clips.some((clip) => chosen.has(clip.key) && groupOf(clip))}
          onClick={() => onChange(groupSelection(clips, chosen, true))}>Bỏ nhóm</button>
        <button type="button" className="button secondary compact" disabled={locked || !total} onClick={marker} title="Thêm/gỡ marker tại playhead (M)">Marker</button>
        <button type="button" className="button secondary compact" disabled={locked || !total} onClick={() => props.onRange("start")} title="Đặt điểm In (I)">In</button>
        <button type="button" className="button secondary compact" disabled={locked || !total} onClick={() => props.onRange("end")} title="Đặt điểm Out (O)">Out</button>
        {props.range && <button type="button" className="button secondary compact" onClick={() => props.onRange("clear")}>
          {timecode(props.range.startMs)}–{timecode(props.range.endMs)} · Bỏ vùng</button>}
        {chosen.size > 1 && <span className="tl-selection">{chosen.size} clip được chọn</span>}
        <span className="tl-save">{label[lane.track]} {lane.layer + 1} đang chọn</span>
      </div>

      {focus && <div className="tl-breadcrumb" role="navigation" aria-label="Timeline con">
        <button type="button" className="button secondary compact" onClick={() => { setFocus(null); setMulti([]); }}>← Timeline chính</button>
        <span>Compound <strong>{focus.name}</strong> · chỉ hiện và sửa các clip trong compound</span>
      </div>}
      <div className="tl" ref={scroll} onScroll={measure}>
        <div className="tl-labels" ref={labels}>
          <div className="tl-corner" />
          {lanes.map((target) => {
            const control = laneControl(laneControls, target.track, target.layer);
            const name = `${label[target.track]} ${target.layer + 1}`;
            return <div className="tl-track-label" key={laneKey(target)}>
              {showOverlaySlot && target.track === "video" && target.layer === overlayLayer - 1 && <div className="tl-overlay-slot" aria-hidden="true" />}
              <div className="tl-track-header" data-track={target.track} data-layer={target.layer} onContextMenu={(event) => laneMenu(event, target)}>
                <button type="button" className="track-name" disabled={locked}
                  aria-pressed={laneKey(lane) === laneKey(target)} onClick={() => props.onLane(target)}>
                  <Icon name={target.track === "text" ? "text" : target.track} size={13} />{name}
                </button>
                <div className="tl-track-controls">
                  <button type="button" disabled={locked} aria-pressed={!!control?.locked} title={`Khóa tầng ${name}`}
                    aria-label={`Khóa tầng ${name}`} onClick={() => props.onLaneControl(target, "locked")}>
                    <Icon name={control?.locked ? "lock" : "unlock"} size={13} />
                  </button>
                  {target.track !== "audio" && <button type="button" disabled={locked} aria-pressed={!!control?.hidden} title={`Ẩn hình tầng ${name}`}
                    aria-label={`Ẩn hình tầng ${name}`} onClick={() => props.onLaneControl(target, "hidden")}>
                    <Icon name={control?.hidden ? "eyeOff" : "eye"} size={13} />
                  </button>}
                  {target.track !== "text" && <button type="button" disabled={locked} aria-pressed={!!control?.muted} title={`Tắt tiếng tầng ${name}`}
                    aria-label={`Tắt tiếng tầng ${name}`} onClick={() => props.onLaneControl(target, "muted")}>
                    <Icon name={control?.muted ? "muted" : "speaker"} size={13} />
                  </button>}
                </div>
              </div>
            </div>;
          })}
          <div className="tl-below" aria-hidden="true" />
        </div>
          <div className="tl-canvas" ref={canvas} style={{ width }} onContextMenu={canvasMenu}
            onPointerMove={(event) => {
              if (boxStart.current) { setBox(boxRect(event)); return; }
              if (!drag.current) return;
              const next = dragResult(event);
              setDraft(changesLockedLane(clips, next, laneControls) ? null : next);
            }}
            onPointerUp={(event) => { if (boxStart.current) finishBox(event); else finish(event); }}
            onPointerCancel={() => { boxStart.current = null; setBox(null); cancelDrag(); }}
            onLostPointerCapture={() => { if (!boxStart.current) cancelDrag(); }}>
            <div className="tl-ruler"
              onPointerDown={(event) => {
                if (event.button !== 0) return;
                editor.current?.focus({ preventScroll: true });
                event.currentTarget.setPointerCapture(event.pointerId);
                onPlayhead(timeAt(event.clientX));
              }}
              onPointerMove={(event) => {
                if (event.currentTarget.hasPointerCapture(event.pointerId)) onPlayhead(timeAt(event.clientX));
              }}>
              {Array.from({ length: Math.max(0, tickCount) }, (_, offset) => {
                const at = (offset + firstTick) * tick;
                return <span key={at} style={{ left: at * scale }}>{timecode(at)}</span>;
              })}
              <div className="tl-playhead-tab" style={{ left: playheadMs * scale }} aria-hidden="true" />
              {markers.filter((at) => at <= total).map((at) => <button type="button" className="tl-marker" key={at}
                title={`Marker ${timecode(at)}`} aria-label={`Tới marker ${timecode(at)}`} style={{ left: at * scale }}
                onPointerDown={(event) => event.stopPropagation()} onClick={() => onPlayhead(at)} />)}
            </div>
            {lanes.map((target) => {
              const { track, layer } = target;
              const control = laneControl(laneControls, track, layer);
              const items = shown.filter((clip) => clip.track === track && layerOf(clip) === layer && !folded.has(clip.key));
              const laneBlocks = blocks.filter((block) => block.track === track && block.layer === layer);
              return <div key={laneKey(target)}>
                {showOverlaySlot && track === "video" && layer === overlayLayer - 1 && <div className="tl-overlay-slot" aria-hidden="true">{ghost("video", overlayLayer)}</div>}
                <div className={`tl-lane ${track}${track === "video" && layer === 0 ? " main-track" : ""}${control?.locked ? " locked-lane" : ""}${control?.hidden || (control?.muted && track === "audio") ? " inactive-lane" : ""}`} data-track={track} data-layer={layer}
                onPointerDown={(event) => {
                  if (event.target === event.currentTarget) {
                    editor.current?.focus({ preventScroll: true }); props.onLane(target); setMulti([]); onSelect(null);
                    beginBox(event);
                  }
                }}>
                {laneBlocks.map((block) => <div key={`compound-${block.id}`} role="button" tabIndex={0}
                  className={`tl-clip compound ${block.keys.some((key) => chosen.has(key)) ? "selected" : ""}`}
                  style={{ left: block.start * scale, width: Math.max((block.end - block.start) * scale, 6) }}
                  aria-label={`Compound ${block.name}, ${block.keys.length} clip, nhấp đúp để mở`} title={`${block.name} · nhấp đúp để mở`}
                  onContextMenu={(event) => { const first = clips.find((clip) => clip.key === block.keys[0]); if (first) { selectBlock(block.keys); clipMenu(event, first); } }}
                  onPointerDown={(event) => {
                    if (locked || event.button !== 0) return;
                    event.stopPropagation();
                    editor.current?.focus({ preventScroll: true });
                    if (doublePress(`block-${block.id}`)) { setExpanded((current) => new Set([...current, block.id])); return; }
                    selectBlock(block.keys);
                    canvas.current?.setPointerCapture(event.pointerId);
                    drag.current = { key: block.keys[0], keys: new Set(block.keys), mode: "move", at: timeAt(event.clientX), x: event.clientX, y: event.clientY, pointer: event.pointerId };
                  }}>
                  <span className="tl-clip-name">▣ {block.name}</span>
                  <small>{block.keys.length} clip · {timecode(block.end - block.start)}</small>
                </div>)}
                {!items.length && !laneBlocks.length && track === "video" && layer === 0 && <span className="track-empty"><Icon name="video" size={14} />Kéo media hoặc tệp vào đây để dựng</span>}
                {ghost(track, layer)}
                {items.map((clip) => {
                  const name = clip.title?.text ?? fileName(clip.relativePath);
                  const previous = clip.look?.transition ? previousVisual(shown, clip) : undefined;
                  const join = previous && transitionBetween(previous, clip);
                  const [fadeIn, fadeOut] = track === "audio" ? audioFades(clip) : [0, 0];
                  return <div key={clip.key} role="button" tabIndex={0} aria-pressed={chosen.has(clip.key)}
                    aria-label={vi.clipLabel(name, timecode(clip.positionMs), timecode(clipLength(clip)))}
                    className={`tl-clip ${track} ${chosen.has(clip.key) ? "selected" : ""} ${clip.available ? "" : "offline"}${clip.look?.disabled ? " disabled-clip" : ""}${clip.kind === "adjustment" ? " adjustment" : ""}${compoundOf(clip) ? " in-compound" : ""}`}
                    style={{ left: clip.positionMs * scale, width: Math.max(clipLength(clip) * scale, 6) }}
                    title={clip.available ? clip.relativePath : vi.unavailable}
                    onKeyDown={(event) => { if (event.key === "Enter") { setMulti([]); onSelect(clip.key); } }}
                    onPointerDown={(event) => {
                      const compound = compoundOf(clip);
                      if (compound && event.button === 0 && doublePress(clip.key)) {
                        event.stopPropagation();
                        setExpanded((current) => { const next = new Set(current); next.delete(compound.id); return next; });
                        return;
                      }
                      begin(event, clip, "move");
                    }}
                    onContextMenu={(event) => clipMenu(event, clip)}>
                    <span className="tl-handle start" aria-hidden="true"
                      onPointerDown={(event) => begin(event, clip, "start")} />
                    {clip.available && (clip.hasThumbnail || clip.kind === "video") && <span className="tl-clip-art" aria-hidden="true"
                      style={clip.hasThumbnail ? { backgroundImage: `url("${mediaUrl("thumbnail", clip.assetId, props.revision)}")` } : undefined}>
                      {clip.kind === "video" && !!clip.sourceMs && <img src={mediaUrl("filmstrip", clip.assetId, props.revision)} alt="" loading="lazy" draggable={false}
                        style={{ width: `${100 * clip.sourceMs / (clip.endMs - clip.startMs)}%`, left: `${-100 * clip.startMs / (clip.endMs - clip.startMs)}%` }}
                        onError={(event) => { event.currentTarget.style.visibility = "hidden"; }}
                        onLoad={(event) => { event.currentTarget.style.visibility = "visible"; }} />}
                    </span>}
                    {clip.available && (clip.kind === "audio" || clip.kind === "video") && !!clip.sourceMs && <span className="tl-waveform"
                      aria-hidden="true"><img src={mediaUrl("waveform", clip.assetId, props.revision)} alt="" loading="lazy" draggable={false}
                        style={{ width: `${100 * clip.sourceMs / (clip.endMs - clip.startMs)}%`,
                          left: `${-100 * clip.startMs / (clip.endMs - clip.startMs)}%` }}
                        onError={(event) => { event.currentTarget.style.visibility = "hidden"; }}
                        onLoad={(event) => { event.currentTarget.style.visibility = "visible"; }} /></span>}
                    <span className="tl-clip-name">{name}</span>
                    <small>{clip.available ? timecode(clipLength(clip)) : vi.unavailable}</small>
                    {join && <span className="tl-transition" title={`Chuyển cảnh ${join.durationMs} ms`}>⋈</span>}
                    {clip.look?.keyframes?.map((key) => <span className="tl-keyframe" key={key.atMs}
                      title={`Keyframe ${timecode(key.atMs)}`} style={{ left: key.atMs * scale }} />)}
                    {groupOf(clip) && <span className="tl-group-badge" title={`Nhóm ${groupOf(clip)}`}>↔</span>}
                    <span className="tl-badges">
                    {(clip.look?.audioDetached || clip.look?.audioLink !== undefined) && <span className="tl-badge" title={clip.track === "audio" ? "Âm thanh đã tách từ video" : "Âm thanh đã tách"}>{clip.track === "audio" ? "⛓" : "🔇"}</span>}
                    {clip.look?.multicam !== undefined && <span className="tl-badge" title="Góc máy multicam">🎥{multicamAngles(shown, clip.look.multicam).indexOf(layerOf(clip)) + 1}</span>}
                    {hasCurve(clip) && <span className="tl-badge" title="Đường cong tốc độ">⏱</span>}
                    {clip.look?.reverse && <span className="tl-badge" title="Đảo ngược">⇄</span>}
                    {clip.look?.freezeAtMs !== undefined && <span className="tl-badge" title="Khung hình tĩnh">❄</span>}
                    {clip.look?.lut !== undefined && <span className="tl-badge" title="Có LUT">◐</span>}
                    {compoundOf(clip) && <span className="tl-badge" title={`Thuộc compound ${compoundOf(clip)!.name}`}>▣</span>}</span>
                    {fadeIn > 0 && <span className="tl-fade in" aria-hidden="true" style={{ width: fadeIn * scale }} />}
                    {fadeOut > 0 && <span className="tl-fade out" aria-hidden="true" style={{ width: fadeOut * scale }} />}
                    {track === "audio" && <span className="tl-fade-knob in" title={`Fade vào ${fadeIn} ms · kéo để chỉnh`} style={{ left: fadeIn * scale }}
                      onPointerDown={(event) => begin(event, clip, "fadeIn")} />}
                    {track === "audio" && <span className="tl-fade-knob out" title={`Fade ra ${fadeOut} ms · kéo để chỉnh`} style={{ right: fadeOut * scale }}
                      onPointerDown={(event) => begin(event, clip, "fadeOut")} />}
                    <span className="tl-handle end" aria-hidden="true"
                      onPointerDown={(event) => begin(event, clip, "end")} />
                  </div>;
                })}
                </div>
              </div>;
            })}
            <div className="tl-below" aria-hidden="true">{nextAudioLayer > 0 && nextAudioLayer < MAX_LAYERS && ghost("audio", nextAudioLayer)}</div>
            <div className="tl-playhead" style={{ left: playheadMs * scale }} aria-hidden="true" />
            {box && <div className="tl-box" aria-hidden="true" style={box} />}
            {props.range && props.range.endMs > props.range.startMs && <div className="tl-export-range" aria-hidden="true"
              style={{ left: props.range.startMs * scale, width: (props.range.endMs - props.range.startMs) * scale }} />}
          </div>
      </div>

      {menu && <ContextMenu menu={menu} onClose={() => setMenu(null)} />}
    </section>
  );
}
