import { useState } from "react";
import type { ComponentProps, CSSProperties, ReactNode } from "react";
import { mediaUrl } from "./desktop";
import type { Asset, CatalogItem, ClipLook, ClipTransition, TitleStyle, TransitionKind } from "./desktop";
import { Icon } from "./Icon";
import { grades } from "./ClipInspector";
import { captionStyle, defaultTitle } from "./timeline";
import { duration } from "./vi";

const tabs = [
  { id: "media", label: "Media", icon: "video" },
  { id: "audio", label: "Âm thanh", icon: "audio" },
  { id: "text", label: "Chữ", icon: "text" },
  { id: "stickers", label: "Sticker", icon: "sticker" },
  { id: "effects", label: "Hiệu ứng", icon: "effect" },
  { id: "transitions", label: "Chuyển cảnh", icon: "transition" },
  { id: "captions", label: "Phụ đề", icon: "caption" },
  { id: "filters", label: "Bộ lọc", icon: "filter" },
  { id: "adjustment", label: "Điều chỉnh", icon: "settings" },
  { id: "templates", label: "Mẫu dựng", icon: "timeline" },
  { id: "advanced", label: "Nâng cao", icon: "effect" },
  { id: "smart", label: "Thông minh", icon: "split" },
] as const satisfies { id: string; label: string; icon: ComponentProps<typeof Icon>["name"] }[];

export type LibraryTab = (typeof tabs)[number]["id"];

interface Preset {
  label: string;
  detail: string;
  swatch: string;
  look: Partial<ClipLook>;
}

const presets: Record<"effects" | "transitions" | "filters" | "adjustment" | "advanced", Preset[]> = {
  effects: [
    { label: "Làm mềm", detail: "Làm mờ Gaussian", swatch: "#75529c", look: { effect: "blur" } },
    { label: "Tối viền", detail: "Tập trung vào giữa khung", swatch: "#453a60", look: { effect: "vignette" } },
    { label: "Hạt phim", detail: "Hạt thay đổi theo khung hình", swatch: "#76603e", look: { effect: "grain" } },
    { label: "Gỡ hiệu ứng", detail: "Trở về hình gốc của clip", swatch: "#46515c", look: { effect: "none" } },
  ],
  transitions: [
    { label: "Mờ qua nền", detail: "Fade hai đầu · 350 ms", swatch: "#44658c", look: { fadeMs: 350, motion: "none" } },
    { label: "Trượt từ trái", detail: "Đưa clip vào từ mép trái", swatch: "#286c68", look: { fadeMs: 0, motion: "slide" } },
    { label: "Trượt từ phải", detail: "Đưa clip vào từ mép phải", swatch: "#79549d", look: { fadeMs: 0, motion: "slide_right" } },
    { label: "Trượt lên", detail: "Đưa clip vào từ phía dưới", swatch: "#9a5f48", look: { fadeMs: 0, motion: "rise" } },
    { label: "Cắt thẳng", detail: "Bỏ hiệu ứng vào và ra", swatch: "#454a59", look: { fadeMs: 0, motion: "none" } },
  ],
  filters: [
    { label: "Tự nhiên", detail: "Màu trung tính", swatch: "#507a67", look: { ...grades.natural, temperature: 0 } },
    { label: "Rực rỡ", detail: "Màu nổi và tương phản cao", swatch: "#a65b66", look: { ...grades.vivid, temperature: 8 } },
    { label: "Đen trắng", detail: "Khử màu", swatch: "#606773", look: { ...grades.monochrome, temperature: 0 } },
    { label: "Ánh ấm", detail: "Tông vàng đỏ", swatch: "#b06e45", look: { ...grades.soft, temperature: 42 } },
    { label: "Xanh lạnh", detail: "Tông xanh điện ảnh", swatch: "#386688", look: { brightness: -4, contrast: 112, saturation: 82, temperature: -40 } },
  ],
  adjustment: [
    { label: "Nâng sáng", detail: "Tăng sáng nhẹ", swatch: "#8591a1", look: { brightness: 10 } },
    { label: "Tăng tương phản", detail: "Thêm chiều sâu", swatch: "#444960", look: { contrast: 125 } },
    { label: "Dịu màu", detail: "Giảm độ bão hòa", swatch: "#9a7f75", look: { saturation: 72 } },
    { label: "Đặt lại màu", detail: "Sáng, tương phản, bão hòa, nhiệt độ", swatch: "#475d5d", look: { ...grades.natural, temperature: 0 } },
  ],
  advanced: [
    { label: "Khử nhiễu hình", detail: "Khử nhiễu theo không gian và thời gian", swatch: "#525587", look: { denoise: true } },
    { label: "Tăng nét", detail: "Làm rõ đường biên", swatch: "#70663b", look: { sharpen: true } },
    { label: "Ổn định hình", detail: "Giảm rung bằng FFmpeg", swatch: "#38666f", look: { stabilize: true } },
    { label: "Optical flow", detail: "Nội suy chuyển động khi xuất", swatch: "#634988", look: { opticalFlow: true } },
    { label: "Xóa nền xanh lá", detail: "Chroma key khi xuất", swatch: "#347653", look: { keyColor: "green" } },
    { label: "Mặt nạ ellipse", detail: "Che phần ngoài hình elip", swatch: "#816345", look: { ellipse: true } },
  ],
};

