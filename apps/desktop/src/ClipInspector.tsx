import { useEffect, useRef, useState } from "react";
import type { CSSProperties } from "react";
import { fileName, mediaUrl } from "./desktop";
import type { Aspect, ClipLook, TitleColor } from "./desktop";
import { MAX_LAYERS, clipLength, clipsAt, defaultLook, layerOf, playbackRate } from "./timeline";
import type { Clip } from "./timeline";
import { timecode } from "./vi";

export const aspectNames: Record<Aspect, string> = {
  source: "Theo video nguồn", landscape: "16:9 · Ngang", portrait: "9:16 · Dọc", square: "1:1 · Vuông",
};
const ratio: Record<Aspect, number> = { source: 16 / 9, landscape: 16 / 9, portrait: 9 / 16, square: 1 };

const grade = {
  natural: { brightness: 0, contrast: 100, saturation: 100 },
  vivid: { brightness: 2, contrast: 110, saturation: 135 },
  monochrome: { brightness: 0, contrast: 112, saturation: 0 },
  soft: { brightness: 3, contrast: 90, saturation: 85 },
} satisfies Record<string, Partial<ClipLook>>;
export const grades = grade;
export type Grade = keyof typeof grades;

function NumberField({ label, value, min, max, onChange }: {
  label: string; value: number; min: number; max: number; onChange: (value: number) => void;
}) {
  return <label className="edit-field">{label}
    <input type="number" min={min} max={max} key={value} defaultValue={value}
      onKeyDown={(event) => { if (event.key === "Enter") event.currentTarget.blur(); }}
      onBlur={(event) => {
        const input = event.currentTarget;
        const next = Number.isFinite(input.valueAsNumber) ? Math.min(max, Math.max(min, Math.round(input.valueAsNumber))) : value;
        input.value = String(next);
        if (next !== value) onChange(next);
      }} />
  </label>;
}

function Slider({ label, value, min, max, onChange }: {
  label: string; value: number; min: number; max: number; onChange: (value: number) => void;
}) {
  const [draft, setDraft] = useState(value);
  const commit = () => { if (draft !== value) onChange(draft); };
  return <div className="inspector-slider">
    <label>{label}
      <input type="range" min={min} max={max} value={draft} onChange={(event) => setDraft(Number(event.target.value))}
        onPointerUp={commit} onBlur={commit} />
    </label>
    <NumberField label={`${label} · Giá trị`} value={value} min={min} max={max} onChange={onChange} />
  </div>;
}

function Toggle({ label, checked, onChange, disabled }: {
  label: string; checked: boolean; onChange: (checked: boolean) => void; disabled?: boolean;
}) {
  return <label className="inspector-toggle"><span>{label}</span>
    <input type="checkbox" checked={checked} onChange={(event) => onChange(event.target.checked)} disabled={disabled} />
  </label>;
}

const inspectorTabs = [
  ["video", "Video"], ["audio", "Âm thanh"], ["speed", "Tốc độ"], ["animation", "Animation"],
  ["adjust", "Điều chỉnh"], ["advanced", "Nâng cao"],
] as const;
export type InspectorTab = (typeof inspectorTabs)[number][0];

