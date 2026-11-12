import { useEffect, useEffectEvent, useImperativeHandle, useLayoutEffect, useRef, useState } from "react";
import type { KeyboardEvent, PointerEvent, Ref } from "react";
import { fileName, mediaUrl } from "./desktop";
import type { EditorTrack, ExportRange, LaneControl, Project } from "./desktop";
import { Icon } from "./Icon";
import {
  MAX_LAYERS, MAX_TIMELINE_MS, audioFades, canSplit, changesLockedLane, clipFinish, clipLane, clipLength, clipsAt, deleteSelection, groupOf, groupSelection,
  laneControl, layerOf, mediaDropPlacement, moveClip, moveSelection, pasteSelection, previousVisual, snap, splitClip, totalMs, transitionBetween, trimClip,
} from "./timeline";
import type { Clip, MediaDropTarget, MediaRef } from "./timeline";
import { frameTimecode, timecode, vi } from "./vi";

const MIN_SCALE = 0.00002;
const MAX_SCALE = 0.96;
const TICKS = [100, 200, 500, 1000, 2000, 5000, 10_000, 30_000, 60_000, 120_000, 300_000, 600_000, 1_800_000, 3_600_000];
const SNAP_PX = 8;
type Mode = "move" | "start" | "end";
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
}

export type Lane = { track: EditorTrack; layer: number };
export interface TimelineDrop {
  media: (item: MediaRef, clientX: number, clientY: number, commit: boolean) => void;
  clear: () => void;
  target: (x: number, y: number) => MediaDropTarget | null;
  hover: (x?: number, y?: number) => void;
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
  const drag = useRef<{ key: string; keys: ReadonlySet<string>; mode: Mode; at: number; x: number; y: number; pointer: number } | null>(null);
  const scroll = useRef<HTMLDivElement>(null);
  const editor = useRef<HTMLElement>(null);
  const canvas = useRef<HTMLDivElement>(null);
  const labels = useRef<HTMLDivElement>(null);
  const scrollAfterZoom = useRef<number | null>(null);
  const shown = draft ?? clips;
  const total = totalMs(shown);
  const width = Math.max(viewport.width, Math.round(Math.max(total + 1000, (pending?.at ?? 0) + (pending?.length ?? 0)) * scale));
  const tick = TICKS.find((ms) => ms * scale >= 64) ?? TICKS.at(-1)!;
  const firstTick = Math.floor(viewport.left / (tick * scale));
  const tickCount = Math.min(Math.floor(width / (tick * scale)) - firstTick + 1, Math.ceil(viewport.width / (tick * scale)) + 2);
  const zoomPercent = Math.round(100 * Math.log(scale / MIN_SCALE) / Math.log(MAX_SCALE / MIN_SCALE));
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

  function marker() {
    const at = Math.round(playheadMs);
    const next = markers.includes(at) ? markers.filter((value) => value !== at)
      : [...markers, at].sort((a, b) => a - b).slice(0, 100);
    setMarkers(next);
    try { localStorage.setItem(markerStorage, JSON.stringify(next)); } catch { /* Storage can be unavailable. */ }
  }