const titles = [
  { label: "Tiêu đề", description: "Chữ trắng cỡ lớn", title: defaultTitle },
  { label: "Mở đầu", description: "Chữ vàng ở giữa khung", title: { ...defaultTitle, text: "Mở đầu", size: 10, y: 0, color: "yellow" } },
  { label: "Nhãn dưới", description: "Nền tối cho tên hoặc địa điểm", title: { ...defaultTitle, text: "Tên · Địa điểm", size: 5, x: -78, y: 75, background: true } },
] satisfies { label: string; description: string; title: TitleStyle }[];

export interface SmartTarget { key: string; kind: string; track: string; layer: number; detached: boolean; linked: boolean }

export function EditorLibrary({ smartTarget, onSmartTool, tab, onTab, media, templates, catalog, catalogFailed, onRetryCatalog, busy, hasProject, hasVisual, hasSpeech, hasCaptions, onApply, onTitle, onAdd, onImportSrt, onExportSrt, onTranscribe, canJoin, join, onJoin }: {
  tab: LibraryTab;
  onTab: (tab: LibraryTab) => void;
  smartTarget: SmartTarget | null;
  onSmartTool: (tool: "scenes" | "silence" | "beats" | "track" | "speed" | "detach", key: string) => void;
  media: ReactNode;
  templates: ReactNode;
  catalog: CatalogItem[] | null;
  catalogFailed: boolean;
  onRetryCatalog: () => void;
  busy: boolean;
  hasProject: boolean;
  hasVisual: boolean;
  hasSpeech: boolean;
  hasCaptions: boolean;
  onApply: (look: Partial<ClipLook>) => void;
  onTitle: (title: TitleStyle) => void;
  onAdd: (asset: Asset, sticker: boolean) => void;
  onImportSrt: () => void;
  onExportSrt: () => void;
  onTranscribe: (language: string) => void;
  canJoin: boolean;
  join?: ClipTransition;
  onJoin: (kind: TransitionKind | null, durationMs: number) => void;
}) {
  const [audioGroup, setAudioGroup] = useState<"music" | "sound" | "local">("music");
  const [previewSound, setPreviewSound] = useState<number | null>(null);
  const [language, setLanguage] = useState("vi");
  const [joinDuration, setJoinDuration] = useState(500);
  const selected = tabs.find((item) => item.id === tab)!;
  const hasStock = tab === "stickers" || tab === "audio" && audioGroup !== "local";
  const items = hasStock ? catalog?.filter((item) => item.group === (tab === "stickers" ? "sticker" : audioGroup)) : undefined;
  return <section className="studio-pane library-pane" aria-label="Thư viện biên tập">
    <nav className="library-tabs" aria-label="Công cụ biên tập">
      {tabs.map(({ id, label, icon }) => <button type="button" key={id} aria-pressed={tab === id}
        onClick={() => { setPreviewSound(null); onTab(id); }}><Icon name={icon} size={19} />{label}</button>)}
    </nav>
    <div className="library-body" aria-label={selected.label}>
      {tab === "audio" && <div className="library-filters">
        {([["music", "Nhạc nền"], ["sound", "Hiệu ứng âm thanh"], ["local", "Tệp của tôi"]] as const).map(([id, label]) =>
          <button type="button" key={id} className="button secondary compact" aria-pressed={audioGroup === id}
            onClick={() => { setPreviewSound(null); setAudioGroup(id); }}>{label}</button>)}
      </div>}
      {(tab === "media" || tab === "audio" && audioGroup === "local") && media}
      {hasStock && <div className="library-section">
        <h2>{tab === "stickers" ? "Sticker DT_Edit" : audioGroup === "music" ? "Nhạc nền DT_Edit" : "Hiệu ứng âm thanh"}</h2>
        <p>{tab === "stickers" ? "Thêm lớp hình trong suốt tại playhead." : "Nghe thử hoặc thêm vào tầng âm thanh tại playhead."}</p>
        {!items && (catalogFailed ? <button type="button" className="button secondary" onClick={onRetryCatalog}>Tải lại thư viện</button> : <p>Đang tải tài nguyên…</p>)}
        <div className={tab === "stickers" ? "preset-grid" : "sound-list"}>
          {items?.map(({ asset, title }) => <article key={asset.id} className="studio-card">
            {tab === "stickers" ? <div className="sticker-art"><img src={mediaUrl("source", asset.id, 0)} alt="" /></div> : null}
            <div className="studio-card-row"><div className="studio-card-label">
              <strong>{title}</strong><small>{duration(asset.durationMs) || "PNG trong suốt"}</small>
            </div>
            {tab === "audio" && <button type="button" className="icon-button" aria-label={`Nghe ${title}`}
              aria-pressed={previewSound === asset.id} onClick={() => setPreviewSound(previewSound === asset.id ? null : asset.id)}>
              <Icon name={previewSound === asset.id ? "pause" : "play"} size={15} />
            </button>}
            <button type="button" className="icon-button" aria-label={`Thêm ${title}`} disabled={busy || !hasProject}
              onClick={() => onAdd(asset, tab === "stickers")}><Icon name="plus" size={16} /></button></div>
            {previewSound === asset.id && <audio src={mediaUrl("source", asset.id, 0)} controls autoPlay preload="metadata" />}
          </article>)}
        </div>
      </div>}
      {tab === "text" && <div className="library-section"><h2>Mẫu chữ</h2><p>Chèn tại playhead rồi chỉnh nội dung trong Thuộc tính.</p>
        <div className="preset-grid">{titles.map((item) => <button type="button" key={item.label} className="studio-card preset-card"
          disabled={busy || !hasProject} onClick={() => onTitle(item.title)}>
          <div className="title-art" style={{ color: item.title.color === "yellow" ? "#ffd369" : undefined }}>Aa</div>
          <strong>{item.label}</strong><small>{item.description}</small>
        </button>)}</div>
      </div>}
      {tab === "captions" && <div className="library-section caption-tools">
        <h2>Phụ đề</h2><p>Thêm câu phụ đề có thể chỉnh sửa và burn-in khi xuất MP4.</p>
        <div className="library-filters">
          <button type="button" className="button secondary compact" disabled={busy || !hasProject} onClick={() => onTitle(captionStyle)}>Thêm thủ công</button>
          <button type="button" className="button secondary compact" disabled={busy || !hasProject} onClick={onImportSrt}>Nhập SRT</button>
          <button type="button" className="button secondary compact" disabled={busy || !hasCaptions} onClick={onExportSrt}>Xuất SRT</button>
        </div>
        <div className="tool-detail"><h3>Nhận dạng lời nói trên máy</h3>
          <p>Chọn clip có tiếng trên timeline và mô hình Whisper GGML. Cần FFmpeg có filter whisper.</p>
          <label className="edit-field">Ngôn ngữ<select value={language} onChange={(event) => setLanguage(event.target.value)}>
            <option value="vi">Tiếng Việt</option><option value="en">Tiếng Anh</option><option value="auto">Tự nhận diện</option>
          </select></label>
          <button type="button" className="button primary" disabled={busy || !hasSpeech} onClick={() => onTranscribe(language)}>Chọn mô hình và tạo phụ đề</button>
        </div>
      </div>}
      {tab === "templates" && templates}
      {tab === "smart" && <div className="library-section smart-tools">
        <h2>Công cụ thông minh</h2>
        <p>Chạy trên máy bằng FFmpeg với clip đang chọn. Không gửi media ra ngoài.</p>
        {!smartTarget && <p className="inspector-help">Chọn một clip trên timeline để bật các công cụ.</p>}
        <div className="preset-grid">
          {([
            ["scenes", "Dò cảnh và tách", "Tách clip video tại các điểm chuyển cảnh", smartTarget?.kind === "video"],
            ["silence", "Xóa khoảng lặng", "Cắt các đoạn im lặng từ 0,6 giây và dồn clip", !!smartTarget && smartTarget.kind !== "image" && smartTarget.track !== "text"],
            ["beats", "Đánh dấu nhịp nhạc", "Thêm marker theo nhịp để cắt khớp nhạc", !!smartTarget && smartTarget.kind !== "image" && smartTarget.track !== "text"],
            ["track", "Bám theo chuyển động", "Gắn sticker hoặc lớp phủ theo vật thể trong video bên dưới", smartTarget?.track === "video" && smartTarget.layer > 0],
            ["detach", smartTarget?.detached || smartTarget?.linked ? "Khôi phục âm thanh" : "Tách âm thanh", "Đưa tiếng của video ra tầng âm thanh riêng", smartTarget?.kind === "video"],
            ["speed", "Đường cong tốc độ", "Tăng giảm tốc độ theo đồ thị trong Thuộc tính", !!smartTarget && smartTarget.kind !== "image" && smartTarget.track !== "text"],
          ] as const).map(([id, label, detail, enabled]) => <button type="button" key={id} className="studio-card preset-card"
            disabled={busy || !enabled || !smartTarget} onClick={() => smartTarget && onSmartTool(id, smartTarget.key)}>
            <div className="preset-art" style={{ "--swatch": "#3f5d7a" } as CSSProperties}><Icon name="split" size={22} /></div>
            <strong>{label}</strong><small>{detail}</small>
          </button>)}
          <button type="button" className="studio-card preset-card" disabled={busy} onClick={() => onTab("captions")}>
            <div className="preset-art" style={{ "--swatch": "#5a4a7a" } as CSSProperties}><Icon name="caption" size={22} /></div>
            <strong>Phụ đề tự động</strong><small>Whisper trên máy, sửa được từng câu</small>
          </button>
        </div>
        <div className="tool-detail"><h3>Chưa có trong bản cục bộ</h3>
          <p>Xóa nền bằng AI, avatar AI, lồng tiếng và dịch bằng dịch vụ cloud cần mô hình hoặc tài khoản bên ngoài. Các mục này nằm trong backlog M2 và M1-J.</p>
        </div>
      </div>}
      {tab === "transitions" && <div className="library-section">
        <h2>Điểm nối hai clip</h2>
        <p>Chọn clip phía sau trên cùng tầng. Hai clip phải chạm mép.</p>
        <label className="edit-field">Thời lượng chuyển cảnh (ms)
          <input type="number" min={100} max={3000} step={100} value={joinDuration}
            onChange={(event) => setJoinDuration(Number(event.target.value))} />
        </label>
        <div className="library-filters">
          <button type="button" className="button secondary compact" disabled={busy || !canJoin}
            onClick={() => onJoin("dissolve", joinDuration)}>Hòa trộn</button>
          <button type="button" className="button secondary compact" disabled={busy || !canJoin}
            onClick={() => onJoin("black", joinDuration)}>Qua đen</button>
          <button type="button" className="button secondary compact" disabled={busy || !join}
            onClick={() => onJoin(null, 0)}>Gỡ điểm nối</button>
        </div>
        {join && <p>{join.kind === "black" ? "Qua đen" : "Hòa trộn"} · {join.durationMs} ms</p>}
      </div>}
      {(tab === "effects" || tab === "transitions" || tab === "filters" || tab === "adjustment" || tab === "advanced") &&
        <div className="library-section"><h2>{tab === "transitions" ? "Vào và ra trên một clip" : selected.label}</h2><p>{hasVisual
          ? "Bấm một mẫu để áp dụng cho clip đang chọn."
          : "Chọn một clip video hoặc ảnh trên timeline để áp dụng."}</p>
          <div className="preset-grid">{presets[tab].map((preset) => <button type="button" key={preset.label}
            className="studio-card preset-card" disabled={busy || !hasVisual} onClick={() => onApply(preset.look)}>
            <div className="preset-art" style={{ "--swatch": preset.swatch } as CSSProperties}><Icon name={selected.icon} size={24} /></div>
            <strong>{preset.label}</strong><small>{preset.detail}</small>
          </button>)}</div>
        </div>}
    </div>
  </section>;
}
