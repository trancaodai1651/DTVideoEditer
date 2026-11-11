import { useCallback, useDeferredValue, useEffect, useEffectEvent, useRef, useState } from "react";
import type { FormEvent } from "react";
import { api, desktop, fileName } from "./desktop";
import type { Aspect, Asset, AssetPage, CatalogItem, ClipLook, Cue, ExportRange, Folder, ImportedFiles, MediaDrop, MediaKind, MediaTools, Project, RenderJob, TimelineSnapshot, TitleStyle } from "./desktop";
import { Icon } from "./Icon";
import { Gallery, Preview, selectAsset } from "./MediaPanels";
import { PublishPanel } from "./PublishPanel";
import type { Selection } from "./MediaPanels";
import { MAX_LAYERS, addCaptions, addClip, addTitle, changeLayer, clipFinish, commit, defaultLook, fromTimeline, layerOf, lookAt, newHistory, playbackRate, previousVisual, redo, setTransformKey, setTransition, subtitleCues, toSnapshot, totalMs, trackOf, transformProperties, undo, updateAppearance } from "./timeline";
import type { Clip, History, MediaRef } from "./timeline";
import { TimelineEditor } from "./TimelineEditor";
import type { Lane, TimelineDrop, TimelineDropTarget } from "./TimelineEditor";
import { ClipInspector } from "./ClipInspector";
import type { InspectorTab } from "./ClipInspector";
import { EditorLibrary } from "./EditorLibrary";
import type { LibraryTab } from "./EditorLibrary";
import { EditorPlayer } from "./EditorPlayer";
import { ExportQueue } from "./ExportQueue";
import { TemplateLibrary } from "./TemplateLibrary";
import { vi } from "./vi";

type View = "library" | "queue" | "publish" | "settings";
const viewName: Record<View, string> = {
  library: "Biên tập", queue: "Hàng đợi xuất", publish: vi.publish, settings: vi.settings,
};
type Notice = { text: string; error: boolean };
const EMPTY_PAGE: AssetPage = { items: [], total: 0, pageSize: 48 };
const isActive = (job: RenderJob) => job.status === "queued" || job.status === "running";

/** The preview target for a clip, seeked to the source frame under the playhead. */
function clipSelection(clip: Clip, playheadMs: number): Selection | null {
  if (clip.kind === "text") return null;
  const inside = playheadMs >= clip.positionMs && playheadMs < clipFinish(clip);
  return {
    assetId: clip.assetId, relativePath: clip.relativePath, kind: clip.kind, durationMs: clip.sourceMs,
    seekMs: clip.kind === "image" ? undefined : clip.startMs + (inside ? (playheadMs - clip.positionMs) * playbackRate(clip) : 0),
    width: clip.width, height: clip.height, hasThumbnail: clip.hasThumbnail,
  };
}

