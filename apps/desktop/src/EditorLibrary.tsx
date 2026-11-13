import { useEffect, useState } from "react";
import type { ComponentProps, CSSProperties, ReactNode, RefObject } from "react";
import { api, desktop, mediaUrl } from "./desktop";
import type { Voice } from "./desktop";
import type { Asset, CaptionMotion, CatalogItem, ClipLook, ClipTransition, TitleStyle, TransitionKind } from "./desktop";
import { Icon } from "./Icon";
import { useMediaDrag } from "./MediaPanels";
import type { TimelineDrop } from "./TimelineEditor";
import { grades } from "./ClipInspector";
import { captionMotions, captionStyle, defaultTitle } from "./timeline";
import { captionPresets, extraFilters, transitions } from "./editorPresets";
import type { CaptionPreset } from "./editorPresets";
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
    { label: "Âm bản", detail: "Đảo màu của khung hình", swatch: "#7762aa", look: { effect: "invert" } },
    { label: "Ô điểm ảnh", detail: "Gom điểm ảnh thành khối khi xuất", swatch: "#3c7598", look: { effect: "mosaic" } },
    { label: "Vạch màn hình", detail: "Tạo vạch ngang kiểu màn hình cũ", swatch: "#52667d", look: { effect: "scanlines" } },
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
    ...extraFilters,
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

const favoritesKey = "dt-edit-library-favorites";
const normalized = (value: string) => value.toLowerCase().normalize("NFD").replace(/\p{M}/gu, "").replaceAll("đ", "d").trim();
const libraryTabs: LibraryTab[] = ["stickers", "effects", "transitions", "captions", "filters"];
const groups: Partial<Record<LibraryTab, string[]>> = {
  captions: ["Theo lời", "Hiện dần", "Tĩnh"],
  transitions: ["Mờ", "Trượt", "Vào và ra"],
};
const filterBase: Partial<ClipLook> = { tint: 0, shadows: 0, highlights: 0, blacks: 0 };

export interface SmartTarget { key: string; kind: string; track: string; layer: number; detached: boolean; linked: boolean }

/** Voice-over with system voices and caption translation with Claude. */
function VoiceAndTranslate({ busy, hasProject, hasCaptionLines, onSpeak, onTranslate }: {
  busy: boolean; hasProject: boolean; hasCaptionLines: boolean;
  onSpeak: (text: string, voice: string, rate: number) => void;
  onTranslate: (language: string) => void;
}) {
  const [voices, setVoices] = useState<Voice[] | null>(null);
  const [voice, setVoice] = useState("");
  const [rate, setRate] = useState(0);
  const [text, setText] = useState("");
  const [language, setLanguage] = useState("English");
  const [hasKey, setHasKey] = useState<boolean | null>(null);
  const [key, setKey] = useState("");
  useEffect(() => {
    if (!desktop) return;
    let current = true;
    void api.voices().then((list) => {
      if (!current) return;
      setVoices(list);
      setVoice((chosen) => chosen || list.find((item) => item.language.toLowerCase().startsWith("vi"))?.name || "");
    }).catch(() => { if (current) setVoices([]); });
    void api.aiKeyStatus().then((status) => { if (current) setHasKey(status); }).catch(() => undefined);
    return () => { current = false; };
  }, []);
  return <>
    <div className="tool-detail"><h3>Lồng tiếng bằng giọng trên máy</h3>
      <p>Dùng giọng đọc cài trong Windows hoặc macOS, không gửi nội dung ra ngoài. Tệp WAV được nhập vào thư viện và đặt ở tầng âm thanh tại playhead.</p>
      <label className="edit-field">Giọng
        <select value={voice} onChange={(event) => setVoice(event.target.value)} disabled={!voices?.length}>
          <option value="">Giọng mặc định</option>
          {voices?.map((item) => <option key={item.name} value={item.name}>{item.name} · {item.language}</option>)}
        </select>
      </label>
      {voices && !voices.some((item) => item.language.toLowerCase().startsWith("vi")) && <p className="inspector-help">Chưa thấy giọng tiếng Việt. Trên Windows, thêm gói giọng nói tiếng Việt trong Cài đặt › Thời gian và ngôn ngữ › Giọng nói.</p>}
      <label className="edit-field">Tốc độ đọc ({rate > 0 ? "+" : ""}{rate})
        <input type="range" min={-10} max={10} value={rate} onChange={(event) => setRate(Number(event.target.value))} />
      </label>
      <label className="edit-field">Nội dung
        <textarea rows={4} maxLength={5000} value={text} onChange={(event) => setText(event.target.value)} placeholder="Nhập lời đọc…" />
      </label>
      <button type="button" className="button primary" disabled={busy || !hasProject || !text.trim()} onClick={() => onSpeak(text, voice, rate)}>Tạo lời đọc</button>
    </div>
    <div className="tool-detail"><h3>Dịch phụ đề bằng Claude</h3>
      <p>Gửi chữ của các câu phụ đề (không gửi media) tới Anthropic bằng API key của bạn. Ứng dụng hỏi xác nhận trước mỗi lần gửi.</p>
      {hasKey ? <div className="inspector-inline"><span className="inspector-help">Đã lưu API key trong keychain.</span>
        <button type="button" className="button secondary compact" onClick={() => void api.setAiKey("").then(() => setHasKey(false))}>Xóa key</button></div>
        : <div className="inspector-inline">
          <input type="password" value={key} placeholder="Anthropic API key" aria-label="Anthropic API key" onChange={(event) => setKey(event.target.value)} />
          <button type="button" className="button secondary compact" disabled={!key.trim()}
            onClick={() => void api.setAiKey(key).then(() => { setKey(""); setHasKey(true); })}>Lưu key</button>
        </div>}
      <label className="edit-field">Dịch sang
        <input list="translate-languages" value={language} maxLength={40} onChange={(event) => setLanguage(event.target.value)} />
        <datalist id="translate-languages">{["Tiếng Việt", "English", "日本語", "한국어", "中文", "Français", "Español", "Deutsch", "ไทย"].map((name) => <option key={name} value={name} />)}</datalist>
      </label>
      <button type="button" className="button primary" disabled={busy || !hasKey || !hasCaptionLines || !language.trim()} onClick={() => onTranslate(language)}>Dịch toàn bộ phụ đề</button>
    </div>
  </>;
}

