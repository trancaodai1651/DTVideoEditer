import { useEffect, useEffectEvent, useImperativeHandle, useLayoutEffect, useRef, useState } from "react";
import type { KeyboardEvent, PointerEvent, Ref } from "react";
import { fileName, mediaUrl } from "./desktop";
import type { EditorTrack, Project } from "./desktop";
import { Icon } from "./Icon";
import {
  MAX_LAYERS, MAX_TIMELINE_MS, MIN_CLIP_MS, canSplit, clipFinish, clipLength, clipsAt, layerOf, mediaLength, moveClip, place, removeClip, snap, splitClip, totalMs, trackOf, trimEnd, trimStart,
} from "./timeline";
import type { Clip, MediaRef } from "./timeline";
import { timecode, vi } from "./vi";

const MIN_SCALE = 0.00002;
const MAX_SCALE = 0.96;
const TICKS = [100, 200, 500, 1000, 2000, 5000, 10_000, 30_000, 60_000, 120_000, 300_000, 600_000, 1_800_000, 3_600_000];
const SNAP_PX = 8;
type Mode = "move" | "start" | "end";
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
  onChange: (clips: Clip[]) => void;
  onSelect: (key: string | null) => void;
  onPlayhead: (ms: number) => void;
  onDropMedia: (media: MediaRef, positionMs: number, lane: Lane) => void;
  onLane: (lane: Lane) => void;
  onTitle: () => void;
  onUndo: () => void;
  onRedo: () => void;
  onExport: (queueOnly: boolean) => void;
}

export type Lane = { track: EditorTrack; layer: number };
export interface TimelineDrop {
  media: (item: MediaRef, clientX: number, clientY: number, commit: boolean) => void;
  clear: () => void;
}
const kinds = ["text", "video", "audio"] as const;
const label = { text: "Chữ", video: "Video", audio: "Âm thanh" };
const laneKey = ({ track, layer }: Lane) => `${track}-${layer}`;