export function ClipInspector({ clip, aspect, disabled, name, total, tab, onTab, onAspect, onLayer, onClip }: {
  clip: Clip | undefined;
  aspect: Aspect;
  disabled: boolean;
  name: string | undefined;
  total: number;
  tab: InspectorTab;
  onTab: (tab: InspectorTab) => void;
  onAspect: (aspect: Aspect) => void;
  onLayer: (layer: number) => void;
  onClip: (clip: Clip) => void;
}) {
  const title = clip?.title;
  const look = { ...defaultLook, ...clip?.look };
  const lookEdit = (changes: Partial<ClipLook>) => { if (clip) onClip({ ...clip, look: { ...look, ...changes } }); };
  const visibleTabs = inspectorTabs.filter(([id]) => clip?.track === "audio"
    ? id === "audio" || id === "speed"
    : clip?.kind === "image" ? id !== "audio" && id !== "speed" : true);
  const current = visibleTabs.some(([id]) => id === tab) ? tab : visibleTabs[0][0];
  const field = (label: string, key: "scale" | "opacity" | "volume" | "brightness" | "contrast" | "saturation" | "temperature" | "speed", min: number, max: number) =>
    <Slider key={`${key}-${look[key]}`} label={label} value={look[key]} min={min} max={max}
      onChange={(value) => lookEdit({ [key]: value })} />;
  return <section className="studio-pane inspector" aria-label="Thuộc tính">
    <div className="pane-heading"><h2>{clip ? title ? "Thuộc tính chữ" : "Thuộc tính clip" : "Chi tiết dự án"}</h2>
      {clip && <small title={clip.relativePath}>{title?.text ?? fileName(clip.relativePath)}</small>}</div>
    {clip && !title && <nav className="inspector-tabs" aria-label="Nhóm thuộc tính">
      {visibleTabs.map(([id, label]) => <button type="button" key={id} aria-pressed={current === id}
        onClick={() => onTab(id)}>{label}</button>)}
    </nav>}
    <fieldset className="studio-inspector-fields" disabled={disabled} key={clip?.key ?? "canvas"}>
      {!clip && <>
        <dl className="project-meta">
          <dt>Dự án</dt><dd>{name ?? "Chưa có dự án"}</dd>
          <dt>Thời lượng</dt><dd>{timecode(total)}</dd>
          <dt>Tốc độ khung hình</dt><dd>30 fps khi xuất</dd>
          <dt>Lưu trữ</dt><dd>Trên thiết bị</dd>
        </dl>
        <label className="edit-field">Khung hình
        <select value={aspect} onChange={(event) => onAspect(event.target.value as Aspect)}>
          {Object.entries(aspectNames).map(([key, name]) => <option value={key} key={key}>{name}</option>)}
        </select>
        </label>
      </>}
      {clip && <label className="edit-field">Tầng
        <select value={layerOf(clip)} onChange={(event) => onLayer(Number(event.target.value))}>
          {Array.from({ length: MAX_LAYERS }, (_, layer) => <option key={layer} value={layer}>{layer + 1}</option>)}
        </select>
      </label>}
      {clip && title && <>
        <label className="edit-field wide">Nội dung chữ
          <textarea key={title.text} rows={3} maxLength={600} defaultValue={title.text} onBlur={(event) => {
            const text = event.target.value.trim();
            if (text && text !== title.text) onClip({ ...clip, title: { ...title, text }, relativePath: text });
            else if (!text) event.target.value = title.text;
          }} />
        </label>
        <label className="edit-field">Màu chữ
          <select value={title.color} onChange={(event) => onClip({ ...clip, title: { ...title, color: event.target.value as TitleColor } })}>
            <option value="white">Trắng</option><option value="yellow">Vàng</option>
            <option value="cyan">Xanh ngọc</option><option value="black">Đen</option>
          </select>
        </label>
        <NumberField label="Cỡ chữ (% cao)" value={title.size} min={2} max={24} onChange={(size) => onClip({ ...clip, title: { ...title, size } })} />
        <NumberField label="Vị trí ngang" value={title.x} min={-100} max={100} onChange={(x) => onClip({ ...clip, title: { ...title, x } })} />
        <NumberField label="Vị trí dọc" value={title.y} min={-100} max={100} onChange={(y) => onClip({ ...clip, title: { ...title, y } })} />
        <Toggle label="Nền chữ" checked={!!title.background} onChange={(background) => onClip({ ...clip, title: { ...title, background } })} />
        <Toggle label="Đánh dấu là phụ đề" checked={!!title.caption} onChange={(caption) => onClip({ ...clip, title: { ...title, caption } })} />
      </>}
      {clip && !title && current === "video" && <>
        <h3>Biến đổi</h3>
        {field("Tỷ lệ (%)", "scale", 10, 200)}
        <div className="inspector-pair">
          <NumberField label="Dịch ngang (%)" value={look.x} min={-100} max={100} onChange={(x) => lookEdit({ x })} />
          <NumberField label="Dịch dọc (%)" value={look.y} min={-100} max={100} onChange={(y) => lookEdit({ y })} />
        </div>
        <NumberField label="Xoay (°)" value={look.rotate} min={-180} max={180} onChange={(rotate) => lookEdit({ rotate })} />
        <Toggle label="Lật ngang" checked={look.flip} onChange={(flip) => lookEdit({ flip })} />
        <div className="inspector-inline">
          <button type="button" className="button secondary compact" onClick={() => lookEdit({ x: 0, y: 0 })}>Về giữa</button>
          <button type="button" className="button secondary compact" onClick={() => lookEdit({ scale: 100, x: 0, y: 0, rotate: 0, flip: false })}>Đặt lại biến đổi</button>
        </div>
        <h3>Trộn lớp</h3>
        {field("Độ đục (%)", "opacity", 0, 100)}
      </>}
      {clip && !title && current === "audio" && <>
        {field("Âm lượng (%)", "volume", 0, 200)}
        <NumberField label="Fade hai đầu (ms)" value={look.fadeMs} min={0} max={3000} onChange={(fadeMs) => lookEdit({ fadeMs })} />
        <Toggle label="Khử nhiễu âm thanh" checked={look.cleanAudio} onChange={(cleanAudio) => lookEdit({ cleanAudio })} />
      </>}
      {clip && !title && current === "speed" && <>
        {field("Tốc độ (%)", "speed", 50, 200)}
        <p className="inspector-help">Thời lượng sau chỉnh {timecode(clipLength(clip))}. Giữ cao độ âm thanh khi xuất.</p>
        {clip.kind === "video" && <Toggle label="Nội suy chuyển động" checked={look.opticalFlow} onChange={(opticalFlow) => lookEdit({ opticalFlow })} />}
      </>}
      {clip && !title && current === "animation" && <>
        <label className="edit-field">Vào khung
          <select value={look.motion} onChange={(event) => lookEdit({ motion: event.target.value as ClipLook["motion"] })}>
            <option value="none">Tĩnh</option><option value="slide">Trượt từ trái</option>
            <option value="slide_right">Trượt từ phải</option><option value="rise">Trượt lên</option>
          </select>
        </label>
        <NumberField label="Fade hai đầu (ms)" value={look.fadeMs} min={0} max={3000} onChange={(fadeMs) => lookEdit({ fadeMs })} />
      </>}
      {clip && !title && current === "adjust" && <>
        {field("Sáng", "brightness", -100, 100)}
        {field("Tương phản (%)", "contrast", 0, 200)}
        {field("Bão hòa (%)", "saturation", 0, 300)}
        {field("Nhiệt độ màu", "temperature", -100, 100)}
        <button type="button" className="button secondary compact" onClick={() => lookEdit({ ...grades.natural, temperature: 0 })}>Đặt lại màu</button>
      </>}
      {clip && !title && current === "advanced" && <>
        <h3>Chất lượng hình</h3>
        <Toggle label="Ổn định hình" checked={look.stabilize} onChange={(stabilize) => lookEdit({ stabilize })} disabled={clip.kind !== "video"} />
        <Toggle label="Tăng nét" checked={look.sharpen} onChange={(sharpen) => lookEdit({ sharpen })} />
        <Toggle label="Khử nhiễu hình" checked={look.denoise} onChange={(denoise) => lookEdit({ denoise })} />
        <Toggle label="Optical flow" checked={look.opticalFlow} onChange={(opticalFlow) => lookEdit({ opticalFlow })} disabled={clip.kind !== "video"} />
        <h3>Nền và mặt nạ</h3>
        <label className="edit-field">Chroma key
          <select value={look.keyColor} onChange={(event) => lookEdit({ keyColor: event.target.value as ClipLook["keyColor"] })}>
            <option value="none">Tắt</option><option value="green">Xanh lá</option><option value="blue">Xanh dương</option>
          </select>
        </label>
        <Toggle label="Mặt nạ elip" checked={look.ellipse} onChange={(ellipse) => lookEdit({ ellipse })} />
        <p className="inspector-help">Ổn định, khử nhiễu, chroma key và optical flow được xử lý khi xuất.</p>
      </>}
    </fieldset>
  </section>;
}

