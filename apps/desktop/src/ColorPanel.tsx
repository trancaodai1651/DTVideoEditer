import { useRef, useState } from "react";
import type { PointerEvent as ReactPointerEvent } from "react";
import { HSL_COLORS } from "./desktop";
import type { ClipLook, ColorWheel, ColorWheels, CurvePoints, HslBand, HslColor, LutEntry } from "./desktop";
import { channelPoints, tonePoints } from "./timeline";

type ColorKey = "brightness" | "contrast" | "saturation" | "temperature" | "exposure" | "highlights" | "shadows" | "whites" | "blacks" | "tint" | "hue" | "vibrance";
const groups: { title: string; fields: [ColorKey, string, number, number, number][] }[] = [
  { title: "Ánh sáng", fields: [
    ["exposure", "Phơi sáng", -100, 100, 0], ["brightness", "Độ sáng", -100, 100, 0], ["contrast", "Tương phản", 0, 200, 100],
    ["highlights", "Vùng sáng", -100, 100, 0], ["shadows", "Vùng tối", -100, 100, 0], ["whites", "Điểm trắng", -100, 100, 0], ["blacks", "Điểm đen", -100, 100, 0],
  ] },
  { title: "Màu", fields: [
    ["temperature", "Nhiệt độ", -100, 100, 0], ["tint", "Sắc độ (xanh lá ↔ hồng)", -100, 100, 0], ["hue", "Tông màu (°)", -180, 180, 0],
    ["saturation", "Bão hòa", 0, 300, 100], ["vibrance", "Rực màu", -100, 100, 0],
  ] },
];
const wheelNames: [keyof ColorWheels, string][] = [["lift", "Vùng tối (Lift)"], ["gamma", "Trung tính (Gamma)"], ["gain", "Vùng sáng (Gain)"]];
const hslNames: Record<HslColor, [string, string]> = {
  red: ["Đỏ", "#e5484d"], yellow: ["Vàng", "#f5c518"], green: ["Xanh lá", "#30a46c"],
  cyan: ["Lục lam", "#05a2c2"], blue: ["Xanh dương", "#3e63dd"], magenta: ["Tím hồng", "#d6409f"],
};
type Channel = "master" | "r" | "g" | "b";
const channelNames: [Channel, string, string][] = [["master", "Tổng", "currentColor"], ["r", "Đỏ", "#e5484d"], ["g", "Lục", "#30a46c"], ["b", "Lam", "#3e63dd"]];
const IDENTITY: CurvePoints = [0, 250, 500, 750, 1000];
const NO_WHEEL: ColorWheel = { hue: 0, amount: 0, luma: 0 };
const NO_BAND: HslBand = { hue: 0, saturation: 0, lightness: 0 };

/** A hue/amount pad: angle picks the hue, distance from the centre the strength. */
function WheelPad({ label, wheel, onWheel }: { label: string; wheel: ColorWheel; onWheel: (wheel: ColorWheel) => void }) {
  const pad = useRef<SVGSVGElement>(null);
  const radians = wheel.hue * Math.PI / 180;
  const dot = { x: 50 + Math.cos(radians) * wheel.amount * 0.42, y: 50 - Math.sin(radians) * wheel.amount * 0.42 };
  function pick(event: ReactPointerEvent<SVGSVGElement>) {
    const box = pad.current?.getBoundingClientRect();
    if (!box) return;
    const dx = (event.clientX - box.left) / box.width * 100 - 50;
    const dy = 50 - (event.clientY - box.top) / box.height * 100;
    const amount = Math.round(Math.min(100, Math.hypot(dx, dy) / 0.42));
    const hue = Math.round((Math.atan2(dy, dx) * 180 / Math.PI + 360) % 360) % 360;
    onWheel({ ...wheel, hue, amount });
  }
  return <div className="color-wheel">
    <svg ref={pad} viewBox="0 0 100 100" role="slider" aria-label={label} aria-valuenow={wheel.amount} tabIndex={0}
      onPointerDown={(event) => { event.currentTarget.setPointerCapture(event.pointerId); pick(event); }}
      onPointerMove={(event) => { if (event.buttons & 1) pick(event); }}
      onDoubleClick={() => onWheel({ ...wheel, hue: 0, amount: 0 })}>
      <defs>
        <radialGradient id="wheel-fade"><stop offset="0" stopColor="#808080" /><stop offset="1" stopColor="#808080" stopOpacity="0" /></radialGradient>
      </defs>
      <circle cx={50} cy={50} r={44} className="wheel-ring" />
      <circle cx={50} cy={50} r={42} fill="url(#wheel-fade)" />
      <line x1={50} x2={50} y1={8} y2={92} className="wheel-axis" /><line y1={50} y2={50} x1={8} x2={92} className="wheel-axis" />
      <circle cx={dot.x} cy={dot.y} r={4.5} className="wheel-dot" />
    </svg>
    <span>{label}</span>
    <label className="color-slider"><span>Độ sáng</span>
      <input type="range" min={-100} max={100} value={wheel.luma} aria-label={`${label} độ sáng`}
        onChange={(event) => onWheel({ ...wheel, luma: Number(event.target.value) })} onDoubleClick={() => onWheel({ ...wheel, luma: 0 })} />
      <output>{wheel.luma}</output>
    </label>
  </div>;
}

