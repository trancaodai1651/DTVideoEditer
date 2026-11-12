import { useState } from "react";
import { fileName } from "./desktop";
import type { MontageStyle } from "./montage";
import type { Clip } from "./timeline";

export function MontagePanel({ count, audio, busy, onBuild }: {
  count: number;
  audio: Clip[];
  busy: boolean;
  onBuild: (style: MontageStyle, seconds: number, sound?: Clip) => void;
}) {
  const [mode, setMode] = useState<"highlight" | "rhythm">("highlight");
  const [length, setLength] = useState(30);
  const [style, setStyle] = useState<MontageStyle>("soft");
  const [soundKey, setSoundKey] = useState("");
  const sound = audio.find((clip) => clip.key === soundKey) ?? (audio.length === 1 ? audio[0] : undefined);
  return <form className="tool-detail" onSubmit={(event) => {
    event.preventDefault();
    if (mode === "rhythm" && !sound) return;
    onBuild(style, length, mode === "rhythm" ? sound : undefined);
  }}>
    <h3>Dựng tự động từ timeline</h3>
    <p>{count ? `${count} clip video và ảnh đang hiển thị. Kết quả mở thành dự án mới.` : "Kéo video hoặc ảnh lên timeline để bắt đầu."}</p>
    <label className="edit-field">Cách dựng
      <select value={mode} onChange={(event) => setMode(event.target.value as typeof mode)}>
        <option value="highlight">Chọn cảnh highlight</option><option value="rhythm">Dựng theo một clip âm thanh</option>
      </select>
    </label>
    {mode === "rhythm" && <label className="edit-field">Âm thanh từ timeline
      <select value={sound?.key ?? ""} onChange={(event) => setSoundKey(event.target.value)}>
        <option value="">{audio.length ? "Chọn clip âm thanh" : "Thêm một clip âm thanh vào timeline"}</option>
        {audio.map((clip) => <option key={clip.key} value={clip.key}>{fileName(clip.relativePath)} · {Math.round(clip.positionMs / 1000)}s</option>)}
      </select>
    </label>}
    <div className="inspector-pair">
      <label className="edit-field">Tối đa (giây)<input type="number" min={1} max={120} required value={length}
        onChange={(event) => setLength(Number(event.target.value))} /></label>
      <label className="edit-field">Phong cách<select value={style} onChange={(event) => setStyle(event.target.value as MontageStyle)}>
        <option value="soft">Nhẹ nhàng</option><option value="dynamic">Năng động</option>
      </select></label>
    </div>
    <button type="submit" className="button primary" disabled={busy || count === 0 || (mode === "rhythm" && !sound)}>Tạo bản dựng</button>
  </form>;
}