export function TimelineEditor(props: Props) {
  const { project, clips, selectedKey, playheadMs, busy, lane, onChange, onSelect, onPlayhead } = props;
  const [scale, setScale] = useState(0.06);
  const [snapping, setSnapping] = useState(true);
  const [draft, setDraft] = useState<Clip[] | null>(null);
  const [pending, setPending] = useState<{ lane: Lane; at: number; length: number; name: string } | null>(null);
  const [viewport, setViewport] = useState({ width: 600, left: 0 });
  const [extra, setExtra] = useState({ text: 1, video: 1, audio: 1 });
  const drag = useRef<{ key: string; mode: Mode; at: number; x: number; y: number; pointer: number } | null>(null);
  const scroll = useRef<HTMLDivElement>(null);
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
  const cuts = selected && clipsAt([selected], playheadMs).length ? [selected] : clipsAt(clips, playheadMs);
  const locked = busy || !project;
  const layerCount = (track: EditorTrack) => clips.filter((clip) => clip.track === track)
    .reduce((count, clip) => Math.max(count, layerOf(clip) + 1), extra[track]);
  const lanes = kinds.flatMap((track) => {
    const count = layerCount(track);
    return Array.from({ length: count }, (_, i) => ({ track, layer: track === "audio" ? i : count - i - 1 }));
  });
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

  function snapped(wanted: number, length: number, target: Lane, key?: string) {
    if (!snapping) return wanted;
    const edges = [0, playheadMs, ...clips.filter((clip) => clip.key !== key && clip.track === target.track && layerOf(clip) === target.layer)
      .flatMap((clip) => [clip.positionMs, clipFinish(clip)])];
    const tolerance = SNAP_PX / scale;
    const head = snap(wanted, edges, tolerance);
    return head !== wanted ? head : snap(wanted + length, edges, tolerance) - length;
  }

  useImperativeHandle(props.ref, () => ({
    clear: () => setPending(null),
    media(item, x, y, commit) {
      const length = mediaLength(item);
      const target = locked || !length || length < MIN_CLIP_MS ? null : laneAt(x, y, trackOf(item.kind));
      if (!target || !length) { setPending(null); return; }
      const at = place(clips, target.track, length, Math.min(snapped(timeAt(x), length, target), MAX_TIMELINE_MS - length), undefined, target.layer);
      if (at + length > MAX_TIMELINE_MS) { setPending(null); return; }
      if (commit) {
        setPending(null);
        props.onDropMedia(item, at, target);
      } else {
        setPending({ lane: target, at, length, name: fileName(item.relativePath) });
      }
    },
  }));

  function begin(event: PointerEvent<HTMLElement>, clip: Clip, mode: Mode) {
    if (locked || event.button !== 0) return;
    event.stopPropagation();
    canvas.current?.setPointerCapture(event.pointerId);
    onSelect(clip.key);
    drag.current = { key: clip.key, mode, at: timeAt(event.clientX), x: event.clientX, y: event.clientY, pointer: event.pointerId };
  }

  function dragResult(event: PointerEvent<HTMLElement>) {
    const active = drag.current;
    if (!active || locked || active.pointer !== event.pointerId) return clips;
    const clip = clips.find((item) => item.key === active.key);
    if (!clip || Math.hypot(event.clientX - active.x, event.clientY - active.y) < 3) return clips;
    const delta = timeAt(event.clientX) - active.at;
    if (active.mode === "move") {
      const target = laneAt(event.clientX, event.clientY, clip.track);
      return target ? moveClip(clips, clip.key, snapped(clip.positionMs + delta, clipLength(clip), target, clip.key), target.layer) : clips;
    }
    return (active.mode === "start" ? trimStart : trimEnd)(clips, clip.key, delta);
  }

  function finish(event: PointerEvent<HTMLElement>) {
    if (drag.current?.pointer !== event.pointerId) return;
    const key = drag.current.key;
    const next = dragResult(event);
    cancelDrag();
    if (next === clips) return;
    onChange(next);
    const moved = next.find((clip) => clip.key === key)!;
    props.onLane({ track: moved.track, layer: layerOf(moved) });
  }

  function cancelDrag() {
    drag.current = null;
    setDraft(null);
  }

  function split() {
    const next = cuts.reduce<Clip[]>((current, clip) => splitClip(current, clip.key, playheadMs) ?? current, clips);
    if (next !== clips) onChange(next);
  }

  function remove() {
    if (!selected || locked) return;
    onChange(removeClip(clips, selected.key));
    onSelect(null);
  }

  function nudge(clip: Clip, deltaMs: number) {
    const next = moveClip(clips, clip.key, clip.positionMs + deltaMs);
    if (next !== clips) onChange(next);
  }

  function keys(event: KeyboardEvent<HTMLElement>) {
    if (locked || event.ctrlKey || event.metaKey || event.altKey
      || event.target instanceof HTMLInputElement || event.target instanceof HTMLSelectElement) return;
    const step = event.shiftKey ? 1000 : 100;
    if (event.key === "Delete" || event.key === "Backspace") remove();
    else if (event.key.toLowerCase() === "s") split();
    else if (event.key === "ArrowLeft" && selected) nudge(selected, -step);
    else if (event.key === "ArrowRight" && selected) nudge(selected, step);
    else return;
    event.preventDefault();
  }

  return (
    <section className="panel timeline" aria-labelledby="timeline-heading" onKeyDown={keys}>
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
        <button type="button" className="button secondary compact" title={vi.splitHint}
          disabled={locked || !cuts.some((clip) => canSplit(clip, playheadMs))} onClick={split}>
          <Icon name="split" size={16} />{vi.split}
        </button>
        <button type="button" className="button secondary compact danger" disabled={locked || !selected} onClick={remove}>
          <Icon name="trash" size={16} />{vi.removeClip}
        </button>
        <span className="tl-time" aria-live="off">{timecode(playheadMs)} / {timecode(total)}</span>
        <span className={`tl-save ${props.saveState}`}>{project ? vi.saveState[props.saveState] : ""}</span>
        <button type="button" className="button secondary compact" aria-pressed={snapping} title="Hít vào playhead và mép clip"
          onClick={() => setSnapping(!snapping)}>Hít mép</button>
        <div className="tl-zoom" role="group" aria-label="Thu phóng timeline">
          <button type="button" className="icon-button" title={vi.zoomOut} aria-label={vi.zoomOut}
            disabled={scale <= MIN_SCALE} onClick={() => zoomTo(scale / 1.5)}><Icon name="zoomOut" size={16} /></button>
          <input type="range" min={0} max={100} value={zoomPercent} aria-label="Thu phóng timeline"
            title="Kéo thanh hoặc giữ Ctrl / ⌘ và cuộn chuột trên timeline"
            onChange={(event) => zoomTo(MIN_SCALE * (MAX_SCALE / MIN_SCALE) ** (Number(event.currentTarget.value) / 100))} />
          <button type="button" className="icon-button" title={vi.zoomIn} aria-label={vi.zoomIn}
            disabled={scale >= MAX_SCALE} onClick={() => zoomTo(scale * 1.5)}><Icon name="zoomIn" size={16} /></button>
          <button type="button" className="button secondary compact" title="Hiện toàn bộ timeline"
            disabled={!total} onClick={() => {
              zoomTo(Math.max(1, viewport.width - 16) / (total + 1000), 0, 0);
              if (scroll.current) scroll.current.scrollLeft = 0;
            }}>Vừa khung</button>
        </div>
        <button type="button" className="button secondary compact" disabled={locked || total === 0}
          onClick={() => props.onExport(true)}>Thêm vào hàng đợi</button>
        <button type="button" className="button primary compact" disabled={locked || total === 0}
          onClick={() => props.onExport(false)}><Icon name="export" size={16} />Xuất và chạy hàng đợi</button>
      </div>
      <div className="tl-toolbar layer-toolbar">
        {kinds.map((track) => <button key={track} type="button" className="button secondary compact"
          disabled={locked || layerCount(track) >= MAX_LAYERS} onClick={() => addLane(track)}>+ Tầng {label[track].toLowerCase()}</button>)}
        <button type="button" className="button secondary compact" disabled={locked} onClick={props.onTitle}>+ Chữ tại playhead</button>
        <span className="tl-save">{label[lane.track]} {lane.layer + 1} đang chọn</span>
      </div>

      <div className="tl" ref={scroll} onScroll={measure}>
        <div className="tl-labels" ref={labels}>
          <div className="tl-corner" />
          {lanes.map((target) =>
            <button type="button" className="track-name" key={laneKey(target)} disabled={locked}
              aria-pressed={laneKey(lane) === laneKey(target)} onClick={() => props.onLane(target)}>
              <Icon name={target.track === "text" ? "library" : target.track} />{label[target.track]} {target.layer + 1}
            </button>)}
        </div>
          <div className="tl-canvas" ref={canvas} style={{ width }}
            onPointerMove={(event) => { if (drag.current) setDraft(dragResult(event)); }}
            onPointerUp={finish} onPointerCancel={cancelDrag} onLostPointerCapture={cancelDrag}>
            <div className="tl-ruler"
              onPointerDown={(event) => {
                if (event.button !== 0) return;
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
            </div>
            {lanes.map((target) => {
              const { track, layer } = target;
              const items = shown.filter((clip) => clip.track === track && layerOf(clip) === layer);
              return <div className={`tl-lane ${track}`} key={laneKey(target)} data-track={track} data-layer={layer}
                onPointerDown={(event) => {
                  if (event.target === event.currentTarget) { props.onLane(target); onSelect(null); }
                }}>
                {!items.length && <span className="track-empty">{project ? vi.dropHint : vi.noClips}</span>}
                {pending && laneKey(pending.lane) === laneKey(target) && <div className="tl-drop-ghost"
                  style={{ left: pending.at * scale, width: Math.max(6, pending.length * scale) }} aria-hidden="true">{pending.name}</div>}
                {items.map((clip) => {
                  const name = clip.title?.text ?? fileName(clip.relativePath);
                  return <div key={clip.key} role="button" tabIndex={0} aria-pressed={clip.key === selectedKey}
                    aria-label={vi.clipLabel(name, timecode(clip.positionMs), timecode(clipLength(clip)))}
                    className={`tl-clip ${track} ${clip.key === selectedKey ? "selected" : ""} ${clip.available ? "" : "offline"}`}
                    style={{ left: clip.positionMs * scale, width: Math.max(clipLength(clip) * scale, 6) }}
                    title={clip.available ? clip.relativePath : vi.unavailable}
                    onFocus={() => onSelect(clip.key)}
                    onPointerDown={(event) => begin(event, clip, "move")}>
                    <span className="tl-handle start" aria-hidden="true"
                      onPointerDown={(event) => begin(event, clip, "start")} />
                    {clip.available && clip.hasThumbnail && <span className="tl-clip-art" aria-hidden="true"
                      style={{ backgroundImage: `url("${mediaUrl("thumbnail", clip.assetId, props.revision)}")` }} />}
                    <span className="tl-clip-name">{name}</span>
                    <small>{clip.available ? timecode(clipLength(clip)) : vi.unavailable}</small>
                    <span className="tl-handle end" aria-hidden="true"
                      onPointerDown={(event) => begin(event, clip, "end")} />
                  </div>;
                })}
              </div>;
            })}
            <div className="tl-playhead" style={{ left: playheadMs * scale }} aria-hidden="true" />
          </div>
      </div>

    </section>
  );
}
