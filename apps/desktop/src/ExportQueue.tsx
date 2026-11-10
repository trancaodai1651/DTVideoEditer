import { useState } from "react";
import { fileName, mediaUrl } from "./desktop";
import type { Project, RenderJob } from "./desktop";
import { duration, vi } from "./vi";

export function ExportQueue({ jobs, projects, busy, onRun, onRetry, onCancel }: {
  jobs: RenderJob[];
  projects: Project[];
  busy: boolean;
  onRun: () => void;
  onRetry: (id: number) => void;
  onCancel: (id: number) => void;
}) {
  const [previewId, setPreviewId] = useState<number | null>(null);
  const preview = jobs.find((job) => job.id === previewId && job.status === "done");
  const queued = jobs.filter((job) => job.status === "queued").length;
  const running = jobs.some((job) => job.status === "running");
  return <section className="panel export-queue">
    <div className="panel-head">
      <div><h2>Hàng đợi xuất MP4</h2>
        <p>{queued} lượt chờ. Video được xuất lần lượt, theo bản dựng lúc thêm vào hàng đợi.</p></div>
      <button type="button" className="button primary" onClick={onRun} disabled={busy || !queued || running}>Chạy hàng đợi</button>
    </div>
    {preview && <div className="export-player">
      <video key={preview.id} src={mediaUrl("render", preview.id, 0)} controls playsInline preload="metadata" />
      <button type="button" className="button secondary compact" onClick={() => setPreviewId(null)}>Đóng xem trước</button>
    </div>}
    {jobs.length === 0 ? <p className="setting-empty">Chọn “Thêm vào hàng đợi” trên timeline để chuẩn bị lượt xuất đầu tiên.</p>
      : <ul className="render-jobs" aria-label="Các lượt xuất">
        {jobs.map((job) => {
          const active = job.status === "queued" || job.status === "running";
          return <li key={job.id} className={`render-job ${job.status}`}>
            <div className="render-copy">
              <strong>{vi.renderStatus[job.status]}{job.status === "running" && ` · ${Math.floor(job.progress / 10)}%`}</strong>
              <span title={job.outputPath}>{fileName(job.outputPath)} · {duration(job.durationMs)} · {projects.find((item) => item.id === job.projectId)?.name}</span>
              {job.error && <span className="render-error">{job.error}</span>}
            </div>
            {job.status === "running" && <progress max={1000} value={job.progress} aria-label={vi.renderProgress} />}
            {job.status === "done" && <button type="button" className="button secondary compact" onClick={() => setPreviewId(job.id)}>Xem video</button>}
            {active && <button type="button" className="button secondary compact" onClick={() => onCancel(job.id)}>{vi.cancel}</button>}
            {(job.status === "failed" || job.status === "canceled") && <button type="button" className="button secondary compact"
              disabled={busy} onClick={() => onRetry(job.id)}>Đưa lại vào hàng đợi</button>}
          </li>;
        })}
      </ul>}
  </section>;
}
