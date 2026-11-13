import { useEffect, useMemo, useRef, useState } from "react";
import type { CSSProperties, PointerEvent } from "react";
import { fileName, mediaUrl } from "./desktop";
import type { Aspect, CaptionMotion, ClipLook, LaneControl, LutEntry, TitleColor, TitleFont, TitleStyle } from "./desktop";
import { MAX_LAYERS, audioFades, captionHighlight, captionMotions, captionWords, clipFinish, clipLane, clipLength, clipsAt, defaultLook, layerOf, lookAt, offsetVisual, previousVisual, sourcePosition, transformProperties, transitionBetween, withCaptionText } from "./timeline";
import type { Clip } from "./timeline";
import { timecode } from "./vi";
import { SpeedPanel } from "./SpeedPanel";
import { ColorFilter, ColorPanel, cssColor } from "./ColorPanel";

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

export const fontFamily: Record<TitleFont, string> = {
  sans: "Arial, Helvetica, sans-serif", bold: "Arial, Helvetica, sans-serif", serif: "'Times New Roman', Times, serif",
  mono: "'Courier New', Courier, monospace", display: "Impact, 'Arial Black', sans-serif",
};
const namedColor: Record<TitleColor, string> = { white: "#ffffff", yellow: "#ffd400", cyan: "#00ffff", black: "#000000" };
const animatedCaption = (title: TitleStyle) => !!title.captionMotion && title.captionMotion !== "static";

/** CSS for a title in the preview, matching the drawtext options used on export. */
export function titleCss(title: TitleStyle, elapsed: number, length: number) {
  const color = title.colorHex ?? namedColor[title.color];
  const stroke = title.strokeHex ?? (title.color === "black" && !title.colorHex ? "#ffffff" : "#000000");
  const width = title.strokeWidth ?? 2;
  const fade = title.fadeMs ? Math.min(title.fadeMs, length / 2) : 0;
  const opacity = fade ? Math.max(0, Math.min(1, elapsed / fade, (length - elapsed) / fade)) : 1;
  const animated = animatedCaption(title);
  const background = !animated && (title.background || title.backgroundHex)
    ? hexAlpha(title.backgroundHex ?? "#000000", (title.backgroundOpacity ?? 66) / 100) : undefined;
  return {
    color, opacity, fontFamily: fontFamily[title.font ?? "sans"], fontWeight: title.font === "bold" ? 700 : 400,
    textAlign: title.align ?? "center", lineHeight: 1.15 + (animated ? 0 : title.lineSpacing ?? 0) / 40,
    WebkitTextStroke: width ? `${width / 3}px ${stroke}` : undefined,
    textShadow: title.shadow ? "3px 3px 2px rgba(0,0,0,.6)" : undefined,
    background,
  } as CSSProperties;
}

function hexAlpha(hex: string, alpha: number) {
  const value = Number.parseInt(hex.slice(1), 16);
  return `rgba(${value >> 16}, ${(value >> 8) & 255}, ${value & 255}, ${alpha})`;
}

function CaptionText({ title, elapsed, length }: { title: TitleStyle; elapsed: number; length: number }) {
  if (!title.captionMotion || title.captionMotion === "static") return title.text;
  const words = captionWords(title, length);
  let index = 0;
  return title.text.split(/(\s+)/u).map((text, key) => {
    if (!text || /^\s+$/u.test(text)) return text;
    const word = words[index++];
    if (!word) return text;
    const active = elapsed >= word.startMs && elapsed < word.endMs;
    const hidden = title.captionMotion === "reveal" && elapsed < word.startMs;
    return <span key={key} style={{ visibility: hidden ? "hidden" : undefined,
      color: active ? title.highlightHex ?? captionHighlight : undefined }}>{text}</span>;
  });
}