export function App() {
  const timelineDrop = useRef<TimelineDrop>(null);
  const dropTargets = useRef(new Map<number, { projectId: number; target: TimelineDropTarget }>());
  const [view, setView] = useState<View>("library");
  const [tool, setTool] = useState<LibraryTab>("media");
  const [inspectorTab, setInspectorTab] = useState<InspectorTab>("video");
  const [folders, setFolders] = useState<Folder[]>([]);
  const [folderId, setFolderId] = useState<number | null>(null);
  const [page, setPage] = useState(0);
  const [assets, setAssets] = useState<AssetPage | null>(desktop ? null : EMPTY_PAGE);
  const [query, setQuery] = useState("");
  const [kind, setKind] = useState<MediaKind | null>(null);
  const search = useDeferredValue(query);
  const mediaKind = tool === "audio" ? "audio" : kind;
  const [catalog, setCatalog] = useState<CatalogItem[] | null>(null);
  const [catalogFailed, setCatalogFailed] = useState(false);
  const [catalogRetry, setCatalogRetry] = useState(0);
  const [selection, setSelection] = useState<Selection | null>(null);
  const [projects, setProjects] = useState<Project[]>([]);
  const [projectId, setProjectId] = useState<number | null>(null);
  const [projectName, setProjectName] = useState("");
  const [history, setHistory] = useState<History>(newHistory);
  const [aspect, setAspect] = useState<Aspect>("source");
  const [lane, setLane] = useState<Lane>({ track: "video", layer: 0 });
  const [frameMode, setFrameMode] = useState(false);
  const [playing, setPlaying] = useState(false);
  const playback = useRef({ from: 0, start: 0 });
  const projectMenu = useRef<HTMLDetailsElement>(null);
  const [selectedKey, setSelectedKey] = useState<string | null>(null);
  const [playheadMs, setPlayheadMs] = useState(0);
  const [rangeMarks, setRangeMarks] = useState<{ projectId: number; start?: number; end?: number } | null>(null);
  const [saveState, setSaveState] = useState<"saved" | "saving" | "error">("saved");
  const [jobs, setJobs] = useState<RenderJob[]>([]);
  const saves = useRef({ chain: Promise.resolve(), pending: 0, failed: false });
  const [tools, setTools] = useState<MediaTools | null>(null);
  const [busy, setBusy] = useState("");
  const [notice, setNotice] = useState<Notice | null>(null);
  const [libraryRevision, setLibraryRevision] = useState(0);
  const [timelineRevision, setTimelineRevision] = useState(0);
  const [revokeId, setRevokeId] = useState<number | null>(null);
  const project = projects.find((item) => item.id === projectId);
  const disabled = !!busy || !desktop;
  const clips = history.present;
  const selectedClip = clips.find((clip) => clip.key === selectedKey);
  const total = totalMs(clips);
  const marks = rangeMarks?.projectId === projectId ? rangeMarks : null;
  const exportRange: ExportRange | undefined = marks
    ? { startMs: marks.start ?? 0, endMs: Math.min(total, marks.end ?? total) } : undefined;
  const captions = subtitleCues(clips);
  const needCatalog = view === "library" && (tool === "audio" || tool === "stickers");
  const rendering = jobs.some(isActive);

  useEffect(() => {
    if (!desktop) return;
    let current = true;
    void Promise.all([api.folders(), api.projects(), api.tools(), api.renderQueue()]).then(([grants, saved, capabilities, queue]) => {
      if (!current) return;
      setFolders(grants);
      setProjects(saved);
      setProjectId((existing) => existing ?? saved[0]?.id ?? null);
      setTools(capabilities);
      setJobs(queue);
    }).catch((error: unknown) => {
      if (current) setNotice({ text: String(error), error: true });
    });
    return () => { current = false; };
  }, []);

  useEffect(() => {
    if (!desktop) return;
    let current = true;
    void api.assets(folderId, page, search, mediaKind).then((data) => {
      if (current) setAssets(data);
    }).catch((error: unknown) => {
      if (current) {
        setAssets(EMPTY_PAGE);
        setNotice({ text: String(error), error: true });
      }
    });
    return () => { current = false; };
  }, [folderId, page, libraryRevision, search, mediaKind]);

  useEffect(() => {
    if (!desktop || !needCatalog || catalog || disabled) return;
    let current = true;
    void api.catalog().then((items) => { if (current) setCatalog(items); })
      .catch((error: unknown) => {
        if (current) { setCatalogFailed(true); setNotice({ text: String(error), error: true }); }
      });
    return () => { current = false; };
  }, [needCatalog, catalog, disabled, catalogRetry]);

  useEffect(() => {
    if (!playing || view !== "library" || !frameMode) return;
    let frame = 0;
    let last = 0;
    function tick(now: number) {
      const current = playback.current;
      const at = Math.min(total, Math.max(0, Math.round(current.from + now - current.start)));
      if (at >= total) {
        setPlayheadMs(total);
        setPlaying(false);
        return;
      }
      if (now - last >= 32) {
        setPlayheadMs(at);
        last = now;
      }
      frame = requestAnimationFrame(tick);
    }
    frame = requestAnimationFrame(tick);
    return () => cancelAnimationFrame(frame);
  }, [playing, view, frameMode, total]);

  useEffect(() => {
    if (projectId === null) return;
    let current = true;
    // Wait for queued saves so a reload never reads a stale timeline.
    void saves.current.chain.then(() => api.timeline(projectId)).then((saved) => {
      if (!current) return;
      setHistory(newHistory(fromTimeline(saved)));
      setSelectedKey(null);
      setPlayheadMs(0);
      setAspect(saved.aspect ?? "source");
      setLane({ track: "video", layer: 0 });
      setFrameMode(false);
      setPlaying(false);
      setSaveState("saved");
      saves.current.failed = false;
    }).catch((error: unknown) => {
      if (current) setNotice({ text: String(error), error: true });
    });
    return () => { current = false; };
  }, [projectId, timelineRevision]);

  const receiveDrop = useEffectEvent((drop: MediaDrop) => {
    if (drop.type === "started") {
      const target = timelineDrop.current?.target(drop.x / window.devicePixelRatio, drop.y / window.devicePixelRatio);
      if (target && project) dropTargets.current.set(drop.id, { projectId: project.id, target });
      return;
    }
    const captured = dropTargets.current.get(drop.id);
    dropTargets.current.delete(drop.id);
    if ("Err" in drop.result) {
      setNotice({ text: drop.result.Err, error: true });
      return;
    }
    const target = captured?.projectId === project?.id && view === "library" && !disabled ? captured?.target : undefined;
    applyImported(drop.result.Ok, target);
  });

  useEffect(() => {
    if (!desktop) return;
    let active = true;
    const listener = api.onMediaDrop((drop) => { if (active) receiveDrop(drop); });
    void listener.catch((error: unknown) => { if (active) setNotice({ text: String(error), error: true }); });
    return () => { active = false; void listener.then((unlisten) => unlisten(), () => undefined); };
  }, []);

  useEffect(() => {
    if (!desktop || (!rendering && view !== "queue")) return;
    let current = true;
    const timer = setInterval(() => {
      void api.renderQueue().then((queue) => { if (current) setJobs(queue); }).catch(() => undefined);
    }, 500);
    return () => { current = false; clearInterval(timer); };
  }, [rendering, view]);

  useEffect(() => {
    function shortcuts(event: KeyboardEvent) {
      if (!(event.ctrlKey || event.metaKey) || event.altKey) return;
      if (event.target instanceof HTMLInputElement || event.target instanceof HTMLTextAreaElement) return;
      const key = event.key.toLowerCase();
      if (key !== "z" && key !== "y") return;
      event.preventDefault();
      document.getElementById(key === "y" || event.shiftKey ? "timeline-redo" : "timeline-undo")?.click();
    }
    window.addEventListener("keydown", shortcuts);
    return () => window.removeEventListener("keydown", shortcuts);
  }, []);

  async function run(label: string, action: () => Promise<void>) {
    if (disabled) return;
    setPlaying(false);
    setBusy(label);
    setNotice(null);
    try {
      await action();
    } catch (error) {
      setNotice({ text: String(error), error: true });
    } finally {
      setBusy("");
    }
  }

  const notify = useCallback((text: string, error: boolean) => setNotice({ text, error }), []);

  function success(text: string) {
    setNotice({ text, error: false });
  }

  async function refreshLibrary() {
    setFolders(await api.folders());
    setPage(0);
    setLibraryRevision((value) => value + 1);
  }

  function pickFolder() {
    void run(vi.picking, async () => {
      const picked = await api.pickFolder();
      if (picked === null) return;
      setFolderId(picked);
      setView("library");
      setBusy(vi.scanning);
      try {
        success(vi.scanReport(await api.scan(picked)));
      } finally {
        await refreshLibrary();
        setTimelineRevision((value) => value + 1);
      }
    });
  }

  function rescan(id: number) {
    void run(vi.scanning, async () => {
      success(vi.scanReport(await api.scan(id)));
      await refreshLibrary();
      setTimelineRevision((value) => value + 1);
    });
  }

  function revoke(id: number) {
    void run(vi.working, async () => {
      await saves.current.chain;
      await api.revoke(id);
      setRevokeId(null);
      setSelection(null);
      if (folderId === id) setFolderId(null);
      await refreshLibrary();
      setTimelineRevision((value) => value + 1);
      success(vi.revoked);
    });
  }

  function applyImported(report: ImportedFiles, target?: TimelineDropTarget) {
    if (!report.assets.length) {
      setNotice({ text: "Không có tệp media đọc được trong lựa chọn.", error: true });
      return;
    }
    setFolderId(null);
    setQuery("");
    setKind(null);
    setTool("media");
    setView("library");
    void refreshLibrary().catch((error: unknown) => setNotice({ text: String(error), error: true }));
    let inserted = 0;
    if (target && project) {
      let next = clips;
      const times = { video: target.positionMs, audio: target.positionMs };
      for (const asset of report.assets) {
        const media = selectAsset(asset);
        const track = trackOf(media.kind);
        const added = addClip(next, media, times[track], target.lane.track === track ? target.lane.layer : 0);
        if (!added) continue;
        next = added;
        times[track] = clipFinish(added.at(-1)!);
        inserted += 1;
      }
      if (inserted) {
        const first = next[clips.length];
        edit(commit(history, next));
        setSelectedKey(first.key);
        setInspectorTab(first.track === "audio" ? "audio" : "video");
        setLane({ track: first.track, layer: layerOf(first) });
        setPlayheadMs(first.positionMs);
        setFrameMode(true);
        setPlaying(false);
      }
    }
    success(`Đã nhập ${report.assets.length} tệp${target ? `, đặt ${inserted} clip lên timeline` : ""}${report.skipped ? `, bỏ qua ${report.skipped} tệp` : ""}.`);
  }

  function pickMediaFiles() {
    void run("Đang nhập tệp media…", async () => {
      const report = await api.pickMediaFiles();
      if (report) applyImported(report);
    });
  }

  function createProject(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    void run(vi.working, async () => {
      const created = await api.createProject(projectName);
      setProjects((saved) => [created, ...saved]);
      setProjectId(created.id);
      setHistory(newHistory());
      setAspect("source");
      setProjectName("");
      if (projectMenu.current) projectMenu.current.open = false;
      setView("library");
      success(vi.projectCreated);
    });
  }

  /** Applies an edit and queues its save. Saves run in order, one at a time. */
  function edit(next: History, nextAspect = aspect) {
    if (!project || (next === history && nextAspect === aspect)) return;
    const id = project.id;
    const snapshot = toSnapshot(next.present, nextAspect);
    setHistory(next);
    setAspect(nextAspect);
    setSaveState("saving");
    const queue = saves.current;
    queue.pending += 1;
    queue.chain = queue.chain.then(() => api.saveTimeline(id, snapshot)).then(() => {
      queue.failed = false;
      queue.pending -= 1;
      if (queue.pending === 0) setSaveState("saved");
    }, (error: unknown) => {
      queue.failed = true;
      queue.pending -= 1;
      setSaveState("error");
      setNotice({ text: String(error), error: true });
    });
  }

  function addMedia(media: MediaRef, positionMs?: number, target = lane, appearance?: Partial<ClipLook>) {
    if (!project || disabled) return;
    const track = trackOf(media.kind);
    const next = addClip(clips, media, positionMs, target.track === track ? target.layer : 0);
    if (!next) return setNotice({ text: vi.clipNoLength, error: true });
    const inserted = next[next.length - 1];
    if (appearance) next[next.length - 1] = { ...inserted, look: appearance };
    edit(commit(history, next));
    setSelectedKey(inserted.key);
    setInspectorTab(track === "audio" ? "audio" : "video");
    setLane({ track, layer: layerOf(inserted) });
    setPlaying(false);
    if (track === "video" && (playheadMs < inserted.positionMs || playheadMs >= clipFinish(inserted))) setPlayheadMs(inserted.positionMs);
    setFrameMode(track === "video");
    success(vi.clipAdded);
  }

  function selectClip(key: string | null) {
    setSelectedKey(key);
    const clip = clips.find((item) => item.key === key);
    if (!clip) return;
    setLane({ track: clip.track, layer: layerOf(clip) });
    if (clip.track !== "audio") {
      setFrameMode(true);
      if (playheadMs < clip.positionMs || playheadMs >= clipFinish(clip)) movePlayhead(clip.positionMs);
    } else if (clip.available) {
      setFrameMode(false);
      setPlaying(false);
      setSelection(clipSelection(clip, playheadMs));
    }
  }

  function movePlayhead(ms: number) {
    const at = Math.min(total, Math.max(0, ms));
    playback.current = { from: at, start: performance.now() };
    setPlayheadMs(at);
    setFrameMode(true);
  }

  function togglePlayback() {
    if (total <= 0 || disabled) return;
    if (playing) { setPlaying(false); return; }
    const at = playheadMs >= total ? 0 : playheadMs;
    movePlayhead(at);
    setPlaying(true);
  }

  function insertTitle(style?: TitleStyle) {
    if (!project || disabled) return;
    const next = addTitle(clips, playheadMs, lane.track === "text" ? lane.layer : 0, style);
    const title = next.at(-1);
    if (next === clips || !title) return;
    edit(commit(history, next));
    setSelectedKey(title.key);
    setPlaying(false);
    setPlayheadMs(title.positionMs);
    setFrameMode(true);
  }

  function openTool(tab: LibraryTab) {
    if ((tab === "audio") !== (tool === "audio")) { setPage(0); setQuery(""); }
    setTool(tab);
    if (tab === "adjustment") setInspectorTab("adjust");
    if (tab === "advanced") setInspectorTab("advanced");
  }

  function changeClip(clip: Clip, animate = false) {
    try {
      const before = clips.find((item) => item.key === clip.key);
      const original = before?.look;
      if (before && original?.keyframes?.length && clip.look?.keyframes === original.keyframes) {
        const elapsed = playheadMs - before.positionMs;
        const changed = { ...defaultLook, ...clip.look };
        if (animate) {
          if (elapsed < 0 || elapsed > clipFinish(before) - before.positionMs) return;
          clip = setTransformKey(clip, elapsed, changed);
        }
        else {
          for (const property of transformProperties) changed[property] = original[property] ?? defaultLook[property];
          clip = { ...clip, look: changed };
        }
      }
      edit(commit(history, updateAppearance(clips, clip)));
    }
    catch (error) { notify(String(error), true); }
  }

  function toggleTransformKey(clip: Clip, elapsed: number) {
    try { changeClip(setTransformKey(clip, elapsed, lookAt(clip, elapsed), true)); }
    catch (error) { notify(String(error), true); }
  }

  function applyLook(look: Partial<ClipLook>) {
    if (!selectedClip || selectedClip.track !== "video") return;
    if (selectedClip.kind !== "video" && (look.stabilize || look.opticalFlow)) {
      notify("Chọn clip video để dùng ổn định hoặc nội suy chuyển động.", true);
      return;
    }
    changeClip({ ...selectedClip, look: { ...defaultLook, ...selectedClip.look, ...look } });
    setFrameMode(true);
    if (tool === "transitions") setInspectorTab("animation");
    if (tool === "filters" || tool === "adjustment") setInspectorTab("adjust");
    success("Đã áp dụng cho clip đang chọn.");
  }

  function addStock(asset: Asset, sticker: boolean) {
    const media = selectAsset(asset);
    if (!sticker) { addMedia(media, playheadMs, lane); return; }
    const layer = Math.min(MAX_LAYERS - 1, clips.filter((clip) => clip.track === "video")
      .reduce((highest, clip) => Math.max(highest, layerOf(clip) + 1), 1));
    addMedia(media, playheadMs, { track: "video", layer }, { scale: 28, x: 25, y: -20 });
  }

  function loadCues(cues: Cue[], offset: number) {
    if (!cues.length) { notify("Không tìm thấy câu phụ đề.", false); return; }
    const next = addCaptions(clips, cues, offset);
    edit(commit(history, next));
    setPlayheadMs(cues[0].startMs + offset);
    setSelectedKey(next[clips.length].key);
    setFrameMode(true);
    success(`Đã thêm ${cues.length} câu phụ đề.`);
  }

  function importSrt() {
    void run("Đang nhập phụ đề…", async () => { const cues = await api.importSrt(); if (cues) loadCues(cues, 0); });
  }

  function exportSrt() {
    void run("Đang xuất phụ đề…", async () => { if (await api.exportSrt(captions)) success("Đã xuất phụ đề SRT."); });
  }

  function transcribe(language: string) {
    if (!selectedClip || !["video", "audio"].includes(selectedClip.kind)) return;
    void run("Đang nhận dạng giọng nói trên máy…", async () => {
      const { assetId, startMs, endMs, positionMs, look } = selectedClip;
      const cues = await api.transcribe({ assetId, startMs, endMs, speed: look?.speed ?? 100 }, language);
      if (cues) loadCues(cues, positionMs);
    });
  }

  function startRender(queueOnly: boolean) {
    if (!project) return;
    if (exportRange && exportRange.endMs - exportRange.startMs < 100) {
      notify("Vùng In–Out nằm ngoài timeline hiện tại. Hãy đặt lại hoặc bỏ vùng.", true);
      return;
    }
    void run(vi.working, async () => {
      await saves.current.chain;
      if (saves.current.failed) throw new Error("Timeline chưa lưu thành công. Hãy sửa lỗi lưu trước khi xuất.");
      const job = await api.startRender(project.id, queueOnly, exportRange);
      if (!job) return;
      setJobs(await api.renderQueue());
      setView("queue");
      success(queueOnly ? "Đã thêm bản dựng vào hàng đợi." : vi.exportStarted);
    });
  }

  function markRange(edge: "start" | "end" | "clear") {
    if (!project) return;
    if (edge === "clear") { setRangeMarks(null); return; }
    const at = Math.min(total, Math.max(0, Math.round(Math.round(playheadMs * 30 / 1000) * 1000 / 30)));
    const next = edge === "start" ? { start: at, end: marks?.end } : { start: marks?.start, end: at };
    if ((next.end ?? total) - (next.start ?? 0) < 100) {
      notify("Vùng In–Out phải dài ít nhất 100 ms.", true);
      return;
    }
    setRangeMarks({ projectId: project.id, ...next });
  }

  function retryRender(jobId: number) {
    void run(vi.working, async () => {
      await api.retryRender(jobId);
      setJobs(await api.renderQueue());
    });
  }

  function cancelRender(jobId: number) {
    void api.cancelRender(jobId).then(api.renderQueue).then(setJobs)
      .catch((error: unknown) => setNotice({ text: String(error), error: true }));
  }

  async function openTemplateProject(name: string, snapshot: TimelineSnapshot) {
    await saves.current.chain;
    const created = await api.createEditedProject(name, snapshot);
    setProjects((saved) => [created, ...saved]);
    setProjectId(created.id);
    setHistory(newHistory());
    setTool("media");
    setView("library");
    success("Đã tạo dự án từ mẫu.");
  }

  return (
    <div className="studio-shell">
      <header className="studio-top">
        <div className="studio-brand"><span className="brand-icon"><Icon name="play" size={17} /></span><strong>{vi.brand}</strong></div>
        <details className="studio-project-menu" ref={projectMenu}>
          <summary>Dự án</summary>
          <div className="project-popover">
            <label className="edit-field">Dự án đang mở
              <select value={projectId ?? ""} disabled={disabled || projects.length === 0}
                onChange={(event) => {
                  setHistory(newHistory()); setProjectId(Number(event.target.value)); setPlaying(false);
                  if (projectMenu.current) projectMenu.current.open = false;
                }}>
                {!projects.length && <option value="">{vi.projectNone}</option>}
                {projects.map((item) => <option key={item.id} value={item.id}>{item.name}</option>)}
              </select>
            </label>
            <form onSubmit={createProject}>
              <label className="edit-field">{vi.projectName}
                <input value={projectName} maxLength={160} required placeholder={vi.projectPlaceholder}
                  disabled={disabled} onChange={(event) => setProjectName(event.target.value)} />
              </label>
              <button type="submit" className="button primary compact" disabled={disabled || !projectName.trim()}>
                <Icon name="plus" size={16} />{vi.create}
              </button>
            </form>
          </div>
        </details>
        <span className="studio-project-title" title={project?.name}>{project?.name ?? vi.projectNone}</span>
        <nav className="studio-navigation" aria-label={vi.workspace}>
          {(["library", "queue", "publish", "settings"] as const).map((id) => <button type="button" key={id}
            aria-current={view === id ? "page" : undefined} onClick={() => { setPlaying(false); setView(id); }}>{viewName[id]}</button>)}
        </nav>
        <button type="button" className="button primary compact studio-export" disabled={disabled || !project || total === 0}
          onClick={() => startRender(false)}><Icon name="export" size={16} />Xuất</button>
      </header>

      <main className={`studio-main ${view === "library" ? "studio-editor-main" : "studio-subpage"}`}>
        {view !== "library" && <div className="subpage-heading"><h1>{viewName[view]}</h1>
          {view === "settings" && <button type="button" className="button primary compact" onClick={pickFolder} disabled={disabled}>{vi.pick}</button>}
        </div>}
        <div className="notification" aria-live="polite">
          {!desktop && <p className="notice">{vi.browserHint}</p>}
          {busy && <p className="notice"><span className="spinner" aria-hidden="true" />{busy}</p>}
          {!busy && notice && <p className={`notice ${notice.error ? "error" : "success"}`}>
            <Icon name={notice.error ? "close" : "check"} />{notice.text}
          </p>}
        </div>

        {view === "library" ? <div className="editor-workspace">
          <div className="editor-columns">
            <EditorLibrary tab={tool} onTab={openTool} busy={disabled} catalog={catalog} catalogFailed={catalogFailed}
              onRetryCatalog={() => { setCatalogFailed(false); setCatalogRetry((value) => value + 1); }}
              hasProject={!!project} hasVisual={selectedClip?.track === "video"}
              hasSpeech={!!selectedClip && (selectedClip.kind === "audio" || selectedClip.kind === "video") && selectedClip.available}
              hasCaptions={captions.length > 0} onApply={applyLook} onTitle={insertTitle} onAdd={addStock}
              onImportSrt={importSrt} onExportSrt={exportSrt} onTranscribe={transcribe}
              canJoin={!!selectedClip && !!previousVisual(clips, selectedClip)} join={selectedClip?.look?.transition}
              onJoin={(kind, duration) => {
                if (!selectedClip) return;
                edit(commit(history, setTransition(clips, selectedClip, kind, duration)));
                movePlayhead(selectedClip.positionMs);
              }}
              media={<Gallery data={assets} folders={folders} folderId={folderId} page={page} revision={libraryRevision}
                selected={selection?.assetId} onSelect={(asset) => { setSelection(asset); setFrameMode(false); setPlaying(false); }}
                query={query} onQuery={(value) => { setQuery(value); setPage(0); }}
                kind={kind} audioOnly={tool === "audio"} onKind={(value) => { setKind(value); setPage(0); }}
                onImport={pickMediaFiles} onFolderImport={pickFolder} busy={disabled} canAdd={!!project && !disabled} timeline={timelineDrop} onAppend={addMedia}
                onPage={(index) => { setAssets(null); setPage(index); }}
                onFolder={(id) => {
                  if (id === folderId) return;
                  setAssets(null); setFolderId(id); setPage(0);
                }} />}
              templates={<TemplateLibrary initialReference={assets?.items.find((asset) => asset.id === selection?.assetId && asset.kind === "video")}
                disabled={disabled} onProject={openTemplateProject} notify={notify} />}
            />
            <EditorPlayer source={<Preview selection={selection} project={project} revision={libraryRevision} busy={disabled}
              onAppend={addMedia} onReference={() => openTool("templates")} />}
              clips={clips} aspect={aspect} at={playheadMs} total={total} revision={libraryRevision} frameMode={frameMode} playing={playing}
              onMode={(mode) => { setFrameMode(mode); if (!mode) setPlaying(false); }}
              onPlay={togglePlayback} onSeek={movePlayhead} onAspect={(value) => edit(history, value)} disabled={disabled || !project}
              selectedKey={selectedKey} onSelect={selectClip} onTransform={(clip) => changeClip(clip, true)}
            />
            <ClipInspector clip={selectedClip} aspect={aspect} disabled={disabled || !project}
              name={project?.name} total={total} playheadMs={playheadMs} tab={inspectorTab} onTab={setInspectorTab}
              onKeyframe={toggleTransformKey} onSeek={movePlayhead}
              onAspect={(value) => edit(history, value)}
              onLayer={(layer) => {
                if (!selectedClip) return;
                edit(commit(history, changeLayer(clips, selectedClip.key, layer)));
                setLane({ track: selectedClip.track, layer });
              }}
              onClip={changeClip} />
          </div>
          <TimelineEditor ref={timelineDrop} key={projectId} project={project} clips={clips} selectedKey={selectedKey} playheadMs={playheadMs} revision={libraryRevision}
            busy={disabled} canUndo={history.past.length > 0} canRedo={history.future.length > 0}
            saveState={saveState} lane={lane} onLane={setLane} onTitle={() => insertTitle()}
            onChange={(next) => edit(commit(history, next))} onSelect={selectClip} onPlayhead={movePlayhead}
            onDropMedia={addMedia} onUndo={() => edit(undo(history))} onRedo={() => edit(redo(history))}
            onExport={startRender} range={exportRange} onRange={markRange} />
        </div> : view === "queue" ? <ExportQueue jobs={jobs} projects={projects} busy={disabled}
          onRun={() => void run(vi.working, async () => { await api.runRenderQueue(); setJobs(await api.renderQueue()); })}
          onRetry={retryRender} onCancel={cancelRender}
        /> : view === "publish" ? <PublishPanel selection={selection} exports={jobs.filter((job) => job.projectId === projectId)} notify={notify} /> : <>
          <section className="panel settings-panel" aria-labelledby="folders-heading">
            <div className="panel-head"><div>
              <div className="panel-title"><Icon name="shield" /><h2 id="folders-heading">{vi.grantedFolders}</h2></div>
              <p>{vi.folderHint}</p>
            </div></div>
            {!folders.length && <p className="setting-empty">{vi.noFolders}</p>}
            {folders.map((folder) => <div className="setting-item" key={folder.id}>
              <div className="folder-row">
                <span className="empty-icon"><Icon name={folder.fileOnly ? "library" : "folder"} /></span>
                <div className="folder-copy">
                  <strong>{fileName(folder.root) || folder.root}</strong>
                  <p title={folder.root}>{folder.root} · {vi.mediaCount(folder.assetCount)}</p>
                </div>
                <button type="button" className="button secondary" disabled={disabled} onClick={() => rescan(folder.id)}>{vi.rescan}</button>
                <button type="button" className="button secondary danger" disabled={disabled} onClick={() => setRevokeId(folder.id)}>{vi.revoke}</button>
              </div>
              {revokeId === folder.id && <div className="confirm-row">
                <p>{vi.revokeBody}</p>
                <button type="button" className="button secondary" disabled={disabled} onClick={() => setRevokeId(null)}>{vi.cancel}</button>
                <button type="button" className="button secondary danger" disabled={disabled} onClick={() => revoke(folder.id)}>{vi.revokeConfirm}</button>
              </div>}
            </div>)}
          </section>
          <section className="panel settings-panel" aria-labelledby="tools-heading">
            <div className="panel-head"><div>
              <div className="panel-title"><Icon name="settings" /><h2 id="tools-heading">{vi.environment}</h2></div>
              <p>{vi.toolsHint}</p>
            </div></div>
            <div className="tools-row">
              <div className="tool">FFprobe <span className={tools?.ffprobe ? "ready" : ""}>{tools ? tools.ffprobe ? vi.installed : vi.missing : "—"}</span></div>
              <div className="tool">FFmpeg <span className={tools?.ffmpeg ? "ready" : ""}>{tools ? tools.ffmpeg ? vi.installed : vi.missing : "—"}</span></div>
              <button type="button" className="button secondary" disabled={disabled}
                onClick={() => void run(vi.working, async () => setTools(await api.tools()))}>{vi.checkTools}</button>
            </div>
          </section>
        </>}
      </main>
    </div>
  );
}