export function EditorLibrary({ onSpeak, onTranslate, hasCaptionLines, smartTarget, onSmartTool, tab, onTab, media, templates, montage, avatar, onRemoveBackground, catalog, catalogFailed, onRetryCatalog, busy, hasProject, hasVisual, hasSpeech, hasCaptions, onApply, onTitle, onAdd, onImportSrt, onExportSrt, onTranscribe, onCaptionMotion, canJoin, join, onJoin, timeline }: {
  tab: LibraryTab;
  onTab: (tab: LibraryTab) => void;
  smartTarget: SmartTarget | null;
  onSpeak: (text: string, voice: string, rate: number) => void;
  onTranslate: (language: string) => void;
  hasCaptionLines: boolean;
  onSmartTool: (tool: "scenes" | "silence" | "beats" | "track" | "speed" | "detach", key: string) => void;
  media: ReactNode;
  templates: ReactNode;
  montage: ReactNode;
  avatar: ReactNode;
  onRemoveBackground: () => void;
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
  onTranscribe: (language: string, chooseModel: boolean, motion: CaptionMotion, preset?: CaptionPreset) => void;
  onCaptionMotion: (motion: CaptionMotion, preset?: CaptionPreset) => void;
  canJoin: boolean;
  join?: ClipTransition;
  onJoin: (kind: TransitionKind | null, durationMs: number) => void;
  timeline: RefObject<TimelineDrop | null>;
}) {
  const stickerDrag = useMediaDrag(timeline, !busy);
  const [audioGroup, setAudioGroup] = useState<"music" | "sound" | "local">("music");
  const [textGroup, setTextGroup] = useState<"basic" | "presets">("basic");
  const [previewSound, setPreviewSound] = useState<number | null>(null);
  const [language, setLanguage] = useState("vi");
  const [captionMotion, setCaptionMotion] = useState<CaptionMotion>("highlight");
  const [captionPresetId, setCaptionPresetId] = useState<string | null>(null);
  const [searches, setSearches] = useState<Partial<Record<LibraryTab, string>>>({});
  const [category, setCategory] = useState<Partial<Record<LibraryTab, string>>>({});
  const [favorites, setFavorites] = useState<string[]>(() => {
    try {
      const saved: unknown = JSON.parse(localStorage.getItem(favoritesKey) ?? "[]");
      return Array.isArray(saved) ? saved.filter((value): value is string => typeof value === "string") : [];
    } catch { return []; }
  });
  const [joinDuration, setJoinDuration] = useState(500);
  const selected = tabs.find((item) => item.id === tab)!;
  const captionPreset = captionPresets.find((item) => item.id === captionPresetId)?.style;
  const categoryValue = category[tab] ?? "Tất cả";
  const matches = (id: string, name: string, group?: string, detail = "") =>
    normalized(`${name} ${detail}`).includes(normalized(searches[tab] ?? "")) &&
    (categoryValue === "Tất cả" || categoryValue === group || categoryValue === "Yêu thích" && favorites.includes(`${tab}:${id}`));
  const visibleCaptions = tab === "captions" ? captionPresets.filter((item) => matches(item.id, item.name, item.group)) : [];
  const visibleJoins = tab === "transitions" ? (Object.keys(transitions) as TransitionKind[]).filter((id) => matches(id, transitions[id].name, transitions[id].group)) : [];
  const visiblePresets = tab in presets ? presets[tab as keyof typeof presets].filter((preset) => !libraryTabs.includes(tab) ||
    matches(preset.label, preset.label, tab === "transitions" ? "Vào và ra" : undefined, preset.detail)) : [];
  const favorite = (id: string, name: string) => {
    const key = `${tab}:${id}`;
    return <button type="button" className="preset-favorite icon-button" aria-label={`Yêu thích ${name}`} aria-pressed={favorites.includes(key)}
      onClick={() => {
        const next = favorites.includes(key) ? favorites.filter((value) => value !== key) : [...favorites, key];
        setFavorites(next);
        try { localStorage.setItem(favoritesKey, JSON.stringify(next)); } catch { /* session only */ }
      }}>{favorites.includes(key) ? "★" : "☆"}</button>;
  };
  const hasStock = tab === "stickers" || tab === "audio" && audioGroup !== "local";
  const items = hasStock ? catalog?.filter((item) => item.group === (tab === "stickers" ? "sticker" : audioGroup)
    && (tab !== "stickers" || matches(item.asset.relativePath, item.title))) : undefined;
  return <section className="studio-pane library-pane" aria-label="Thư viện biên tập">
    <nav className="library-tabs" aria-label="Công cụ biên tập">
      {tabs.map(({ id, label, icon }) => <button type="button" key={id} aria-pressed={tab === id}
        onClick={() => { setPreviewSound(null); onTab(id); }}><Icon name={icon} size={19} />{label}</button>)}
    </nav>
    <div className="library-layout">
      {tab === "audio" && <nav className="library-sidebar" aria-label="Nhóm âm thanh">
        {([["music", "Nhạc nền"], ["sound", "Hiệu ứng âm thanh"], ["local", "Tệp của tôi"]] as const).map(([id, label]) =>
          <button type="button" key={id} aria-pressed={audioGroup === id}
            onClick={() => { setPreviewSound(null); setAudioGroup(id); }}>{label}</button>)}
      </nav>}
      {tab === "text" && <nav className="library-sidebar" aria-label="Nhóm chữ">
        <button type="button" aria-pressed={textGroup === "basic"} onClick={() => setTextGroup("basic")}>Chữ cơ bản</button>
        <button type="button" aria-pressed={textGroup === "presets"} onClick={() => setTextGroup("presets")}>Mẫu chữ</button>
        <button type="button" onClick={() => onTab("captions")}>Phụ đề</button>
      </nav>}
      <div className="library-body" key={tab} aria-label={selected.label}>
      {libraryTabs.includes(tab) && <div className="library-search-row">
        <input type="search" aria-label={`Tìm trong ${selected.label}`} placeholder="Tìm mẫu…" value={searches[tab] ?? ""}
          onChange={(event) => setSearches({ ...searches, [tab]: event.target.value })} />
        <select aria-label="Nhóm mẫu" value={categoryValue} onChange={(event) => setCategory({ ...category, [tab]: event.target.value })}>
          {["Tất cả", "Yêu thích", ...(groups[tab] ?? [])].map((group) => <option key={group}>{group}</option>)}
        </select>
      </div>}
      {(tab === "media" || tab === "audio" && audioGroup === "local") && media}
      {hasStock && <div className="library-section">
        <h2>{tab === "stickers" ? "Sticker DT_Edit" : audioGroup === "music" ? "Nhạc nền DT_Edit" : "Hiệu ứng âm thanh"}</h2>
        <p>{tab === "stickers" ? "Thêm lớp hình trong suốt tại playhead." : "Nghe thử hoặc thêm vào tầng âm thanh tại playhead."}</p>
        {!items && (catalogFailed ? <button type="button" className="button secondary" onClick={onRetryCatalog}>Tải lại thư viện</button> : <p>Đang tải tài nguyên…</p>)}
        <div className={tab === "stickers" ? "preset-grid" : "sound-list"}>
          {items?.map(({ asset, title }) => <article key={asset.id} className="studio-card">
            {tab === "stickers" && favorite(asset.relativePath, title)}
            {tab === "stickers" && <button type="button" className="sticker-art" aria-label={`Thêm ${title} vào timeline`}
              disabled={busy} onClick={(event) => { if (event.detail === 0 || !stickerDrag.moved()) onAdd(asset, true); }}
              onPointerDown={(event) => stickerDrag.startDrag(event, asset)}
              onPointerMove={(event) => stickerDrag.moveDrag(event, false)} onPointerUp={(event) => stickerDrag.moveDrag(event, true)}
              onPointerCancel={stickerDrag.cancel} onLostPointerCapture={stickerDrag.clear} onDragStart={(event) => event.preventDefault()}>
              <img src={mediaUrl("source", asset.id, 0)} alt="" draggable={false} />
            </button>}
            <div className="studio-card-row"><div className="studio-card-label">
              <strong>{title}</strong><small>{duration(asset.durationMs) || "PNG trong suốt"}</small>
            </div>
            {tab === "audio" && <button type="button" className="icon-button" aria-label={`Nghe ${title}`}
              aria-pressed={previewSound === asset.id} onClick={() => setPreviewSound(previewSound === asset.id ? null : asset.id)}>
              <Icon name={previewSound === asset.id ? "pause" : "play"} size={15} />
            </button>}
            {tab === "audio" && <button type="button" className="icon-button" aria-label={`Thêm ${title}`} disabled={busy || !hasProject}
              onClick={() => onAdd(asset, false)}><Icon name="plus" size={16} /></button>}</div>
            {previewSound === asset.id && <audio src={mediaUrl("source", asset.id, 0)} controls autoPlay preload="metadata" />}
          </article>)}
          {items?.length === 0 && <p>Không tìm thấy mẫu.</p>}
        </div>
      </div>}
      {tab === "text" && <div className="library-section"><h2>{textGroup === "basic" ? "Chữ cơ bản" : "Mẫu chữ"}</h2><p>Chèn tại playhead rồi chỉnh nội dung trong Thuộc tính.</p>
        <div className="preset-grid">{(textGroup === "basic" ? titles.slice(0, 1) : titles.slice(1)).map((item) => <button type="button" key={item.label} className="studio-card preset-card"
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
          <p>Chọn clip có tiếng. Tạo phụ đề dùng mô hình Whisper có sẵn, tự tải nếu thiếu.</p>
          <label className="edit-field">Ngôn ngữ<select value={language} onChange={(event) => setLanguage(event.target.value)}>
            <option value="vi">Tiếng Việt</option><option value="en">Tiếng Anh</option><option value="auto">Tự nhận diện</option>
          </select></label>
          <label className="edit-field">Kiểu phụ đề<select value={captionMotion} onChange={(event) => { setCaptionMotion(event.target.value as CaptionMotion); setCaptionPresetId(null); }}>
            {Object.entries(captionMotions).map(([key, name]) => <option key={key} value={key}>{name}</option>)}
          </select></label>
          <div className="library-filters">
            <button type="button" className="button primary" disabled={busy || !hasSpeech} onClick={() => onTranscribe(language, false, captionMotion, captionPreset)}>Tạo phụ đề</button>
            <button type="button" className="button secondary compact" disabled={busy || !hasCaptions} onClick={() => onCaptionMotion(captionMotion, captionPreset)}>Áp dụng cho phụ đề hiện có</button>
          </div>
          {hasCaptions && captionMotion !== "static" && <p>Phụ đề chưa có mốc từng từ sẽ dùng mốc ước tính. Tạo từ clip có tiếng để bám sát lời nói.</p>}
          <details className="caption-options"><summary>Mô hình tùy chọn</summary>
            <button type="button" className="button secondary compact" disabled={busy || !hasSpeech} onClick={() => onTranscribe(language, true, captionMotion, captionPreset)}>Chọn tệp GGML…</button>
          </details>
        </div>
        <h3>Mẫu phụ đề</h3>
        <div className="preset-grid">
          {visibleCaptions.map((item) => <article className="studio-card" key={item.id}>
            {favorite(item.id, item.name)}
            <button type="button" className="preset-card" disabled={busy} aria-pressed={captionPresetId === item.id}
              onClick={() => { setCaptionPresetId(item.id); setCaptionMotion(item.style.captionMotion); }}>
              <span className="caption-preset-art" style={{ "--caption-ink": ("colorHex" in item.style ? item.style.colorHex : undefined) ?? "#fff",
                "--caption-accent": ("highlightHex" in item.style ? item.style.highlightHex : undefined) ?? "#fff" } as CSSProperties}>Xin <strong>chào</strong></span>
              <strong>{item.name}</strong><small>{item.group}</small>
            </button>
          </article>)}
        </div>
        {!visibleCaptions.length && <p>Không tìm thấy mẫu phụ đề.</p>}
      </div>}
      {tab === "templates" && templates}
      {tab === "smart" && <div className="library-section smart-tools">
        <h2>Công cụ thông minh</h2>
        {montage}
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
        <VoiceAndTranslate busy={busy} hasProject={hasProject} hasCaptionLines={hasCaptionLines} onSpeak={onSpeak} onTranslate={onTranslate} />
        <div className="tool-detail"><h3>Xóa nền AI</h3>
          <p>Dùng rembg và U²-Net trên máy. Hỗ trợ ảnh và đoạn video đã trim từ 0,5 đến 8 giây.</p>
          <button type="button" className="button secondary" disabled={busy || smartTarget?.track !== "video"} onClick={onRemoveBackground}>Xóa nền clip đang chọn</button>
        </div>
        {avatar}
      </div>}
      {tab === "transitions" && categoryValue !== "Vào và ra" && <div className="library-section">
        <h2>Điểm nối hai clip</h2>
        <p>Chọn clip phía sau trên cùng tầng. Hai clip phải chạm mép.</p>
        <label className="edit-field">Thời lượng chuyển cảnh (ms)
          <input type="number" min={100} max={3000} step={100} value={joinDuration}
            onChange={(event) => setJoinDuration(Number(event.target.value))} />
        </label>
        <div className="preset-grid">
          {visibleJoins.map((id) => <article className="studio-card" key={id}>
              {favorite(id, transitions[id].name)}
              <button type="button" className="preset-card" disabled={busy || !canJoin} aria-pressed={join?.kind === id}
                onClick={() => onJoin(id, joinDuration)}>
                <span className="preset-art" style={{ "--swatch": transitions[id].swatch } as CSSProperties}><Icon name="transition" size={22} /></span>
                <strong>{transitions[id].name}</strong>
              </button>
            </article>)}
        </div>
        {!visibleJoins.length && <p>Không tìm thấy mẫu chuyển cảnh.</p>}
        <div className="library-filters">
          <button type="button" className="button secondary compact" disabled={busy || !join}
            onClick={() => onJoin(null, 0)}>Gỡ điểm nối</button>
        </div>
        {join && <p>{transitions[join.kind].name} · {join.durationMs} ms</p>}
      </div>}
      {(tab === "effects" || tab === "transitions" && !["Mờ", "Trượt"].includes(categoryValue) || tab === "filters" || tab === "adjustment" || tab === "advanced") &&
        <div className="library-section"><h2>{tab === "transitions" ? "Vào và ra trên một clip" : selected.label}</h2><p>{hasVisual
          ? "Bấm một mẫu để áp dụng cho clip đang chọn."
          : "Chọn một clip video hoặc ảnh trên timeline để áp dụng."}</p>
          <div className="preset-grid">{visiblePresets.map((preset) => <article className="studio-card" key={preset.label}>
            {libraryTabs.includes(tab) && favorite(preset.label, preset.label)}
            <button type="button" className="preset-card" disabled={busy || !hasVisual}
              onClick={() => onApply(tab === "filters" ? { ...filterBase, ...preset.look } : preset.look)}>
            <div className="preset-art" style={{ "--swatch": preset.swatch } as CSSProperties}><Icon name={selected.icon} size={24} /></div>
            <strong>{preset.label}</strong><small>{preset.detail}</small>
            </button>
          </article>)}</div>
          {!visiblePresets.length && <p>Không tìm thấy mẫu.</p>}
        </div>}
      </div>
    </div>
  </section>;
}
