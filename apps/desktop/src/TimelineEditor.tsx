import { useRef, useState } from "react";
import type { DragEvent, KeyboardEvent, PointerEvent } from "react";
import { fileName } from "./desktop";
import type { EditorTrack, Project } from "./desktop";
import { Icon } from "./Icon";
import {
  MAX_LAYERS, clipFinish, clipLength, clipsAt, layerOf, moveClip, removeClip, snap, splitClip, totalMs, trackOf, trimEnd, trimStart,
} from "./timeline";
import type { Clip, MediaRef } from "./timeline";
import { duration, timecode, vi } from "./vi";

export const MEDIA_DRAG_TYPE = "application/x-studio-media";
const ZOOM = [20, 40, 60, 100, 160, 240];
const TICKS = [1, 2, 5, 10, 30, 60, 120, 300, 600];
const SNAP_PX = 8;
type Mode = "move" | "start" | "end";
type SaveState = "saved" | "saving" | "error";

interface Props {
  project: Project | undefined;
  clips: Clip[];
  selectedKey: string | null;
  playheadMs: number;
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
const kinds = ["text", "video", "audio"] as const;
const label = { text: "Chữ", video: "Video", audio: "Âm thanh" };
const laneKey = ({ track, layer }: Lane) => `${track}-${layer}`;

export function TimelineEditor(props: Props) {
  const { project, clips, selectedKey, playheadMs, busy, lane, onChange, onSelect, onPlayhead } = props;
  const [zoom, setZoom] = useState(2);
  const [drag, setDrag] = useState<{ key: string; mode: Mode; x: number; next: Clip[] } | null>(null);
  const [scrub, setScrub] = useState(false);
  const [extra, setExtra] = useState({ text: 1, video: 1, audio: 1 });
  const canvas = useRef<HTMLDivElement>(null);
  const scale = ZOOM[zoom] / 1000;
  const shown = drag?.next ?? clips;
  const total = totalMs(shown);
  const width = Math.round((total + 10_000) * scale);
  const tick = TICKS.find((seconds) => seconds * 1000 * scale >= 64) ?? 600;
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
    Math.max(0, Math.round((clientX - (canvas.current?.getBoundingClientRect().left ?? 0)) / scale));

  function begin(event: PointerEvent<HTMLElement>, clip: Clip, mode: Mode) {
    if (locked || event.button !== 0) return;
    event.stopPropagation();
    event.currentTarget.setPointerCapture(event.pointerId);
    onSelect(clip.key);
    setDrag({ key: clip.key, mode, x: event.clientX, next: clips });
  }

  function dragTo(event: PointerEvent<HTMLElement>) {
    if (!drag) return;
    const clip = clips.find((item) => item.key === drag.key);
    if (!clip) return;
    const delta = (event.clientX - drag.x) / scale;
    let next: Clip[];
    if (drag.mode === "move") {
      const edges = [0, playheadMs, ...clips.filter((item) => item.key !== clip.key)
        .flatMap((item) => [item.positionMs, clipFinish(item)])];
      const wanted = clip.positionMs + delta;
      const tolerance = SNAP_PX / scale;
      const head = snap(wanted, edges, tolerance);
      const tail = snap(wanted + clipLength(clip), edges, tolerance) - clipLength(clip);
      next = moveClip(clips, clip.key, head !== wanted ? head : tail);
    } else {
      next = (drag.mode === "start" ? trimStart : trimEnd)(clips, clip.key, delta);
    }
    setDrag({ ...drag, next });
  }

  function finish() {
    if (!drag) return;
    if (drag.next !== clips) onChange(drag.next);
    setDrag(null);
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

  function drop(event: DragEvent<HTMLElement>, target: Lane) {
    const data = event.dataTransfer.getData(MEDIA_DRAG_TYPE);
    if (!data || locked) return;
    event.preventDefault();
    try {
      const media = JSON.parse(data) as MediaRef;
      if (trackOf(media.kind) === target.track) props.onDropMedia(media, timeAt(event.clientX), target);
    } catch { /* Ignore malformed drag data. */ }
  }

  function allowDrop(event: DragEvent<HTMLElement>) {
    if (locked || !event.dataTransfer.types.includes(MEDIA_DRAG_TYPE)) return;
    event.preventDefault();
    event.dataTransfer.dropEffect = "copy";
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
          disabled={locked || !cuts.some((clip) => splitClip(clips, clip.key, playheadMs))} onClick={split}>
          <Icon name="split" size={16} />{vi.split}
        </button>
        <button type="button" className="button secondary compact danger" disabled={locked || !selected} onClick={remove}>
          <Icon name="trash" size={16} />{vi.removeClip}
        </button>
        <span className="tl-time" aria-live="off">{timecode(playheadMs)} / {timecode(total)}</span>
        <span className={`tl-save ${props.saveState}`}>{project ? vi.saveState[props.saveState] : ""}</span>
        <button type="button" className="icon-button" title={vi.zoomOut} aria-label={vi.zoomOut}
          disabled={zoom === 0} onClick={() => setZoom(zoom - 1)}><Icon name="zoomOut" size={16} /></button>
        <button type="button" className="icon-button" title={vi.zoomIn} aria-label={vi.zoomIn}
          disabled={zoom === ZOOM.length - 1} onClick={() => setZoom(zoom + 1)}><Icon name="zoomIn" size={16} /></button>
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

      <div className="tl">
        <div className="tl-labels">
          <div className="tl-corner" />
          {lanes.map((target) =>
            <button type="button" className="track-name" key={laneKey(target)} disabled={locked}
              aria-pressed={laneKey(lane) === laneKey(target)} onClick={() => props.onLane(target)}>
              <Icon name={target.track === "text" ? "library" : target.track} />{label[target.track]} {target.layer + 1}
            </button>)}
        </div>
        <div className="tl-scroll">
          <div className="tl-canvas" ref={canvas} style={{ width }}>
            <div className="tl-ruler"
              onPointerDown={(event) => {
                event.currentTarget.setPointerCapture(event.pointerId);
                setScrub(true);
                onPlayhead(timeAt(event.clientX));
              }}
              onPointerMove={(event) => { if (scrub) onPlayhead(timeAt(event.clientX)); }}
              onPointerUp={() => setScrub(false)} onPointerCancel={() => setScrub(false)}>
              {Array.from({ length: Math.floor(width / (tick * 1000 * scale)) + 1 }, (_, index) =>
                <span key={index} style={{ left: index * tick * 1000 * scale }}>{duration(index * tick * 1000)}</span>)}
            </div>
            {lanes.map((target) => {
              const { track, layer } = target;
              const items = shown.filter((clip) => clip.track === track && layerOf(clip) === layer);
              return <div className={`tl-lane ${track}`} key={laneKey(target)} onDragOver={track === "text" ? undefined : allowDrop}
                onDrop={(event) => drop(event, target)}
                onPointerDown={(event) => {
                  if (event.target === event.currentTarget) { props.onLane(target); onSelect(null); }
                }}>
                {!items.length && <span className="track-empty">{project ? vi.dropHint : vi.noClips}</span>}
                {items.map((clip) => {
                  const name = clip.title?.text ?? fileName(clip.relativePath);
                  return <div key={clip.key} role="button" tabIndex={0} aria-pressed={clip.key === selectedKey}
                    aria-label={vi.clipLabel(name, timecode(clip.positionMs), timecode(clipLength(clip)))}
                    className={`tl-clip ${track} ${clip.key === selectedKey ? "selected" : ""} ${clip.available ? "" : "offline"}`}
                    style={{ left: clip.positionMs * scale, width: Math.max(clipLength(clip) * scale, 6) }}
                    title={clip.available ? clip.relativePath : vi.unavailable}
                    onFocus={() => onSelect(clip.key)}
                    onPointerDown={(event) => begin(event, clip, "move")}
                    onPointerMove={dragTo} onPointerUp={finish} onPointerCancel={() => setDrag(null)}>
                    <span className="tl-handle start" aria-hidden="true"
                      onPointerDown={(event) => begin(event, clip, "start")}
                      onPointerMove={dragTo} onPointerUp={finish} onPointerCancel={() => setDrag(null)} />
                    <span className="tl-clip-name">{name}</span>
                    <small>{clip.available ? timecode(clipLength(clip)) : vi.unavailable}</small>
                    <span className="tl-handle end" aria-hidden="true"
                      onPointerDown={(event) => begin(event, clip, "end")}
                      onPointerMove={dragTo} onPointerUp={finish} onPointerCancel={() => setDrag(null)} />
                  </div>;
                })}
              </div>;
            })}
            <div className="tl-playhead" style={{ left: playheadMs * scale }} aria-hidden="true" />
          </div>
        </div>
      </div>

    </section>
  );
}
