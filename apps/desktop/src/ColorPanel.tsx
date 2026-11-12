import { useState } from "react";
import type { ClipLook, LutEntry } from "./desktop";
import { tonePoints } from "./timeline";

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

/** Full colour grading: light, tone curve, colour, LUT. Values feed both the preview filter and FFmpeg. */
export function ColorPanel({ look, luts, onLook, onImportLut, onDeleteLut }: {
  look: Partial<ClipLook>;
  luts: LutEntry[];
  onLook: (changes: Partial<ClipLook>) => void;
  onImportLut: () => void;
  onDeleteLut: (id: number) => void;
}) {
  const [open, setOpen] = useState<"basic" | "curve" | "lut">("basic");
  const value = (key: ColorKey, fallback: number) => look[key] ?? fallback;
  const curve = tonePoints(look) ?? Array.from({ length: 9 }, (_, index) => index / 8);
  const lut = luts.find((entry) => entry.id === look.lut);
  return <div className="color-panel">
    <div className="player-modes" role="group" aria-label="Nhóm chỉnh màu">
      <button type="button" aria-pressed={open === "basic"} onClick={() => setOpen("basic")}>Cơ bản</button>
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
    {open === "curve" && <>
      <svg className="tone-curve" viewBox="0 0 100 100" role="img" aria-label="Đường cong tông theo các thanh ánh sáng">
        {[25, 50, 75].map((grid) => <g key={grid}><line x1={grid} x2={grid} y1={0} y2={100} /><line y1={grid} y2={grid} x1={0} x2={100} /></g>)}
        <polyline className="tone-identity" points="0,100 100,0" />
        <polyline points={curve.map((y, index) => `${index * 12.5},${100 - y * 100}`).join(" ")} />
      </svg>
      <p className="inspector-help">Đường cong được dựng từ Phơi sáng, Vùng sáng, Vùng tối, Điểm trắng và Điểm đen. Trình phát và bản xuất dùng cùng công thức.</p>
      {(["highlights", "shadows", "whites", "blacks"] as const).map((key) => <label key={key} className="color-slider">
        <span>{groups[0].fields.find((field) => field[0] === key)![1]}</span>
        <input type="range" min={-100} max={100} value={value(key, 0)} onChange={(event) => onLook({ [key]: Number(event.target.value) })} />
        <output>{value(key, 0)}</output>
      </label>)}
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
    })}>Đặt lại màu</button>
  </div>;
}

/** SVG filter for the preview: tone curve as a transfer table plus a colour matrix for tint and vibrance. */
export function ColorFilter({ id, look }: { id: string; look: Partial<ClipLook> }) {
  const curve = tonePoints(look);
  const tint = (look.tint ?? 0) / 250;
  const vibrance = 1 + (look.vibrance ?? 0) / 200;
  if (!curve && !tint && vibrance === 1) return null;
  const table = curve?.join(" ");
  return <svg className="color-filter-defs" aria-hidden="true" width="0" height="0">
    <filter id={id} colorInterpolationFilters="sRGB">
      {table && <feComponentTransfer>
        <feFuncR type="table" tableValues={table} /><feFuncG type="table" tableValues={table} /><feFuncB type="table" tableValues={table} />
      </feComponentTransfer>}
      {vibrance !== 1 && <feColorMatrix type="saturate" values={String(vibrance)} />}
      {tint !== 0 && <feColorMatrix type="matrix" values={`1 0 0 0 0  0 ${1 - tint} 0 0 0  0 0 1 0 0  0 0 0 1 0`} />}
    </filter>
  </svg>;
}

export const hasSvgColor = (look: Partial<ClipLook>) => !!tonePoints(look) || !!look.tint || !!look.vibrance;

/** CSS filters shared by clips and adjustment layers in the preview. */
export function cssColor(look: Partial<ClipLook>, filterId?: string) {
  const temperature = look.temperature ?? 0;
  const parts = [
    `brightness(${1 + (look.brightness ?? 0) / 100})`, `contrast(${look.contrast ?? 100}%)`, `saturate(${look.saturation ?? 100}%)`,
    temperature > 0 ? `sepia(${temperature / 250})` : temperature < 0 ? `sepia(${-temperature / 350}) hue-rotate(160deg)` : "",
    look.hue ? `hue-rotate(${look.hue}deg)` : "",
    filterId && hasSvgColor(look) ? `url(#${filterId})` : "",
  ];
  return parts.filter(Boolean).join(" ");
}