function useMediaClock(clip: Clip, at: number, playing: boolean, revision: number) {
  const player = useRef<HTMLMediaElement | null>(null);
  const rate = playbackRate(clip);
  const time = (clip.startMs + at * rate) / 1000;
  const fade = Math.min(clip.look?.fadeMs ?? 0, clipLength(clip) / 2);
  const gain = fade ? Math.min(1, at / fade, (clipLength(clip) - at) / fade) : 1;
  const volume = Math.min(1, (clip.look?.volume ?? 100) / 100 * gain);
  useEffect(() => {
    const element = player.current;
    if (!element) return;
    const seek = () => {
      if (!Number.isFinite(element.duration)) return;
      if (Math.abs(element.currentTime - time) > (playing ? 0.18 : 0.008)) element.currentTime = Math.min(time, element.duration);
      element.playbackRate = rate;
      element.volume = volume;
      if (playing && element.paused) void element.play().catch(() => undefined);
      else if (!playing) element.pause();
    };
    if (element.readyState >= 1) seek();
    element.addEventListener("loadedmetadata", seek);
    return () => element.removeEventListener("loadedmetadata", seek);
  }, [time, revision, playing, rate, volume]);
  return player;
}

function VisualFrame({ clip, at, revision, playing }: { clip: Clip; at: number; revision: number; playing: boolean }) {
  const player = useMediaClock(clip, at, playing, revision);
  const src = mediaUrl("source", clip.assetId, revision);
  const look = { ...defaultLook, ...clip.look };
  const fade = Math.min(look.fadeMs, clipLength(clip) / 2);
  const opacity = look.opacity / 100 * (fade ? Math.min(1, at / fade, (clipLength(clip) - at) / fade) : 1);
  const travel = (100 + look.scale) / 2 * Math.max(0, 1 - at / Math.min(450, clipLength(clip)));
  const slideX = look.motion === "slide" ? -travel : look.motion === "slide_right" ? travel : 0;
  const slideY = look.motion === "rise" ? travel : 0;
  const effect = look.effect === "blur" ? " blur(3px)" : "";
  const color = look.temperature > 0 ? ` sepia(${look.temperature / 250})`
    : look.temperature < 0 ? ` sepia(${-look.temperature / 350}) hue-rotate(160deg)` : "";
  const style = {
    left: `${50 + look.x + slideX}%`, top: `${50 + look.y + slideY}%`, width: `${look.scale}%`, height: `${look.scale}%`,
    opacity, filter: `brightness(${1 + look.brightness / 100}) contrast(${look.contrast}%) saturate(${look.saturation}%)${color}${effect}`,
    transform: `translate(-50%, -50%) rotate(${look.rotate}deg) scaleX(${look.flip ? -1 : 1})`,
    clipPath: look.ellipse ? "ellipse(50% 50%)" : undefined,
  };
  return clip.kind === "image" ? <img className="frame-layer" src={src} style={style} alt="" />
    : <video className="frame-layer" ref={(element) => { player.current = element; }} src={src} style={style} playsInline preload="auto" />;
}

