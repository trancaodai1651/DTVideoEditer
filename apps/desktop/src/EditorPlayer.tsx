import { useEffect, useLayoutEffect, useRef, useState } from "react";
import type { CSSProperties, PointerEvent, ReactNode } from "react";
import { Icon } from "./Icon";
import { aspectNames, CompositionFrame } from "./ClipInspector";
import type { Aspect, LaneControl, TrackRegion } from "./desktop";
import type { Clip } from "./timeline";
import { frameTimecode } from "./vi";
import { ContextMenu } from "./ContextMenu";
import type { MenuState } from "./ContextMenu";

export function EditorPlayer({ source, clips, laneControls, aspect, at, total, revision, frameMode, playing, onMode, onPlay, onSeek, onAspect,
  disabled, selectedKey, onSelect, onTransform, meterDb, tracking, trackingSource, onTrackRegion, onCancelTracking, reviewUrl, onReview, onCloseReview,
  proxyAssets, proxyEnabled, proxyBuilding, proxyCurrent, onToggleProxy, onBuildProxy }: {
  proxyAssets: ReadonlySet<number>;
  proxyEnabled: boolean;
  proxyBuilding: boolean;
  proxyCurrent: boolean;
  onToggleProxy: () => void;
  onBuildProxy?: () => void;
  reviewUrl?: string;
  onReview: () => void;
  onCloseReview: () => void;
  meterDb: number | null;
  tracking: boolean;
  trackingSource?: string;
  onTrackRegion: (region: TrackRegion) => void;
  onCancelTracking: () => void;
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
  const [menu, setMenu] = useState<MenuState | null>(null);
  const [peak, setPeak] = useState<{ db: number; at: number } | null>(null);
  const [band, setBand] = useState<{ x: number; y: number; width: number; height: number } | null>(null);
  const bandStart = useRef<{ x: number; y: number } | null>(null);
  useEffect(() => {
    if (meterDb === null) return;
    const now = performance.now();
    setPeak((old) => !old || meterDb >= old.db || now - old.at > 1500 ? { db: meterDb, at: now } : old);
  }, [meterDb]);
  useEffect(() => {
    if (!tracking) return;
    const escape = (event: KeyboardEvent) => { if (event.key === "Escape") onCancelTracking(); };
    window.addEventListener("keydown", escape);
    return () => window.removeEventListener("keydown", escape);
  }, [tracking, onCancelTracking]);
  const meter = meterDb === null ? 0 : Math.max(0, Math.min(1, (meterDb + 60) / 60));
  const peakLevel = peak ? Math.max(0, Math.min(1, (peak.db + 60) / 60)) : 0;

  function trackDown(event: PointerEvent<HTMLDivElement>) {
    if (event.button !== 0) return;
    event.currentTarget.setPointerCapture(event.pointerId);
    const bounds = event.currentTarget.getBoundingClientRect();
    bandStart.current = { x: event.clientX - bounds.left, y: event.clientY - bounds.top };
  }
  function trackMove(event: PointerEvent<HTMLDivElement>) {
    const start = bandStart.current;
    if (!start) return;
    const bounds = event.currentTarget.getBoundingClientRect();
    const x = event.clientX - bounds.left;
    const y = event.clientY - bounds.top;
    setBand({ x: Math.min(x, start.x), y: Math.min(y, start.y), width: Math.abs(x - start.x), height: Math.abs(y - start.y) });
  }
  function trackUp(event: PointerEvent<HTMLDivElement>) {
    bandStart.current = null;
    const area = band;
    setBand(null);
    const target = stage.current?.querySelector<HTMLElement>(`.frame-object[data-key="${trackingSource}"]`);
    if (!area || area.width < 6 || area.height < 6 || !target) return;
    const overlay = event.currentTarget.getBoundingClientRect();
    const video = target.getBoundingClientRect();
    const toUnit = (value: number, origin: number, size: number) => Math.round(Math.max(0, Math.min(1000, (value - origin) * 1000 / size)));
    const x = toUnit(overlay.left + area.x, video.left, video.width);
    const y = toUnit(overlay.top + area.y, video.top, video.height);
    const right = toUnit(overlay.left + area.x + area.width, video.left, video.width);
    const bottom = toUnit(overlay.top + area.y + area.height, video.top, video.height);
    if (right - x < 10 || bottom - y < 10) return;
    onTrackRegion({ x, y, width: right - x, height: bottom - y });
  }
  useLayoutEffect(() => {
    const view = stage.current;
    if (!view || !frameMode) return;
    view.scrollLeft = (view.scrollWidth - view.clientWidth) / 2;
    view.scrollTop = (view.scrollHeight - view.clientHeight) / 2;
  }, [zoom, frameMode]);
  function fullscreen() {
    if (document.fullscreenElement) void document.exitFullscreen().catch(() => undefined);
    else void stage.current?.requestFullscreen().catch(() => undefined);
  }
  return <section className="studio-pane player-pane" aria-label="Trình phát" onContextMenu={(event) => {
    event.preventDefault();
    setMenu({ x: event.clientX, y: event.clientY, label: "Trình phát", items: [
      { label: "Xem nguồn", checked: !frameMode, action: () => { onCloseReview(); onMode(false); } },
      { label: "Xem timeline", checked: frameMode && !reviewUrl, action: () => { onCloseReview(); onMode(true); } },
      { label: "Xem màu và hiệu ứng khi xuất", disabled: disabled || total < 100, action: onReview },
      { label: "Dùng proxy xem trước", checked: proxyEnabled, action: onToggleProxy },
      { label: "Tạo proxy cho video đang chọn", disabled: !onBuildProxy || proxyBuilding, action: () => onBuildProxy?.() },
      "separator", { label: "Vừa khung", disabled: !!reviewUrl || !frameMode, action: () => setZoom(100) },
      { label: "Toàn màn hình", action: fullscreen },
    ] });
  }}>
    <div className="pane-heading"><h2>Trình phát</h2>
      <div className="player-modes">
        <button type="button" aria-pressed={!frameMode} onClick={() => { onCloseReview(); onMode(false); }}>Nguồn</button>
        <button type="button" aria-pressed={frameMode && !reviewUrl} onClick={() => { onCloseReview(); onMode(true); }}>Bản dựng</button>
        <button type="button" aria-pressed={!!reviewUrl} disabled={disabled || total < 100} onClick={onReview} title="Dùng bộ máy xuất để xem tối đa 20 giây từ playhead">Xem bản xuất</button>
        <button type="button" aria-pressed={proxyEnabled} onClick={onToggleProxy} title="Tự tạo proxy 720p cho video nặng đang xem">{proxyBuilding ? "Đang tạo proxy…" : proxyCurrent && proxyEnabled ? "Proxy 720p" : "Proxy"}</button>
      </div>
    </div>
    {reviewUrl ? <div className="studio-stage rendered-review" ref={stage}>
      <video key={reviewUrl} aria-label="Bản xem trước kết xuất" src={reviewUrl} controls playsInline autoPlay preload="metadata" />
    </div> : frameMode ? <div className="studio-stage" ref={stage} style={{ "--viewer-zoom": zoom / 100 } as CSSProperties}>
      <div className="studio-stage-inner">
        {clips.length ? <CompositionFrame clips={clips} laneControls={laneControls} aspect={aspect} at={Math.min(at, Math.max(0, total - 1))} revision={revision} playing={playing}
          selectedKey={selectedKey} editable={!disabled} onSelect={onSelect} onTransform={onTransform} proxyAssets={proxyAssets} />
          : <div className="player-empty"><Icon name="play" size={34} /><span>Thêm media để xem bản dựng</span></div>}
      </div>
      {tracking && <div className="track-overlay" onPointerDown={trackDown} onPointerMove={trackMove} onPointerUp={trackUp}
        aria-label="Kéo khung quanh vật thể cần theo dõi">
        <span className="track-hint">Kéo khung quanh vật thể · Esc để hủy</span>
        {band && <span className="track-band" style={{ left: band.x, top: band.y, width: band.width, height: band.height }} />}
      </div>}
    </div> : <div className="source-pane" ref={stage}>{source}</div>}
    {!reviewUrl && <div className="player-footer">
      <span className="audio-meter" role="meter" aria-label="Mức âm thanh tại playhead" aria-valuemin={-60} aria-valuemax={0}
        aria-valuenow={meterDb === null ? -60 : Math.round(meterDb)} title={meterDb === null ? "Không có tiếng" : `${meterDb.toFixed(1)} dBFS`}
        style={{ "--level": meter, "--peak": peakLevel } as CSSProperties}><span /><i /></span>
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
      <button type="button" className="icon-button" aria-label="Toàn màn hình" onClick={fullscreen}><Icon name="expand" size={16} /></button>
    </div>}
    {menu && <ContextMenu menu={menu} onClose={() => setMenu(null)} />}
  </section>;
}
