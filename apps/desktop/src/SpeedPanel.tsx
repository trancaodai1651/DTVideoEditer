import { useRef, useState } from "react";
import type { PointerEvent } from "react";
import type { SpeedPoint } from "./desktop";
import { MAX_SPEED, MIN_SPEED, clipLength, speedCurvePresets, validCurve } from "./timeline";
import type { Clip } from "./timeline";
import { timecode } from "./vi";

const WIDTH = 280;
const HEIGHT = 128;
const toY = (speed: number) => HEIGHT / 2 - Math.log10(speed / 100) * HEIGHT / 2;
const toSpeed = (y: number) => Math.round(Math.min(MAX_SPEED, Math.max(MIN_SPEED, 100 * 10 ** ((HEIGHT / 2 - y) * 2 / HEIGHT))));
const label = (speed: number) => `${(speed / 100).toLocaleString("vi-VN", { maximumFractionDigits: 2 })}×`;

/** Constant speed or a curve of up to 10 points, drawn on a log scale from 0.1× to 10×. */
export function SpeedPanel({ clip, onSpeed }: { clip: Clip; onSpeed: (speed: number, curve: SpeedPoint[]) => void }) {
  const curve = clip.look?.speedCurve;
  const [mode, setMode] = useState<"constant" | "curve">(curve?.length ? "curve" : "constant");
  const [draft, setDraft] = useState<SpeedPoint[] | null>(null);
  const drag = useRef<{ index: number; pointer: number } | null>(null);
  const svg = useRef<SVGSVGElement>(null);
  const points = draft ?? curve ?? [{ at: 0, speed: clip.look?.speed ?? 100 }, { at: 1000, speed: clip.look?.speed ?? 100 }];
  const speed = clip.look?.speed ?? 100;

  function local(event: PointerEvent) {
    const bounds = svg.current!.getBoundingClientRect();
    return { x: (event.clientX - bounds.left) * WIDTH / bounds.width, y: (event.clientY - bounds.top) * HEIGHT / bounds.height };
  }

  function move(event: PointerEvent<SVGSVGElement>) {
    const active = drag.current;
    if (!active || active.pointer !== event.pointerId) return;
    const { x, y } = local(event);
    const next = points.map((point) => ({ ...point }));
    const point = next[active.index];
    point.speed = toSpeed(y);
    if (active.index > 0 && active.index < next.length - 1) {
      point.at = Math.round(Math.min(next[active.index + 1].at - 10, Math.max(next[active.index - 1].at + 10, x * 1000 / WIDTH)));
    }
    setDraft(next);
  }

  function commit() {
    drag.current = null;
    if (draft && validCurve(draft)) onSpeed(100, draft);
    setDraft(null);
  }

  function add(event: React.MouseEvent<SVGSVGElement>) {
    if (points.length >= 10 || !svg.current) return;
    const bounds = svg.current.getBoundingClientRect();
    const at = Math.round((event.clientX - bounds.left) * 1000 / bounds.width);
    if (points.some((point) => Math.abs(point.at - at) < 20) || at <= 0 || at >= 1000) return;
    const y = (event.clientY - bounds.top) * HEIGHT / bounds.height;
    const next = [...points, { at, speed: toSpeed(y) }].sort((a, b) => a.at - b.at);
    if (validCurve(next)) onSpeed(100, next);
  }

  return <div className="speed-panel">
    <div className="player-modes" role="group" aria-label="Kiểu tốc độ">
      <button type="button" aria-pressed={mode === "constant"} onClick={() => { setMode("constant"); if (curve?.length) onSpeed(100, []); }}>Cố định</button>
      <button type="button" aria-pressed={mode === "curve"} onClick={() => setMode("curve")}>Đường cong</button>
    </div>
    {mode === "constant" ? <>
      <label className="edit-field">Tốc độ <strong>{label(speed)}</strong>
        <input type="range" min={-1} max={1} step={0.01} value={Math.log10(speed / 100)}
          onChange={(event) => onSpeed(Math.round(100 * 10 ** Number(event.target.value)), [])} />
      </label>
      <div className="library-filters">
        {[25, 50, 100, 150, 200, 400, 800].map((value) => <button type="button" key={value} className="button secondary compact"
          aria-pressed={speed === value} onClick={() => onSpeed(value, [])}>{label(value)}</button>)}
      </div>
    </> : <>
      <div className="library-filters">
        {speedCurvePresets.map((preset) => <button type="button" key={preset.id} className="button secondary compact"
          onClick={() => onSpeed(100, preset.points)}>{preset.label}</button>)}
      </div>
      <svg ref={svg} className="speed-curve" viewBox={`0 0 ${WIDTH} ${HEIGHT}`} role="img"
        aria-label="Đường cong tốc độ. Kéo điểm để đổi tốc độ, nhấp đúp vào nền để thêm điểm, chuột phải vào điểm để xóa."
        onPointerMove={move} onPointerUp={commit} onPointerCancel={() => { drag.current = null; setDraft(null); }}
        onDoubleClick={(event) => { if (event.target === event.currentTarget || (event.target as Element).tagName === "polyline") add(event); }}>
        {[1000, 100, 10].map((value) => <g key={value}>
          <line x1={0} x2={WIDTH} y1={toY(value)} y2={toY(value)} className="speed-grid" />
          <text x={4} y={Math.min(HEIGHT - 3, Math.max(10, toY(value) - 3))}>{label(value)}</text>
        </g>)}
        <polyline points={points.map((point) => `${point.at * WIDTH / 1000},${toY(point.speed)}`).join(" ")} />
        {points.map((point, index) => <circle key={index} cx={point.at * WIDTH / 1000} cy={toY(point.speed)} r={6}
          tabIndex={0} aria-label={`Điểm ${index + 1}: ${label(point.speed)}`}
          onPointerDown={(event) => {
            event.stopPropagation();
            svg.current?.setPointerCapture(event.pointerId);
            drag.current = { index, pointer: event.pointerId };
          }}
          onContextMenu={(event) => {
            event.preventDefault();
            if (index === 0 || index === points.length - 1) return;
            onSpeed(100, points.filter((_, other) => other !== index));
          }}
          onKeyDown={(event) => {
            if (event.key !== "ArrowUp" && event.key !== "ArrowDown") return;
            event.preventDefault();
            const factor = event.key === "ArrowUp" ? 1.1 : 1 / 1.1;
            const next = points.map((item, other) => other === index
              ? { ...item, speed: Math.round(Math.min(MAX_SPEED, Math.max(MIN_SPEED, item.speed * factor))) } : item);
            onSpeed(100, next);
          }} />)}
      </svg>
      <p className="inspector-help">Kéo điểm để đổi tốc độ, nhấp đúp để thêm điểm, chuột phải vào điểm để xóa. Tối đa 10 điểm.</p>
    </>}
    <p className="inspector-help">Thời lượng sau chỉnh {timecode(clipLength(clip))}. Âm thanh đổi nhịp theo và giữ cao độ khi xuất.</p>
  </div>;
}