/** Five vertically draggable points for one RGB channel. */
function CurveEditor({ channel, look, onLook }: { channel: Channel; look: Partial<ClipLook>; onLook: (changes: Partial<ClipLook>) => void }) {
  const box = useRef<SVGSVGElement>(null);
  const [dragging, setDragging] = useState<number | null>(null);
  const stroke = channelNames.find(([key]) => key === channel)![2];
  const index = channel === "master" ? -1 : ["r", "g", "b"].indexOf(channel);
  const points = index < 0 ? IDENTITY : look.rgbCurves?.[channel as "r"] ?? IDENTITY;
  const line = index < 0 ? tonePoints(look) ?? Array.from({ length: 9 }, (_, at) => at / 8)
    : channelPoints(look)?.[index] ?? Array.from({ length: 17 }, (_, at) => at / 16);
  function move(event: ReactPointerEvent<SVGSVGElement>) {
    const rect = box.current?.getBoundingClientRect();
    if (dragging === null || index < 0 || !rect) return;
    const value = Math.round(Math.min(1000, Math.max(0, (1 - (event.clientY - rect.top) / rect.height) * 1000)));
    const next = [...points] as CurvePoints;
    next[dragging] = value;
    onLook({ rgbCurves: { ...look.rgbCurves, [channel]: next } });
  }
  return <svg ref={box} className="tone-curve" viewBox="0 0 100 100" role="img" aria-label="Đường cong màu"
    onPointerMove={move} onPointerUp={() => setDragging(null)} onPointerLeave={() => setDragging(null)}>
    {[25, 50, 75].map((grid) => <g key={grid}><line x1={grid} x2={grid} y1={0} y2={100} /><line y1={grid} y2={grid} x1={0} x2={100} /></g>)}
    <polyline className="tone-identity" points="0,100 100,0" />
    <polyline style={{ stroke }} points={line.map((y, at) => `${at * 100 / (line.length - 1)},${100 - y * 100}`).join(" ")} />
    {index >= 0 && points.map((value, at) => <circle key={at} className="curve-point" cx={at * 25} cy={100 - value / 10} r={3.2}
      style={{ fill: stroke }} onPointerDown={(event) => { event.stopPropagation(); box.current?.setPointerCapture(event.pointerId); setDragging(at); }}
      onDoubleClick={() => { const next = [...points] as CurvePoints; next[at] = IDENTITY[at]; onLook({ rgbCurves: { ...look.rgbCurves, [channel]: next } }); }} />)}
  </svg>;
}