function AudioFrame({ clip, at, revision, playing }: { clip: Clip; at: number; revision: number; playing: boolean }) {
  const player = useMediaClock(clip, at, playing, revision);
  return <audio ref={(element) => { player.current = element; }} src={mediaUrl("source", clip.assetId, revision)} preload="auto" />;
}

export function CompositionFrame({ clips, aspect, at, revision, playing = false }: { clips: Clip[]; aspect: Aspect; at: number; revision: number; playing?: boolean }) {
  const active = clipsAt(clips, at).filter((clip) => clip.available).sort((a, b) => layerOf(a) - layerOf(b));
  const source = aspect === "source" ? clips.reduce<Clip | undefined>((first, clip) =>
    clip.track === "video" && clip.width && clip.height && (!first || clip.positionMs < first.positionMs) ? clip : first, undefined) : undefined;
  const size = source?.width && source.height ? source.width / source.height : ratio[aspect];
  return <div className={`composition ${aspect}`} style={{ aspectRatio: size, "--frame-ratio": size } as CSSProperties}
    aria-label="Khung hình tại playhead">
    {active.filter((clip) => clip.track === "video").map((clip) =>
      <VisualFrame key={clip.key} clip={clip} at={at - clip.positionMs} revision={revision} playing={playing} />)}
    {playing && active.filter((clip) => clip.track === "audio").map((clip) =>
      <AudioFrame key={clip.key} clip={clip} at={at - clip.positionMs} revision={revision} playing={playing} />)}
    {active.filter((clip) => clip.title).map((clip) => {
      const title = clip.title!;
      const x = (title.x + 100) / 2;
      const y = (title.y + 100) / 2;
      return <span key={clip.key} className={`frame-title ${title.background ? "with-background" : ""}`} style={{
        left: `${x}%`, top: `${y}%`, transform: `translate(-${x}%, -${y}%)`, fontSize: `${title.size}cqh`,
        color: title.color, textShadow: title.color === "black" ? "0 0 3px white" : undefined,
      }}>{title.text}</span>;
    })}
  </div>;
}
