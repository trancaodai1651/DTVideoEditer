import { useState } from "react";
import { fileName } from "./desktop";
import type { MontageStyle } from "./montage";
import { clipFinish } from "./timeline.ts";
import type { Clip } from "./timeline";

const clock = (ms: number) => {
  const seconds = Math.round(ms / 1000);
  return `${Math.floor(seconds / 60)}:${String(seconds % 60).padStart(2, "0")}`;
};

export function MontagePanel({ count, audio, busy, onBuild }: {
  count: number;
  audio: Clip[];
  busy: boolean;
  /** `seconds` is null when the length is not capped (highlight) or follows the soundtrack. */
  onBuild: (style: MontageStyle, seconds: number | null, sounds: Clip[]) => void;
}) {
  const [mode, setMode] = useState<"highlight" | "rhythm">("highlight");
  const [limited, setLimited] = useState(false);
  const [length, setLength] = useState(60);
  const [style, setStyle] = useState<MontageStyle>("soft");
  const [soundKey, setSoundKey] = useState("all");
  const sounds = soundKey === "all" ? audio : audio.filter((clip) => clip.key === soundKey);
  const soundLength = sounds.length
    ? Math.max(...sounds.map(clipFinish)) - Math.min(...sounds.map((clip) => clip.positionMs)) : 0;
  return <form className="tool-detail" onSubmit={(event) => {
    event.preventDefault();
    if (mode === "rhythm" && !sounds.length) return;
    onBuild(style, mode === "highlight" && limited ? length : null, mode === "rhythm" ? sounds : []);
  }}>
    <h3>Dựng tự động từ timeline</h3>
    <p>{count ? `${count} clip video và ảnh đang hiển thị. Kết quả mở thành dự án mới.` : "Kéo video hoặc ảnh lên timeline để bắt đầu."}</p>
    <label className="edit-field">Cách dựng
      <select value={mode} onChange={(event) => setMode(event.target.value as typeof mode)}>
        <option value="highlight">Chọn cảnh highlight</option><option value="rhythm">Dựng theo âm thanh</option>
      </select>
    </label>
    {mode === "rhythm" && <>
      <label className="edit-field">Âm thanh từ timeline
        <select value={sounds.length ? soundKey : "all"} onChange={(event) => setSoundKey(event.target.value)}>
          <option value="all">{audio.length ? `Tất cả clip đang phát (${audio.length})` : "Thêm âm thanh vào timeline"}</option>
          {audio.map((clip) => <option key={clip.key} value={clip.key}>{fileName(clip.relativePath)} · {Math.round(clip.positionMs / 1000)}s</option>)}
        </select>
      </label>
      <p>{sounds.length ? `Độ dài bản dựng theo timeline âm thanh: ${clock(soundLength)}. Điểm cắt bám theo nhịp.` : "Thêm clip âm thanh để dựng theo nhịp."}</p>
    </>}
    {mode === "highlight" && <>
      <label className="template-check"><input type="checkbox" checked={limited} onChange={(event) => setLimited(event.target.checked)} /> Giới hạn thời lượng tối đa</label>
      {limited
        ? <label className="edit-field">Tối đa (giây)<input type="number" min={1} max={600} required value={length}
          onChange={(event) => setLength(Number(event.target.value))} /></label>
        : <p>Không giới hạn: giữ mọi khoảnh khắc nổi bật, mỗi nguồn ít nhất một cảnh.</p>}
    </>}
    <label className="edit-field">Phong cách<select value={style} onChange={(event) => setStyle(event.target.value as MontageStyle)}>
      <option value="soft">Nhẹ nhàng</option><option value="dynamic">Năng động</option>
    </select></label>
    <button type="submit" className="button primary" disabled={busy || count === 0 || (mode === "rhythm" && !sounds.length)}>Tạo bản dựng</button>
  </form>;
}
