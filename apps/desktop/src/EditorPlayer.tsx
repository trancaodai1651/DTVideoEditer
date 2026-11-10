import { useRef } from "react";
import type { ReactNode } from "react";
import { Icon } from "./Icon";
import { aspectNames, CompositionFrame } from "./ClipInspector";
import type { Aspect } from "./desktop";
import type { Clip } from "./timeline";
import { timecode } from "./vi";

export function EditorPlayer({ source, clips, aspect, at, total, revision, frameMode, playing, onMode, onPlay, onSeek, onAspect, disabled }: {
  source: ReactNode;
  clips: Clip[];
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
}) {
  const stage = useRef<HTMLDivElement>(null);
  return <section className="studio-pane player-pane" aria-label="Trình phát">
    <div className="pane-heading"><h2>Trình phát</h2>
      <div className="player-modes">
        <button type="button" aria-pressed={!frameMode} onClick={() => onMode(false)}>Nguồn</button>
        <button type="button" aria-pressed={frameMode} onClick={() => onMode(true)}>Bản dựng</button>
      </div>
    </div>
    {frameMode ? <div className="studio-stage" ref={stage}>
      {clips.length ? <CompositionFrame clips={clips} aspect={aspect} at={Math.min(at, Math.max(0, total - 1))} revision={revision} playing={playing} />
        : <div className="player-empty"><Icon name="play" size={34} /><span>Thêm media để xem bản dựng</span></div>}
    </div> : <div className="source-pane" ref={stage}>{source}</div>}
    <div className="player-footer">
      <span className="player-time"><strong>{timecode(at)}</strong> / {timecode(total)}</span>
      <button type="button" className="icon-button" aria-label={playing ? "Dừng bản dựng" : "Phát bản dựng"}
        disabled={disabled || total <= 0} onClick={onPlay}><Icon name={playing ? "pause" : "play"} size={17} /></button>
      <input className="player-scrub" type="range" min={0} max={Math.max(1, total)} value={Math.min(at, total)}
        disabled={total <= 0} aria-label="Vị trí phát" onChange={(event) => onSeek(Number(event.target.value))} />
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
