import { useEffect, useRef } from "react";
import { fileName, mediaUrl } from "./desktop";
import type { Aspect, ClipLook, TitleColor } from "./desktop";
import { MAX_LAYERS, clipLength, clipsAt, defaultLook, layerOf } from "./timeline";
import type { Clip } from "./timeline";

export const aspectNames: Record<Aspect, string> = {
  source: "Theo video nguồn", landscape: "16:9 · Ngang", portrait: "9:16 · Dọc", square: "1:1 · Vuông",
};
const ratio: Record<Aspect, string> = { source: "16 / 9", landscape: "16 / 9", portrait: "9 / 16", square: "1" };

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

export function ClipInspector({ clip, aspect, disabled, onAspect, onLayer, onClip }: {
  clip: Clip | undefined;
  aspect: Aspect;
  disabled: boolean;
  onAspect: (aspect: Aspect) => void;
  onLayer: (layer: number) => void;
  onClip: (clip: Clip) => void;
}) {
  const title = clip?.title;
  const look = { ...defaultLook, ...clip?.look };
  const lookEdit = (changes: Partial<ClipLook>) => { if (clip) onClip({ ...clip, look: { ...look, ...changes } }); };
  return <section className="panel inspector" aria-label="Thuộc tính">
    <div className="panel-head"><div><h2>Thuộc tính</h2>
      <p>{clip ? title?.text ?? fileName(clip.relativePath) : "Chọn clip trên timeline để chỉnh sửa."}</p></div></div>
    <fieldset className="inspector-fields" disabled={disabled} key={clip?.key ?? "canvas"}>
      <label className="edit-field">Khung hình
        <select value={aspect} onChange={(event) => onAspect(event.target.value as Aspect)}>
          {Object.entries(aspectNames).map(([key, name]) => <option value={key} key={key}>{name}</option>)}
        </select>
      </label>
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
      </>}
      {clip && !title && <>
        {clip.track === "video" && <>
          <label className="edit-field wide">Hiệu ứng màu
            <select value="" onChange={(event) => lookEdit(grades[event.target.value as Grade])}>
              <option value="" disabled>Chọn preset</option><option value="natural">Tự nhiên</option>
              <option value="vivid">Rực rỡ</option><option value="monochrome">Đen trắng</option><option value="soft">Dịu</option>
            </select>
          </label>
          <NumberField label="Sáng" value={look.brightness} min={-100} max={100} onChange={(brightness) => lookEdit({ brightness })} />
          <NumberField label="Tương phản (%)" value={look.contrast} min={0} max={200} onChange={(contrast) => lookEdit({ contrast })} />
          <NumberField label="Bão hòa (%)" value={look.saturation} min={0} max={300} onChange={(saturation) => lookEdit({ saturation })} />
          <NumberField label="Độ đục (%)" value={look.opacity} min={0} max={100} onChange={(opacity) => lookEdit({ opacity })} />
          <NumberField label="Tỷ lệ (%)" value={look.scale} min={10} max={200} onChange={(scale) => lookEdit({ scale })} />
          <NumberField label="Dịch ngang (%)" value={look.x} min={-100} max={100} onChange={(x) => lookEdit({ x })} />
          <NumberField label="Dịch dọc (%)" value={look.y} min={-100} max={100} onChange={(y) => lookEdit({ y })} />
          <label className="edit-field">Animation
            <select value={look.motion} onChange={(event) => lookEdit({ motion: event.target.value as ClipLook["motion"] })}>
              <option value="none">Tĩnh</option><option value="slide">Trượt từ trái</option>
            </select>
          </label>
        </>}
        {clip.kind !== "image" && <NumberField label="Âm lượng (%)" value={look.volume} min={0} max={200} onChange={(volume) => lookEdit({ volume })} />}
        <NumberField label="Fade hai đầu (ms)" value={look.fadeMs} min={0} max={3000} onChange={(fadeMs) => lookEdit({ fadeMs })} />
      </>}
    </fieldset>
  </section>;
}

function VisualFrame({ clip, at, revision }: { clip: Clip; at: number; revision: number }) {
  const video = useRef<HTMLVideoElement>(null);
  const time = (clip.startMs + at) / 1000;
  useEffect(() => {
    const element = video.current;
    if (!element) return;
    const seek = () => { if (Number.isFinite(element.duration)) element.currentTime = Math.min(time, element.duration); };
    if (element.readyState >= 1) seek();
    element.addEventListener("loadedmetadata", seek);
    return () => element.removeEventListener("loadedmetadata", seek);
  }, [time, revision]);
  const src = mediaUrl("source", clip.assetId, revision);
  const look = { ...defaultLook, ...clip.look };
  const fade = Math.min(look.fadeMs, clipLength(clip) / 2);
  const opacity = look.opacity / 100 * (fade ? Math.min(1, at / fade, (clipLength(clip) - at) / fade) : 1);
  const slide = look.motion === "slide" ? (100 + look.scale) / 2 * Math.max(0, 1 - at / Math.min(450, clipLength(clip))) : 0;
  const style = {
    left: `${50 + look.x - slide}%`, top: `${50 + look.y}%`, width: `${look.scale}%`, height: `${look.scale}%`,
    opacity, filter: `brightness(${1 + look.brightness / 100}) contrast(${look.contrast}%) saturate(${look.saturation}%)`,
  };
  return clip.kind === "image" ? <img className="frame-layer" src={src} style={style} alt="" />
    : <video className="frame-layer" ref={video} src={src} style={style} muted playsInline preload="auto" />;
}

export function CompositionFrame({ clips, aspect, at, revision }: { clips: Clip[]; aspect: Aspect; at: number; revision: number }) {
  const active = clipsAt(clips, at).filter((clip) => clip.available).sort((a, b) => layerOf(a) - layerOf(b));
  return <div className={`composition ${aspect}`} style={{ aspectRatio: ratio[aspect] }} aria-label="Khung hình tại playhead">
    {active.filter((clip) => clip.track === "video").map((clip) =>
      <VisualFrame key={clip.key} clip={clip} at={at - clip.positionMs} revision={revision} />)}
    {active.filter((clip) => clip.title).map((clip) => {
      const title = clip.title!;
      const x = (title.x + 100) / 2;
      const y = (title.y + 100) / 2;
      return <span key={clip.key} className="frame-title" style={{
        left: `${x}%`, top: `${y}%`, transform: `translate(-${x}%, -${y}%)`, fontSize: `${title.size}cqh`,
        color: title.color, textShadow: title.color === "black" ? "0 0 3px white" : undefined,
      }}>{title.text}</span>;
    })}
  </div>;
}
