import { useRef, useState } from "react";
import type { DragEvent, KeyboardEvent, PointerEvent } from "react";
import { fileName } from "./desktop";
import type { Project, RenderJob, Track } from "./desktop";
import { Icon } from "./Icon";
import {
  clipFinish, clipLength, clipsAt, moveClip, removeClip, snap, splitClip, totalMs, trackOf, trimEnd, trimStart,
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
  jobs: RenderJob[];
  onChange: (clips: Clip[]) => void;
  onSelect: (key: string | null) => void;
  onPlayhead: (ms: number) => void;
  onDropMedia: (media: MediaRef, positionMs: number) => void;
  onUndo: () => void;
  onRedo: () => void;
  onExport: () => void;
  onCancelRender: (jobId: number) => void;
  onRetryRender: (jobId: number) => void;
}

export function TimelineEditor(props: Props) {
  const { project, clips, selectedKey, playheadMs, busy, jobs, onChange, onSelect, onPlayhead } = props;
  const [zoom, setZoom] = useState(2);
  const [drag, setDrag] = useState<{ key: string; mode: Mode; x: number; next: Clip[] } | null>(null);
  const [scrub, setScrub] = useState(false);
  const canvas = useRef<HTMLDivElement>(null);
  const scale = ZOOM[zoom] / 1000;
  const shown = drag?.next ?? clips;
  const total = totalMs(shown);
  const width = Math.round((total + 10_000) * scale);
  const tick = TICKS.find((seconds) => seconds * 1000 * scale >= 64) ?? 600;
  const selected = clips.find((clip) => clip.key === selectedKey);
  const cuts = selected && clipsAt([selected], playheadMs).length ? [selected] : clipsAt(clips, playheadMs);
  const rendering = jobs.some((job) => job.status === "queued" || job.status === "running");
  const locked = busy || !project;

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
    if (locked || event.ctrlKey || event.metaKey || event.altKey) return;
    const step = event.shiftKey ? 1000 : 100;
    if (event.key === "Delete" || event.key === "Backspace") remove();
    else if (event.key.toLowerCase() === "s") split();
    else if (event.key === "ArrowLeft" && selected) nudge(selected, -step);
    else if (event.key === "ArrowRight" && selected) nudge(selected, step);
    else return;
    event.preventDefault();
  }

  function drop(event: DragEvent<HTMLElement>) {
    const data = event.dataTransfer.getData(MEDIA_DRAG_TYPE);
    if (!data || locked) return;
    event.preventDefault();
    props.onDropMedia(JSON.parse(data) as MediaRef, timeAt(event.clientX));
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
        <button type="button" className="button primary compact" disabled={locked || rendering || total === 0}
          onClick={props.onExport}><Icon name="export" size={16} />{vi.exportMp4}</button>
      </div>

      <div className="tl">
        <div className="tl-labels">
          <div className="tl-corner" />
          {(["video", "audio"] as const).map((track) =>
            <div className="track-name" key={track}><Icon name={track} />{vi.media[track]}</div>)}
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
            {(["video", "audio"] as const).map((track: Track) => {
              const items = shown.filter((clip) => clip.track === track);
              return <div className={`tl-lane ${track}`} key={track} onDragOver={allowDrop} onDrop={drop}
                onPointerDown={(event) => { if (event.target === event.currentTarget) onSelect(null); }}>
                {!items.length && <span className="track-empty">{project ? vi.dropHint : vi.noClips}</span>}
                {items.map((clip) => {
                  const name = fileName(clip.relativePath);
                  return <div key={clip.key} role="button" tabIndex={0} aria-pressed={clip.key === selectedKey}
                    aria-label={vi.clipLabel(name, timecode(clip.positionMs), timecode(clipLength(clip)))}
                    className={`tl-clip ${trackOf(clip.kind)} ${clip.key === selectedKey ? "selected" : ""} ${clip.available ? "" : "offline"}`}
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

      {jobs.length > 0 && <ul className="render-jobs" aria-label={vi.exports}>
        {jobs.map((job) => {
          const active = job.status === "queued" || job.status === "running";
          return <li key={job.id} className={`render-job ${job.status}`}>
            <div className="render-copy">
              <strong>{vi.renderStatus[job.status]}{job.status === "running" && ` · ${Math.floor(job.progress / 10)}%`}</strong>
              <span title={job.outputPath}>{fileName(job.outputPath)} · {duration(job.durationMs)}</span>
              {job.error && <span className="render-error">{job.error}</span>}
            </div>
            {active && <progress max={1000} value={job.status === "running" ? job.progress : undefined}
              aria-label={vi.renderProgress} />}
            {active && <button type="button" className="button secondary compact"
              onClick={() => props.onCancelRender(job.id)}>{vi.cancel}</button>}
            {(job.status === "failed" || job.status === "canceled") && <button type="button" className="button secondary compact"
              disabled={locked || rendering} onClick={() => props.onRetryRender(job.id)}>{vi.retry}</button>}
          </li>;
        })}
      </ul>}
    </section>
  );
}
