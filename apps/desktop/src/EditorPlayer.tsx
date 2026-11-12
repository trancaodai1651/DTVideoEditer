import { useLayoutEffect, useRef, useState } from "react";
import type { CSSProperties, ReactNode } from "react";
import { Icon } from "./Icon";
import { aspectNames, CompositionFrame } from "./ClipInspector";
import type { Aspect, LaneControl } from "./desktop";
import type { Clip } from "./timeline";
import { frameTimecode } from "./vi";

export function EditorPlayer({ source, clips, laneControls, aspect, at, total, revision, frameMode, playing, onMode, onPlay, onSeek, onAspect,
  disabled, selectedKey, onSelect, onTransform }: {
  source: ReactNode;
  clips: Clip[];
  laneControls: LaneControl[];
  aspect: Aspect;
  at: number;
  total: number;
  revision: number;
  frameMode: boolean;
  playing: boolean;
  onMode: (frameMode: boolean) => void;
  onPlay: () => void;
  onSeek: (at: number) => void;
  onAspect: (aspect: Aspect) => void;
  disabled: boolean;
  selectedKey: string | null;
  onSelect: (key: string | null) => void;
  onTransform: (clip: Clip) => void;
}) {
  const stage = useRef<HTMLDivElement>(null);
  const [zoom, setZoom] = useState(100);
  useLayoutEffect(() => {
    const view = stage.current;
    if (!view || !frameMode) return;
    view.scrollLeft = (view.scrollWidth - view.clientWidth) / 2;
    view.scrollTop = (view.scrollHeight - view.clientHeight) / 2;
  }, [zoom, frameMode]);
  return <section className="studio-pane player-pane" aria-label="Trình phát">
    <div className="pane-heading"><h2>Trình phát</h2>
      <div className="player-modes">
        <button type="button" aria-pressed={!frameMode} onClick={() => onMode(false)}>Nguồn</button>
        <button type="button" aria-pressed={frameMode} onClick={() => onMode(true)}>Bản dựng</button>
      </div>
    </div>
    {frameMode ? <div className="studio-stage" ref={stage} style={{ "--viewer-zoom": zoom / 100 } as CSSProperties}>
      <div className="studio-stage-inner">
        {clips.length ? <CompositionFrame clips={clips} laneControls={laneControls} aspect={aspect} at={Math.min(at, Math.max(0, total - 1))} revision={revision} playing={playing}
          selectedKey={selectedKey} editable={!disabled} onSelect={onSelect} onTransform={onTransform} />
          : <div className="player-empty"><Icon name="play" size={34} /><span>Thêm media để xem bản dựng</span></div>}
      </div>
    </div> : <div className="source-pane" ref={stage}>{source}</div>}
    <div className="player-footer">
      <span className="player-time"><strong>{frameTimecode(at)}</strong> / {frameTimecode(total)}</span>
      <button type="button" className="icon-button" aria-label={playing ? "Dừng bản dựng" : "Phát bản dựng"}
        disabled={disabled || total <= 0} onClick={onPlay}><Icon name={playing ? "pause" : "play"} size={17} /></button>
      <input className="player-scrub" type="range" min={0} max={Math.max(1, total)} value={Math.min(at, total)}
        disabled={total <= 0} aria-label="Vị trí phát" onChange={(event) => onSeek(Number(event.target.value))} />
      {frameMode && <select aria-label="Thu phóng preview" value={zoom} onChange={(event) => setZoom(Number(event.target.value))}>
        {[50, 75, 100, 125, 150, 200].map((value) => <option key={value} value={value}>{value === 100 ? "Vừa khung" : `${value}%`}</option>)}
      </select>}
      <select aria-label="Tỷ lệ bản dựng" value={aspect} disabled={disabled} onChange={(event) => onAspect(event.target.value as Aspect)}>
        {Object.entries(aspectNames).map(([id, label]) => <option value={id} key={id}>{label}</option>)}
      </select>
      <button type="button" className="icon-button" aria-label="Toàn màn hình" onClick={() => {
        if (document.fullscreenElement) void document.exitFullscreen().catch(() => undefined);
        else void stage.current?.requestFullscreen().catch(() => undefined);
      }}><Icon name="expand" size={16} /></button>
    </div>
  </section>;
}