export function ClipInspector({ clip, aspect, disabled, name, total, playheadMs, tab, onTab, onAspect, onLayer, onClip, onKeyframe, onSeek, luts, onImportLut, onDeleteLut }: {
  luts: LutEntry[];
  onImportLut: () => void;
  onDeleteLut: (id: number) => void;
  clip: Clip | undefined;
  aspect: Aspect;
  disabled: boolean;
  name: string | undefined;
  total: number;
  playheadMs: number;
  tab: InspectorTab;
  onTab: (tab: InspectorTab) => void;
  onAspect: (aspect: Aspect) => void;
  onLayer: (layer: number) => void;
  onClip: (clip: Clip, animate?: boolean) => void;
  onKeyframe: (clip: Clip, elapsed: number) => void;
  onSeek: (at: number) => void;
}) {
  const title = clip?.title;
  const dynamic = title ? animatedCaption(title) : false;
  const elapsed = clip ? playheadMs - clip.positionMs : 0;
  const look = clip ? lookAt(clip, elapsed) : defaultLook;
  const previous = look.keyframes?.filter((key) => key.atMs < elapsed).at(-1);
  const following = look.keyframes?.find((key) => key.atMs > elapsed);
  const atKey = look.keyframes?.find((key) => key.atMs === elapsed);
  const lookEdit = (changes: Partial<ClipLook>) => {
    if (clip) onClip({ ...clip, look: { ...look, ...changes } }, transformProperties.some((property) => property in changes));
  };
  const adjustment = clip?.kind === "adjustment";
  const frozen = clip?.look?.freezeAtMs !== undefined;
  const visibleTabs = inspectorTabs.filter(([id]) => adjustment ? id === "adjust"
    : clip?.track === "audio" ? id === "audio" || id === "speed"
    : clip?.kind === "image" || frozen ? id !== "audio" && id !== "speed" : true);
  const titleEdit = (changes: Partial<TitleStyle>) => { if (clip && title) onClip({ ...clip, title: { ...title, ...changes } }); };
  const current = visibleTabs.some(([id]) => id === tab) ? tab : visibleTabs[0][0];
  const field = (label: string, key: "scale" | "opacity" | "volume" | "brightness" | "contrast" | "saturation" | "temperature" | "speed", min: number, max: number) =>
    <Slider key={`${key}-${Math.round(look[key])}`} label={label} value={Math.round(look[key])} min={min} max={max}
      onChange={(value) => lookEdit({ [key]: value })} />;
  return <section className="studio-pane inspector" aria-label="Thuộc tính">
    <div className="pane-heading"><h2>{clip ? title ? "Thuộc tính chữ" : adjustment ? "Lớp điều chỉnh" : "Thuộc tính clip" : "Chi tiết dự án"}</h2>
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
            if (text && text !== title.text) onClip({ ...clip, title: withCaptionText(title, text), relativePath: text });
            else if (!text) event.target.value = title.text;
          }} />
        </label>
        {title.caption && <>
          <label className="edit-field">Kiểu phụ đề
            <select value={title.captionMotion ?? "static"} onChange={(event) => titleEdit({ captionMotion: event.target.value as CaptionMotion })}>
              {Object.entries(captionMotions).map(([key, name]) => <option key={key} value={key}>{name}</option>)}
            </select>
          </label>
          {dynamic && <label className="edit-field">Màu từ đang đọc
            <input type="color" value={title.highlightHex ?? captionHighlight} onChange={(event) => titleEdit({ highlightHex: event.target.value })} />
          </label>}
        </>}
        <label className="edit-field">Màu chữ
          <select value={title.color} onChange={(event) => onClip({ ...clip, title: { ...title, color: event.target.value as TitleColor } })}>
            <option value="white">Trắng</option><option value="yellow">Vàng</option>
            <option value="cyan">Xanh ngọc</option><option value="black">Đen</option>
          </select>
        </label>
        <NumberField label="Cỡ chữ (% cao)" value={title.size} min={2} max={24} onChange={(size) => onClip({ ...clip, title: { ...title, size } })} />
        <NumberField label="Vị trí ngang" value={title.x} min={-100} max={100} onChange={(x) => onClip({ ...clip, title: { ...title, x } })} />
        <NumberField label="Vị trí dọc" value={title.y} min={-100} max={100} onChange={(y) => onClip({ ...clip, title: { ...title, y } })} />
        <label className="edit-field">Phông chữ
          <select value={title.font ?? "sans"} onChange={(event) => titleEdit({ font: event.target.value as TitleFont })}>
            <option value="sans">Arial</option><option value="bold">Arial đậm</option><option value="serif">Times New Roman</option>
            <option value="mono">Courier New</option><option value="display">Impact</option>
          </select>
        </label>
        <div className="inspector-pair">
          <label className="edit-field">Màu tùy chọn
            <input type="color" value={title.colorHex ?? namedColor[title.color]} onChange={(event) => titleEdit({ colorHex: event.target.value })} />
          </label>
          <label className="edit-field">Căn lề
            <select value={title.align ?? "center"} onChange={(event) => titleEdit({ align: event.target.value as TitleStyle["align"] })}>
              <option value="left">Trái</option><option value="center">Giữa</option><option value="right">Phải</option>
            </select>
          </label>
        </div>
        <div className="inspector-pair">
          <label className="edit-field">Màu viền
            <input type="color" value={title.strokeHex ?? "#000000"} onChange={(event) => titleEdit({ strokeHex: event.target.value })} />
          </label>
          <NumberField label="Độ dày viền" value={title.strokeWidth ?? 2} min={0} max={12} onChange={(strokeWidth) => titleEdit({ strokeWidth })} />
        </div>
        {!dynamic && <Toggle label="Nền chữ" checked={!!title.background || !!title.backgroundHex} onChange={(background) => titleEdit({ background, backgroundHex: background ? title.backgroundHex : undefined })} />}
        {!dynamic && (title.background || title.backgroundHex) && <div className="inspector-pair">
          <label className="edit-field">Màu nền
            <input type="color" value={title.backgroundHex ?? "#000000"} onChange={(event) => titleEdit({ backgroundHex: event.target.value, background: true })} />
          </label>
          <NumberField label="Độ đục nền (%)" value={title.backgroundOpacity ?? 66} min={0} max={100} onChange={(backgroundOpacity) => titleEdit({ backgroundOpacity })} />
        </div>}
        <Toggle label="Đổ bóng" checked={!!title.shadow} onChange={(shadow) => titleEdit({ shadow })} />
        <div className="inspector-pair">
          <NumberField label="Hiện dần/ẩn dần (ms)" value={title.fadeMs ?? 0} min={0} max={5000} onChange={(fadeMs) => titleEdit({ fadeMs: fadeMs || undefined })} />
          {!dynamic && <NumberField label="Giãn dòng" value={title.lineSpacing ?? 0} min={-20} max={60} onChange={(lineSpacing) => titleEdit({ lineSpacing: lineSpacing || undefined })} />}
        </div>
        <button type="button" className="button secondary compact" onClick={() => titleEdit({ colorHex: undefined, strokeHex: undefined, strokeWidth: undefined,
          backgroundHex: undefined, backgroundOpacity: undefined, align: undefined, shadow: undefined, fadeMs: undefined, lineSpacing: undefined, font: undefined })}>Đặt lại kiểu chữ</button>
        <Toggle label="Đánh dấu là phụ đề" checked={!!title.caption} onChange={(caption) => titleEdit({
          caption, words: caption ? title.words : undefined, captionMotion: caption ? title.captionMotion : undefined,
        })} />
      </>}
      {clip && !title && current === "video" && <>
        <h3>Biến đổi</h3>
        <div className="inspector-inline" role="group" aria-label="Keyframe biến đổi">
          <button type="button" className="button secondary compact" disabled={!previous} aria-label="Keyframe trước"
            onClick={() => previous && onSeek(clip.positionMs + previous.atMs)}>‹</button>
          <button type="button" className="button secondary compact" aria-pressed={!!atKey} disabled={elapsed < 0 || elapsed > clipLength(clip)}
            onClick={() => onKeyframe(clip, elapsed)}>{atKey ? "◆ Xóa keyframe" : "◇ Thêm keyframe"}</button>
          <button type="button" className="button secondary compact" disabled={!following} aria-label="Keyframe sau"
            onClick={() => following && onSeek(clip.positionMs + following.atMs)}>›</button>
          {atKey && <Toggle label="Nội suy êm" checked={!!atKey.smooth} onChange={(smooth) =>
            onClip({ ...clip, look: { ...clip.look, keyframes: look.keyframes?.map((key) => key === atKey ? { ...key, smooth } : key) } })} />}
        </div>
        {field("Tỷ lệ (%)", "scale", 10, 200)}
        <div className="inspector-pair">
          <NumberField label="Dịch ngang (%)" value={Math.round(look.x)} min={-100} max={100} onChange={(x) => lookEdit({ x })} />
          <NumberField label="Dịch dọc (%)" value={Math.round(look.y)} min={-100} max={100} onChange={(y) => lookEdit({ y })} />
        </div>
        <NumberField label="Xoay (°)" value={Math.round(look.rotate)} min={-180} max={180} onChange={(rotate) => lookEdit({ rotate })} />
        <Toggle label="Lật ngang" checked={look.flip} onChange={(flip) => lookEdit({ flip })} />
        <div className="inspector-inline">
          <button type="button" className="button secondary compact" onClick={() => lookEdit({ x: 0, y: 0 })}>Về giữa</button>
          <button type="button" className="button secondary compact" onClick={() => lookEdit({ scale: 100, x: 0, y: 0, rotate: 0, flip: false })}>Đặt lại biến đổi</button>
        </div>
        <h3>Trộn lớp</h3>
        {field("Độ đục (%)", "opacity", 0, 100)}
      </>}
      {clip && !title && current === "audio" && <>
        <NumberField label="Âm lượng (dB)" value={look.gainDb ?? Math.max(-60, Math.round(20 * Math.log10(look.volume / 100)))}
          min={-60} max={6} onChange={(gainDb) => lookEdit({ gainDb })} />
        <div className="inspector-pair">
          <NumberField label="Fade đầu (ms)" value={look.audioFadeInMs ?? look.fadeMs} min={0} max={10000}
            onChange={(audioFadeInMs) => lookEdit({ audioFadeInMs })} />
          <NumberField label="Fade cuối (ms)" value={look.audioFadeOutMs ?? look.fadeMs} min={0} max={10000}
            onChange={(audioFadeOutMs) => lookEdit({ audioFadeOutMs })} />
        </div>
        <Toggle label="Khử nhiễu âm thanh" checked={look.cleanAudio} onChange={(cleanAudio) => lookEdit({ cleanAudio })} />
      </>}
      {clip && !title && current === "speed" && <>
        <SpeedPanel key={clip.key} clip={clip} onSpeed={(speed, speedCurve) => lookEdit({ speed, speedCurve: speedCurve.length ? speedCurve : undefined, keyframes: undefined, reverse: speedCurve.length ? undefined : look.reverse })} />
        <Toggle label="Đảo ngược (tối đa 60 giây nguồn)" checked={!!look.reverse} disabled={!!look.speedCurve?.length || clip.endMs - clip.startMs > 60_000}
          onChange={(reverse) => lookEdit({ reverse: reverse || undefined, keyframes: undefined })} />
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
        <ColorPanel look={look} luts={luts} onLook={lookEdit} onImportLut={onImportLut} onDeleteLut={onDeleteLut} />
        {adjustment && <>
          <h3>Hiệu ứng cho các lớp bên dưới</h3>
          <label className="edit-field">Hiệu ứng
            <select value={look.effect} onChange={(event) => lookEdit({ effect: event.target.value as ClipLook["effect"] })}>
              <option value="none">Không</option><option value="blur">Làm mờ</option><option value="vignette">Tối viền</option><option value="grain">Hạt phim</option>
              <option value="invert">Âm bản</option><option value="mosaic">Ô điểm ảnh</option><option value="scanlines">Vạch màn hình</option>
            </select>
          </label>
          <Toggle label="Tăng nét" checked={look.sharpen} onChange={(sharpen) => lookEdit({ sharpen })} />
          <p className="inspector-help">Lớp điều chỉnh áp màu và hiệu ứng lên mọi hình bên dưới trong khoảng thời gian của nó, trước lớp chữ.</p>
        </>}
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

function useMediaClock(clip: Clip, at: number, playing: boolean, revision: number, proxy = false) {
  const player = useRef<HTMLMediaElement | null>(null);
  const position = sourcePosition(clip, at);
  const still = clip.look?.freezeAtMs !== undefined;
  const reverse = !!clip.look?.reverse;
  const rate = position.rate;
  const time = still ? clip.look!.freezeAtMs! / 1000
    : reverse ? (clip.endMs - position.offset) / 1000 : (clip.startMs + position.offset) / 1000;
  const runs = playing && !still && !reverse;
  const [fadeIn, fadeOut] = audioFades(clip);
  const gain = Math.min(1, fadeIn ? at / fadeIn : 1, fadeOut ? (clipLength(clip) - at) / fadeOut : 1);
  const baseGain = clip.look?.gainDb === undefined ? (clip.look?.volume ?? 100) / 100 : 10 ** (clip.look.gainDb / 20);
  const volume = Math.min(1, baseGain * gain);
  useEffect(() => {
    const element = player.current;
    if (!element) return;
    const seek = () => {
      if (!Number.isFinite(element.duration)) return;
      if (Math.abs(element.currentTime - time) > (runs ? 0.18 : 0.008)) element.currentTime = Math.min(time, element.duration);
      element.playbackRate = rate;
      element.volume = volume;
      if (runs && element.paused) void element.play().catch(() => undefined);
      else if (!runs) element.pause();
    };
    if (element.readyState >= 1) seek();
    element.addEventListener("loadedmetadata", seek);
    return () => element.removeEventListener("loadedmetadata", seek);
  }, [time, revision, runs, rate, volume, proxy]);
  return player;
}

type TransformMode = "move" | "scale" | "rotate";

function effectCss(effect: ClipLook["effect"] | undefined) {
  if (effect === "blur") return " blur(3px)";
  if (effect === "invert") return " invert(1)";
  return "";
}

function VisualFrame({ clip, at, revision, playing, muted, aspectRatio, editable, selected, onTransform, live, blend, shade, flash, slide, adjust, proxy }: {
  proxy: boolean;
  adjust: string;
  clip: Clip; at: number; revision: number; playing: boolean; aspectRatio: number; editable: boolean; selected: boolean;
  onTransform: (event: PointerEvent<HTMLElement>, clip: Clip, mode: TransformMode) => void;
  live: boolean;
  muted: boolean;
  blend: number;
  shade: number;
  flash: number;
  slide?: { kind: "slide_left" | "slide_right" | "slide_up"; remaining: number };
}) {
  const player = useMediaClock(clip, at, playing, revision, proxy);
  const src = mediaUrl(proxy ? "proxy" : "source", clip.assetId, revision);
  const look = live ? { ...defaultLook, ...clip.look } : lookAt(clip, at);
  const fade = Math.min(look.fadeMs, clipLength(clip) / 2);
  const opacity = look.opacity / 100 * blend * (fade ? Math.min(1, at / fade, (clipLength(clip) - at) / fade) : 1);
  const travel = (100 + look.scale) / 2 * Math.max(0, 1 - at / Math.min(450, clipLength(clip)));
  const sourceRatio = clip.width && clip.height ? clip.width / clip.height : aspectRatio;
  const width = look.scale * Math.min(1, sourceRatio / aspectRatio);
  const height = look.scale * Math.min(1, aspectRatio / sourceRatio);
  const slideX = (look.motion === "slide" ? -travel : look.motion === "slide_right" ? travel : 0)
    + (slide?.kind === "slide_left" ? 1 : slide?.kind === "slide_right" ? -1 : 0) * (slide?.remaining ?? 0) * (100 + width) / 2;
  const slideY = (look.motion === "rise" ? travel : 0) + (slide?.kind === "slide_up" ? slide.remaining * (100 + height) / 2 : 0);
  const bounds = {
    left: `${50 + look.x + slideX}%`, top: `${50 + look.y + slideY}%`,
    width: `${width}%`, height: `${height}%`,
    transform: `translate(-50%, -50%) rotate(${look.rotate}deg)`,
  };
  const filterId = `cf-${clip.key}`;
  const style = {
    opacity, filter: `${cssColor(look, filterId)}${effectCss(look.effect)}${shade === 1 ? "" : ` brightness(${shade})`}${adjust}`.trim() || undefined,
    transform: look.flip ? "scaleX(-1)" : undefined,
    clipPath: look.ellipse ? "ellipse(50% 50%)" : undefined,
  };
  return <div className={`frame-object ${editable ? "editable" : ""} ${selected && editable ? "frame-selected" : ""}`}
    style={bounds} data-key={clip.key} title={editable ? fileName(clip.relativePath) : undefined}
    onPointerDown={editable ? (event) => onTransform(event, { ...clip, look }, "move") : undefined}>
    <ColorFilter id={filterId} look={look} />
    {clip.kind === "image" ? <img className="frame-layer" src={src} style={style} alt="" draggable={false} />
      : <video className="frame-layer" ref={(element) => { player.current = element; }} src={src} style={style} muted={muted} playsInline preload="auto" />}
    {flash > 0 && <div className="frame-effect" style={{ background: "#fff", opacity: flash * opacity, clipPath: style.clipPath }} />}
    {look.effect === "scanlines" && <div className="frame-effect scanlines" style={{ opacity, clipPath: style.clipPath }} />}
    {look.effect === "vignette" && <div className="frame-effect vignette" style={{ opacity, clipPath: style.clipPath }} />}
    {editable && selected && <>
      {["nw", "ne", "sw", "se"].map((corner) => <span className={`frame-handle ${corner}`} key={corner} aria-hidden="true"
        title="Đổi cỡ" onPointerDown={(event) => onTransform(event, { ...clip, look }, "scale")} />)}
      <span className="frame-handle rotate" aria-hidden="true" title="Xoay"
        onPointerDown={(event) => onTransform(event, { ...clip, look }, "rotate")} />
    </>}
  </div>;
}

function AudioFrame({ clip, at, revision, playing }: { clip: Clip; at: number; revision: number; playing: boolean }) {
  const player = useMediaClock(clip, at, playing, revision);
  return <audio ref={(element) => { player.current = element; }} src={mediaUrl("source", clip.assetId, revision)} preload="auto" />;
}

export function CompositionFrame({ clips, laneControls, aspect, at, revision, playing, selectedKey, editable, onSelect, onTransform, proxyAssets }: {
  proxyAssets: ReadonlySet<number>;
  clips: Clip[]; laneControls: LaneControl[]; aspect: Aspect; at: number; revision: number; playing: boolean; selectedKey: string | null; editable: boolean;
  onSelect: (key: string | null) => void; onTransform: (clip: Clip) => void;
}) {
  const frame = useRef<HTMLDivElement>(null);
  const gesture = useRef<{
    clip: Clip; mode: TransformMode; pointer: number; x: number; y: number;
    centerX: number; centerY: number; width: number; height: number;
  } | null>(null);
  const [draft, setDraft] = useState<Clip | null>(null);
  const joins = useMemo(() => clips.flatMap((right) => {
    if (!right.look?.transition) return [];
    const left = previousVisual(clips, right);
    const join = left && transitionBetween(left, right);
    return left && join ? [{ left, right, ...join }] : [];
  }), [clips]);
  const active = clipsAt(clips, at).filter((clip) => clip.available && !clip.look?.disabled)
    .map((clip) => draft?.key === clip.key ? draft : clip).sort((a, b) => layerOf(a) - layerOf(b));
  const held = joins.filter(({ right, kind, durationMs }) => kind !== "black" && kind !== "white" && at >= right.positionMs
    && at < right.positionMs + durationMs).map(({ left }) => left);
  const visuals = [...active.filter((clip) => clip.track === "video"), ...held]
    .filter((clip) => !clipLane(laneControls, clip)?.hidden)
    .sort((a, b) => layerOf(a) - layerOf(b) || a.positionMs - b.positionMs);
  const adjustments = active.filter((clip) => clip.kind === "adjustment" && !clipLane(laneControls, clip)?.hidden)
    .sort((a, b) => layerOf(a) - layerOf(b));
  const adjustCss = adjustments.map((clip) => {
    const look = clip.look ?? {};
    return " " + cssColor(look, `af-${clip.key}`) + effectCss(look.effect);
  }).join("");
  const source = aspect === "source" ? clips.reduce<Clip | undefined>((first, clip) =>
    clip.track === "video" && clip.width && clip.height && (!first || clip.positionMs < first.positionMs) ? clip : first, undefined) : undefined;
  const size = source?.width && source.height ? source.width / source.height : ratio[aspect];

  function begin(event: PointerEvent<HTMLElement>, clip: Clip, mode: TransformMode) {
    if (!frame.current || !editable || playing || clipLane(laneControls, clip)?.locked || event.button !== 0 || !event.isPrimary) return;
    event.stopPropagation();
    const bounds = frame.current.getBoundingClientRect();
    const object = (event.currentTarget.closest(".frame-object") ?? event.currentTarget).getBoundingClientRect();
    frame.current.setPointerCapture(event.pointerId);
    gesture.current = {
      clip, mode, pointer: event.pointerId, x: event.clientX, y: event.clientY,
      centerX: object.left + object.width / 2, centerY: object.top + object.height / 2,
      width: Math.max(1, bounds.width - (clip.title ? object.width : 0)),
      height: Math.max(1, bounds.height - (clip.title ? object.height : 0)),
    };
    onSelect(clip.key);
  }

  function transform(event: PointerEvent<HTMLDivElement>, commit: boolean) {
    const drag = gesture.current;
    if (!drag || drag.pointer !== event.pointerId) return;
    const { clip, mode, centerX, centerY } = drag;
    const dx = event.clientX - drag.x;
    const dy = event.clientY - drag.y;
    let next = clip;
    if (Math.hypot(dx, dy) >= 2) {
      if (mode === "move") {
        const units = clip.title ? 200 : 100;
        next = offsetVisual(clip, units * dx / drag.width, units * dy / drag.height);
      } else {
        const look = { ...defaultLook, ...clip.look };
        const originX = drag.x - centerX;
        const originY = drag.y - centerY;
        const x = event.clientX - centerX;
        const y = event.clientY - centerY;
        if (mode === "scale") {
          const factor = Math.hypot(x, y) / Math.max(1, Math.hypot(originX, originY));
          const scale = Math.min(200, Math.max(10, Math.round(look.scale * factor)));
          if (scale !== look.scale) next = { ...clip, look: { ...look, scale } };
        } else {
          const degrees = Math.round((Math.atan2(y, x) - Math.atan2(originY, originX)) * 180 / Math.PI);
          const rotate = (look.rotate + degrees + 540) % 360 - 180;
          if (rotate !== look.rotate) next = { ...clip, look: { ...look, rotate } };
        }
      }
    }
    if (commit) {
      cancel();
      if (next !== clip) onTransform(next);
    } else {
      setDraft(next === clip ? null : next);
    }
  }

  function cancel() {
    gesture.current = null;
    setDraft(null);
  }

  return <div className={`composition ${aspect}`} ref={frame} style={{ aspectRatio: size, "--frame-ratio": size } as CSSProperties}
    aria-label="Khung hình tại playhead" onPointerMove={(event) => transform(event, false)}
    onPointerUp={(event) => transform(event, true)} onPointerCancel={cancel} onLostPointerCapture={cancel}
    onPointerDown={(event) => { if (editable && event.target === event.currentTarget) onSelect(null); }}>
    {adjustments.map((clip) => <ColorFilter key={clip.key} id={`af-${clip.key}`} look={clip.look ?? {}} />)}
    {visuals.map((clip) => {
      const controls = clipLane(laneControls, clip);
      const frozen = at >= clipFinish(clip);
      const elapsed = frozen ? clipLength(clip) - 1 : at - clip.positionMs;
      const incoming = joins.find((join) => join.right.key === clip.key);
      const outgoing = joins.find((join) => join.left.key === clip.key);
      const blend = incoming?.kind === "dissolve" ? Math.min(1, elapsed / incoming.durationMs) : 1;
      const shade = Math.min(1, incoming?.kind === "black" ? 2 * elapsed / incoming.durationMs : 1,
        outgoing?.kind === "black" ? 2 * (clipLength(clip) - elapsed) / outgoing.durationMs : 1);
      const flash = Math.max(0, incoming?.kind === "white" ? 1 - 2 * elapsed / incoming.durationMs : 0,
        outgoing?.kind === "white" ? 1 - 2 * (clipLength(clip) - elapsed) / outgoing.durationMs : 0);
      const kind = incoming?.kind;
      const slide = incoming && (kind === "slide_left" || kind === "slide_right" || kind === "slide_up")
        ? { kind, remaining: Math.max(0, 1 - elapsed / incoming.durationMs) } : undefined;
      return <VisualFrame key={clip.key} clip={clip} at={elapsed} revision={revision} playing={playing && !frozen} adjust={adjustCss}
        proxy={clip.kind === "video" && proxyAssets.has(clip.assetId)}
        muted={frozen || !!controls?.muted || !!clip.look?.audioDetached} aspectRatio={size} editable={editable && !playing && !frozen && !controls?.locked} selected={clip.key === selectedKey}
        onTransform={begin} live={draft?.key === clip.key} blend={blend} shade={shade} flash={flash} slide={slide} />;
    })}
    {playing && active.filter((clip) => {
      const controls = clipLane(laneControls, clip);
      return !controls?.muted && (clip.track === "audio" || (clip.kind === "video" && controls?.hidden && !clip.look?.audioDetached));
    }).map((clip) =>
      <AudioFrame key={clip.key} clip={clip} at={at - clip.positionMs} revision={revision} playing={playing} />)}
    {active.filter((clip) => clip.title && !clipLane(laneControls, clip)?.hidden).map((clip) => {
      const title = clip.title!;
      const dynamic = animatedCaption(title);
      const canEdit = editable && !playing && !clipLane(laneControls, clip)?.locked;
      const x = (title.x + 100) / 2;
      const y = (title.y + 100) / 2;
      return <span key={clip.key} className={`frame-title ${dynamic ? "dynamic-caption" : title.background ? "with-background" : ""} ${canEdit ? "editable" : ""} ${clip.key === selectedKey && canEdit ? "frame-selected" : ""}`} style={{
        left: `${x}%`, top: `${y}%`, transform: `translate(-${x}%, -${y}%)`, fontSize: `${title.size}cqh`,
        ...titleCss(title, at - clip.positionMs, clipLength(clip)), whiteSpace: "pre-wrap",
      }} onPointerDown={(event) => begin(event, clip, "move")}>
        <CaptionText title={title} elapsed={at - clip.positionMs} length={clipLength(clip)} />
      </span>;
    })}
  </div>;
}