/** Full colour grading: light, wheels, HSL, curves, LUT. Values feed both the preview filter and FFmpeg. */
export function ColorPanel({ look, luts, onLook, onImportLut, onDeleteLut }: {
  look: Partial<ClipLook>;
  luts: LutEntry[];
  onLook: (changes: Partial<ClipLook>) => void;
  onImportLut: () => void;
  onDeleteLut: (id: number) => void;
}) {
  const [open, setOpen] = useState<"basic" | "wheels" | "hsl" | "curve" | "lut">("basic");
  const [hslColor, setHslColor] = useState<HslColor>("red");
  const [channel, setChannel] = useState<Channel>("master");
  const value = (key: ColorKey, fallback: number) => look[key] ?? fallback;
  const lut = luts.find((entry) => entry.id === look.lut);
  const band = look.hsl?.[hslColor] ?? NO_BAND;
  const setBand = (changes: Partial<HslBand>) => onLook({ hsl: { ...look.hsl, [hslColor]: { ...band, ...changes } } });
  return <div className="color-panel">
    <div className="player-modes" role="group" aria-label="Nhóm chỉnh màu">
      <button type="button" aria-pressed={open === "basic"} onClick={() => setOpen("basic")}>Cơ bản</button>
      <button type="button" aria-pressed={open === "wheels"} onClick={() => setOpen("wheels")}>Bánh xe</button>
      <button type="button" aria-pressed={open === "hsl"} onClick={() => setOpen("hsl")}>HSL</button>
      <button type="button" aria-pressed={open === "curve"} onClick={() => setOpen("curve")}>Đường cong</button>
      <button type="button" aria-pressed={open === "lut"} onClick={() => setOpen("lut")}>LUT</button>
    </div>
    {open === "basic" && groups.map((group) => <div key={group.title} className="color-group">
      <h3>{group.title}</h3>
      {group.fields.map(([key, label, min, max, fallback]) => <label key={key} className="color-slider">
        <span>{label}</span>
        <input type="range" min={min} max={max} value={value(key, fallback)} aria-label={label}
          onChange={(event) => onLook({ [key]: Number(event.target.value) })}
          onDoubleClick={() => onLook({ [key]: fallback })} />
        <output>{value(key, fallback)}</output>
      </label>)}
    </div>)}
    {open === "wheels" && <div className="color-group">
      <div className="color-wheels">
        {wheelNames.map(([key, label]) => <WheelPad key={key} label={label} wheel={look.wheels?.[key] ?? NO_WHEEL}
          onWheel={(wheel) => onLook({ wheels: { ...look.wheels, [key]: wheel } })} />)}
      </div>
      <p className="inspector-help">Kéo trong vòng tròn để đẩy màu cho vùng tối, trung tính và vùng sáng; nhấp đúp để đặt lại. Trình phát và bản xuất dùng cùng công thức.</p>
    </div>}
    {open === "hsl" && <div className="color-group">
      <div className="hsl-swatches" role="radiogroup" aria-label="Dải màu">
        {HSL_COLORS.map((color) => <button key={color} type="button" role="radio" aria-checked={hslColor === color} title={hslNames[color][0]}
          className={look.hsl?.[color] && (look.hsl[color]!.hue || look.hsl[color]!.saturation || look.hsl[color]!.lightness) ? "edited" : ""}
          style={{ background: hslNames[color][1] }} onClick={() => setHslColor(color)}><span className="sr-only">{hslNames[color][0]}</span></button>)}
      </div>
      <h3>{hslNames[hslColor][0]}</h3>
      {([["hue", "Sắc độ (°)", -60, 60], ["saturation", "Bão hòa", -100, 100], ["lightness", "Độ sáng", -100, 100]] as const).map(([key, label, min, max]) =>
        <label key={key} className="color-slider"><span>{label}</span>
          <input type="range" min={min} max={max} value={band[key]} aria-label={`${hslNames[hslColor][0]} ${label}`}
            onChange={(event) => setBand({ [key]: Number(event.target.value) })} onDoubleClick={() => setBand({ [key]: 0 })} />
          <output>{band[key]}</output>
        </label>)}
      <p className="inspector-help">HSL dùng bộ lọc huesaturation của FFmpeg. Chọn Xem bản xuất trong trình phát để xem chính xác.</p>
    </div>}
    {open === "curve" && <>
      <div className="player-modes" role="group" aria-label="Kênh đường cong">
        {channelNames.map(([key, label]) => <button key={key} type="button" aria-pressed={channel === key} onClick={() => setChannel(key)}>{label}</button>)}
      </div>
      <CurveEditor channel={channel} look={look} onLook={onLook} />
      {channel === "master" ? <>
        <p className="inspector-help">Đường cong tổng được dựng từ Phơi sáng, Vùng sáng, Vùng tối, Điểm trắng và Điểm đen. Trình phát và bản xuất dùng cùng công thức.</p>
        {(["highlights", "shadows", "whites", "blacks"] as const).map((key) => <label key={key} className="color-slider">
          <span>{groups[0].fields.find((field) => field[0] === key)![1]}</span>
          <input type="range" min={-100} max={100} value={value(key, 0)} onChange={(event) => onLook({ [key]: Number(event.target.value) })} />
          <output>{value(key, 0)}</output>
        </label>)}
      </> : <div className="inspector-inline">
        <p className="inspector-help">Kéo 5 điểm theo chiều dọc; nhấp đúp một điểm để trả về đường thẳng.</p>
        <button type="button" className="button secondary compact" onClick={() => onLook({ rgbCurves: { ...look.rgbCurves, [channel]: undefined } })}>Đặt lại kênh</button>
      </div>}
    </>}
    {open === "lut" && <div className="color-group">
      <label className="edit-field">LUT 3D (.cube)
        <select value={look.lut ?? ""} onChange={(event) => onLook({ lut: event.target.value ? Number(event.target.value) : undefined })}>
          <option value="">Không dùng LUT</option>
          {luts.map((entry) => <option key={entry.id} value={entry.id}>{entry.name}</option>)}
        </select>
      </label>
      <div className="inspector-inline">
        <button type="button" className="button secondary compact" onClick={onImportLut}>Nhập tệp .cube</button>
        {lut && <button type="button" className="button secondary compact danger" onClick={() => onDeleteLut(lut.id)}>Xóa LUT khỏi thư viện</button>}
      </div>
      <p className="inspector-help">Chọn Xem bản xuất trong trình phát để xem LUT và màu bằng FFmpeg tại playhead.</p>
    </div>}
    <button type="button" className="button secondary compact" onClick={() => onLook({
      brightness: 0, contrast: 100, saturation: 100, temperature: 0, exposure: undefined, highlights: undefined, shadows: undefined,
      whites: undefined, blacks: undefined, tint: undefined, hue: undefined, vibrance: undefined, lut: undefined,
      wheels: undefined, rgbCurves: undefined, hsl: undefined,
    })}>Đặt lại màu</button>
  </div>;
}

