import { useEffect, useState } from "react";
import { api, fileName } from "./desktop";
import type { Asset, AssetPage, TemplateEntry, TimelineSnapshot } from "./desktop";
import { aspectNames, grades } from "./ClipInspector";
import type { Grade } from "./ClipInspector";
import { buildTemplate } from "./template";
import { timecode } from "./vi";

const starter: TemplateEntry[] = [
  { id: -1, template: { name: "Short mở đầu nhanh", aspect: "portrait", sceneMs: [1400, 1800, 2200, 2500] } },
  { id: -2, template: { name: "Giới thiệu sản phẩm", aspect: "landscape", sceneMs: [2400, 3200, 2700] } },
  { id: -3, template: { name: "Album vuông", aspect: "square", sceneMs: [2800, 2800, 2800] } },
];
const roles = ["Nhạc nền", "Hiệu ứng âm thanh", "Voice / lời đọc"];

export function TemplateLibrary({ initialReference, disabled, onProject, notify }: {
  initialReference: Asset | undefined;
  disabled: boolean;
  onProject: (name: string, snapshot: TimelineSnapshot) => Promise<void>;
  notify: (text: string, error: boolean) => void;
}) {
  const [templates, setTemplates] = useState(starter);
  const [entry, setEntry] = useState(starter[0]);
  const [data, setData] = useState<AssetPage | null>(null);
  const [page, setPage] = useState(0);
  const [reference, setReference] = useState<Asset | undefined>(initialReference);
  const [referenceName, setReferenceName] = useState(initialReference ? fileName(initialReference.relativePath).slice(0, 80) : "");
  const [projectName, setProjectName] = useState(starter[0].template.name);
  const [visuals, setVisuals] = useState<(Asset | undefined)[]>([]);
  const [audio, setAudio] = useState<(Asset | undefined)[]>([]);
  const [title, setTitle] = useState("");
  const [grade, setGrade] = useState<Grade>("natural");
  const [motion, setMotion] = useState<"none" | "slide">("none");
  const [fade, setFade] = useState(200);
  const [keepSound, setKeepSound] = useState(false);
  const [working, setWorking] = useState(false);
  const locked = disabled || working;
  const pool = data?.items ?? [];
  const current = entry.template;

  useEffect(() => {
    if (disabled) return;
    let active = true;
    void api.templates().then((saved) => { if (active) setTemplates([...starter, ...saved]); })
      .catch((error: unknown) => { if (active) notify(String(error), true); });
    return () => { active = false; };
  }, [disabled, notify]);

  useEffect(() => {
    if (disabled) return;
    let active = true;
    void api.assets(null, page).then((assets) => { if (active) setData(assets); })
      .catch((error: unknown) => { if (active) notify(String(error), true); });
    return () => { active = false; };
  }, [disabled, notify, page]);

  function choose(next: TemplateEntry) {
    setEntry(next);
    setProjectName(next.template.name);
    setVisuals([]);
  }

  async function analyze() {
    if (!reference || !referenceName.trim()) return;
    setWorking(true);
    try {
      const result = await api.analyzeReference(reference.id, referenceName);
      setTemplates((old) => [...old, result]);
      choose(result);
      notify(`Đã lưu mẫu với ${result.template.sceneMs.length} đoạn.`, false);
    } catch (error) {
      notify(String(error), true);
    } finally {
      setWorking(false);
    }
  }

  async function assemble() {
    setWorking(true);
    try {
      const snapshot = buildTemplate({
        aspect: current.aspect, scenes: current.sceneMs, visuals: visuals as Asset[], audio,
        look: { ...grades[grade], fadeMs: fade, motion }, title, keepSound,
      });
      await onProject(projectName, snapshot);
    } catch (error) {
      notify(String(error), true);
    } finally {
      setWorking(false);
    }
  }

  const videoPool = pool.filter((asset) => asset.kind === "video");
  const visualPool = pool.filter((asset) => asset.kind !== "audio");
  const audioPool = pool.filter((asset) => asset.kind === "audio");
  const pages = Math.max(1, Math.ceil((data?.total ?? 0) / (data?.pageSize ?? 48)));

  return <div className="template-workspace">
    <section className="panel template-browser">
      <div className="panel-head"><div><h2>Kho mẫu cục bộ</h2><p>Chọn mẫu dựng sẵn hoặc tạo mẫu nhịp cắt từ video trong thư viện.</p></div></div>
      <div className="template-cards">
        {templates.map((item) => <button type="button" key={item.id} className="template-card" disabled={locked}
          aria-pressed={entry.id === item.id} onClick={() => choose(item)}>
          <strong>{item.template.name}</strong>
          <small>{item.id < 0 ? "Mẫu dựng sẵn" : "Video tham chiếu"} · {item.template.sceneMs.length} đoạn · {aspectNames[item.template.aspect]}</small>
        </button>)}
      </div>
    </section>
    <section className="panel">
      <div className="panel-head"><div><h2>Video tham chiếu</h2>
        <p>Nhập video qua “Chọn thư mục”, rồi chọn tại đây. FFmpeg dò điểm cắt và tỷ lệ khung. Chữ, hiệu ứng và từng lớp âm thanh do bạn gán.</p></div></div>
      <fieldset className="template-fields" disabled={locked}>
        <MediaSelect label="Video mẫu · 0,5 giây đến 3 phút" items={videoPool} selected={reference} onChange={(asset) => {
          setReference(asset);
          if (asset) setReferenceName(fileName(asset.relativePath).slice(0, 80));
        }} />
        <label className="edit-field">Tên mẫu<input maxLength={80} value={referenceName} onChange={(event) => setReferenceName(event.target.value)} /></label>
        <button type="button" className="button secondary" disabled={!reference || !referenceName.trim()}
          onClick={() => void analyze()}>{working ? "Đang xử lý…" : "Phân tích và lưu mẫu"}</button>
        <div className="template-pagination">
          <button type="button" className="button secondary compact" disabled={page <= 0} onClick={() => setPage(page - 1)}>Trang trước</button>
          <span>Nguồn {page + 1}/{pages}</span>
          <button type="button" className="button secondary compact" disabled={page + 1 >= pages} onClick={() => setPage(page + 1)}>Trang sau</button>
        </div>
      </fieldset>
    </section>
    <section className="panel">
      <div className="panel-head"><div><h2>{current.name}</h2><p>{aspectNames[current.aspect]} · {timecode(current.sceneMs.reduce((sum, ms) => sum + ms, 0))}</p></div>
        <button type="button" className="button secondary" disabled={locked || visualPool.length === 0}
          onClick={() => setVisuals(current.sceneMs.map((_, index) => visualPool[index % visualPool.length]))}>Điền nguồn từ trang</button>
      </div>
      <fieldset className="template-fields" disabled={locked}>
        {current.sceneMs.map((length, index) => <MediaSelect key={index} label={`Đoạn ${index + 1} · ${timecode(length)}`}
          items={visualPool} selected={visuals[index]} onChange={(asset) => setVisuals((old) =>
            Object.assign([...old], { [index]: asset }))} />)}
        {roles.map((role, index) => <MediaSelect key={role} label={role} items={audioPool} selected={audio[index]}
          onChange={(asset) => setAudio((old) => Object.assign([...old], { [index]: asset }))} />)}
        <label className="edit-field">Chữ mở đầu<input value={title} maxLength={600} onChange={(event) => setTitle(event.target.value)} /></label>
        <label className="edit-field">Hiệu ứng màu<select value={grade} onChange={(event) => setGrade(event.target.value as Grade)}>
          <option value="natural">Tự nhiên</option><option value="vivid">Rực rỡ</option><option value="monochrome">Đen trắng</option><option value="soft">Dịu</option>
        </select></label>
        <label className="edit-field">Animation<select value={motion} onChange={(event) => setMotion(event.target.value as typeof motion)}>
          <option value="none">Tĩnh</option><option value="slide">Trượt từ trái</option>
        </select></label>
        <label className="edit-field">Chuyển cảnh<select value={fade} onChange={(event) => setFade(Number(event.target.value))}>
          <option value={0}>Cắt thẳng</option><option value={200}>Mờ qua đen · 200 ms</option><option value={500}>Mờ qua đen · 500 ms</option>
        </select></label>
        <label className="edit-field">Tên dự án mới<input value={projectName} maxLength={80} onChange={(event) => setProjectName(event.target.value)} /></label>
        <label className="template-check"><input type="checkbox" checked={keepSound} onChange={(event) => setKeepSound(event.target.checked)} /> Giữ tiếng video nguồn</label>
        <button type="button" className="button primary" disabled={!projectName.trim() || current.sceneMs.some((_, index) => !visuals[index])}
          onClick={() => void assemble()}>Tạo dự án từ mẫu</button>
      </fieldset>
    </section>
  </div>;
}

function MediaSelect({ label, items, selected, onChange }: {
  label: string; items: Asset[]; selected?: Asset; onChange: (asset: Asset | undefined) => void;
}) {
  const options = selected && !items.some((item) => item.id === selected.id) ? [selected, ...items] : items;
  return <label className="edit-field">{label}<select value={selected?.id ?? ""} onChange={(event) =>
    onChange(options.find((item) => item.id === Number(event.target.value)))}>
    <option value="">Chọn từ thư viện</option>
    {options.map((asset) => <option value={asset.id} key={asset.id}>{fileName(asset.relativePath)}</option>)}
  </select></label>;
}