  function keys(event: KeyboardEvent<HTMLElement>) {
    if (locked || event.altKey || (event.target instanceof HTMLElement && event.target.closest("input, select, textarea, [contenteditable=true]"))) return;
    const key = event.key.toLowerCase();
    if (event.ctrlKey || event.metaKey) {
      if (key === "b") split(event.shiftKey);
      else if (key === "a") { setMulti(clips.map((clip) => clip.key)); onSelect(clips[0]?.key ?? null); }
      else if (key === "g") onChange(groupSelection(clips, chosen, event.shiftKey));
      else if (key === "c" || key === "x") {
        clipboard.current = clips.filter((clip) => chosen.has(clip.key));
        if (key === "x") remove();
      } else if (key === "v") {
        const next = pasteSelection(clips, clipboard.current, playheadMs);
        if (next !== clips && onChange(next)) {
          setMulti(next.slice(clips.length).map((clip) => clip.key));
          onSelect(next[clips.length].key);
        }
      } else return;
      event.preventDefault();
      return;
    }
    if (event.key === "Delete" || event.key === "Backspace") remove();
    else if (key === "s") split();
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

      <div className="tl" ref={scroll} onScroll={measure}>
        <div className="tl-labels" ref={labels}>
          <div className="tl-corner" />
          {lanes.map((target) => {
            const control = laneControl(laneControls, target.track, target.layer);
            const name = `${label[target.track]} ${target.layer + 1}`;
            return <div className="tl-track-label" key={laneKey(target)}>
              {showOverlaySlot && target.track === "video" && target.layer === overlayLayer - 1 && <div className="tl-overlay-slot" aria-hidden="true" />}
              <div className="tl-track-header" data-track={target.track} data-layer={target.layer}>
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
          <div className="tl-canvas" ref={canvas} style={{ width }}
            onPointerMove={(event) => {
              if (!drag.current) return;
              const next = dragResult(event);
              setDraft(changesLockedLane(clips, next, laneControls) ? null : next);
            }}
            onPointerUp={finish} onPointerCancel={cancelDrag} onLostPointerCapture={cancelDrag}>
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
              const items = shown.filter((clip) => clip.track === track && layerOf(clip) === layer);
              return <div key={laneKey(target)}>
                {showOverlaySlot && track === "video" && layer === overlayLayer - 1 && <div className="tl-overlay-slot" aria-hidden="true">{ghost("video", overlayLayer)}</div>}
                <div className={`tl-lane ${track}${track === "video" && layer === 0 ? " main-track" : ""}${control?.locked ? " locked-lane" : ""}${control?.hidden || (control?.muted && track === "audio") ? " inactive-lane" : ""}`} data-track={track} data-layer={layer}
                onPointerDown={(event) => {
                  if (event.target === event.currentTarget) {
                    editor.current?.focus({ preventScroll: true }); props.onLane(target); setMulti([]); onSelect(null);
                  }
                }}>
                {!items.length && track === "video" && layer === 0 && <span className="track-empty"><Icon name="video" size={14} />Kéo media hoặc tệp vào đây để dựng</span>}
                {ghost(track, layer)}
                {items.map((clip) => {
                  const name = clip.title?.text ?? fileName(clip.relativePath);
                  const previous = clip.look?.transition ? previousVisual(shown, clip) : undefined;
                  const join = previous && transitionBetween(previous, clip);
                  const [fadeIn, fadeOut] = track === "audio" ? audioFades(clip) : [0, 0];
                  return <div key={clip.key} role="button" tabIndex={0} aria-pressed={chosen.has(clip.key)}
                    aria-label={vi.clipLabel(name, timecode(clip.positionMs), timecode(clipLength(clip)))}
                    className={`tl-clip ${track} ${chosen.has(clip.key) ? "selected" : ""} ${clip.available ? "" : "offline"}`}
                    style={{ left: clip.positionMs * scale, width: Math.max(clipLength(clip) * scale, 6) }}
                    title={clip.available ? clip.relativePath : vi.unavailable}
                    onKeyDown={(event) => { if (event.key === "Enter") { setMulti([]); onSelect(clip.key); } }}
                    onPointerDown={(event) => begin(event, clip, "move")}>
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
                    {fadeIn > 0 && <span className="tl-fade in" aria-hidden="true" style={{ width: fadeIn * scale }} />}
                    {fadeOut > 0 && <span className="tl-fade out" aria-hidden="true" style={{ width: fadeOut * scale }} />}
                    <span className="tl-handle end" aria-hidden="true"
                      onPointerDown={(event) => begin(event, clip, "end")} />
                  </div>;
                })}
                </div>
              </div>;
            })}
            <div className="tl-below" aria-hidden="true">{nextAudioLayer > 0 && nextAudioLayer < MAX_LAYERS && ghost("audio", nextAudioLayer)}</div>
            <div className="tl-playhead" style={{ left: playheadMs * scale }} aria-hidden="true" />
            {props.range && props.range.endMs > props.range.startMs && <div className="tl-export-range" aria-hidden="true"
              style={{ left: props.range.startMs * scale, width: (props.range.endMs - props.range.startMs) * scale }} />}
          </div>
      </div>

    </section>
  );
}