/** SVG filter for the preview: RGB channel curves, the master tone curve, then tint and vibrance. */
export function ColorFilter({ id, look }: { id: string; look: Partial<ClipLook> }) {
  const curve = tonePoints(look);
  const channels = channelPoints(look);
  const tint = (look.tint ?? 0) / 250;
  const vibrance = 1 + (look.vibrance ?? 0) / 200;
  if (!curve && !channels && !tint && vibrance === 1) return null;
  const table = curve?.join(" ");
  return <svg className="color-filter-defs" aria-hidden="true" width="0" height="0">
    <filter id={id} colorInterpolationFilters="sRGB">
      {channels && <feComponentTransfer>
        <feFuncR type="table" tableValues={channels[0].join(" ")} /><feFuncG type="table" tableValues={channels[1].join(" ")} />
        <feFuncB type="table" tableValues={channels[2].join(" ")} />
      </feComponentTransfer>}
      {table && <feComponentTransfer>
        <feFuncR type="table" tableValues={table} /><feFuncG type="table" tableValues={table} /><feFuncB type="table" tableValues={table} />
      </feComponentTransfer>}
      {vibrance !== 1 && <feColorMatrix type="saturate" values={String(vibrance)} />}
      {tint !== 0 && <feColorMatrix type="matrix" values={`1 0 0 0 0  0 ${1 - tint} 0 0 0  0 0 1 0 0  0 0 0 1 0`} />}
    </filter>
  </svg>;
}

export const hasSvgColor = (look: Partial<ClipLook>) => !!tonePoints(look) || !!channelPoints(look) || !!look.tint || !!look.vibrance;

/** CSS filters shared by clips and adjustment layers in the preview. */
export function cssColor(look: Partial<ClipLook>, filterId?: string) {
  const temperature = look.temperature ?? 0;
  const parts = [
    look.brightness ? `brightness(${1 + look.brightness / 100})` : "",
    look.contrast !== undefined && look.contrast !== 100 ? `contrast(${look.contrast}%)` : "",
    look.saturation !== undefined && look.saturation !== 100 ? `saturate(${look.saturation}%)` : "",
    temperature > 0 ? `sepia(${temperature / 250})` : temperature < 0 ? `sepia(${-temperature / 350}) hue-rotate(160deg)` : "",
    look.hue ? `hue-rotate(${look.hue}deg)` : "",
    filterId && hasSvgColor(look) ? `url(#${filterId})` : "",
  ];
  return parts.filter(Boolean).join(" ");
}
