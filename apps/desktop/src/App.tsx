import { useCallback, useDeferredValue, useEffect, useEffectEvent, useRef, useState } from "react";
import type { CSSProperties, FormEvent, PointerEvent } from "react";
import { api, desktop, fileName } from "./desktop";
import type { TrackRegion } from "./desktop";
import type { Aspect, Asset, AssetPage, CatalogItem, ClipLook, Cue, ExportRange, Folder, ImportedFiles, LaneControl, MediaDrop, MediaKind, MediaTools, Project, RenderJob, TimelineSnapshot, TitleStyle } from "./desktop";
import { Icon } from "./Icon";
import { Gallery, Preview, selectAsset } from "./MediaPanels";
import { PublishPanel } from "./PublishPanel";
import type { Selection } from "./MediaPanels";
import { detachAudio, restoreAudio, clipBeatMarkers, clipLevelAt, followTrack, removeSilences, sourcePosition, splitAtSourceTimes } from "./timeline";
import { MAX_LAYERS, addCaptions, addClip, addDroppedMedia, addTitle, changeLayer, changesLockedLane, clipFinish, clipLane, commit, defaultLook, fromTimeline, laneControl, layerOf, lookAt, newHistory, playbackRate, previousVisual, redo, setTransformKey, setTransition, subtitleCues, toSnapshot, totalMs, trackOf, transformProperties, undo, updateAppearance } from "./timeline";
import type { Clip, History, MediaDropTarget, MediaRef } from "./timeline";
import { TimelineEditor } from "./TimelineEditor";
import type { Lane, SmartAction, TimelineDrop } from "./TimelineEditor";
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

function storedNumber(key: string, fallback: number, min: number, max: number) {
  try {
    const value = Number(localStorage.getItem(key));
    return Number.isFinite(value) && value >= min && value <= max ? value : fallback;
  } catch { return fallback; }
}

export function App() {
  const timelineDrop = useRef<TimelineDrop>(null);
  const dropTargets = useRef(new Map<number, { projectId: number | null; target: MediaDropTarget }>());
  const seededProject = useRef<number | null>(null);
  const creatingFromMedia = useRef(false);
  const [view, setView] = useState<View>("library");
  const [tool, setTool] = useState<LibraryTab>("media");
  const [inspectorTab, setInspectorTab] = useState<InspectorTab>("video");
  const [timelineShare, setTimelineShare] = useState(44);
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
  const [laneControls, setLaneControls] = useState<LaneControl[]>([]);
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
  const [ready, setReady] = useState(false);
  const [loadedTimeline, setLoadedTimeline] = useState<{ id: number; revision: number } | null>(null);
  const [revokeId, setRevokeId] = useState<number | null>(null);
  const [tracking, setTracking] = useState<{ sourceKey: string; targetKey: string } | null>(null);
  const levels = useRef(new Map<number, number[] | "failed" | "loading">());
  const [levelsVersion, setLevelsVersion] = useState(0);
  const [libraryWidth, setLibraryWidth] = useState(() => storedNumber("dt-edit-library-width", 34, 20, 50));
  const [inspectorWidth, setInspectorWidth] = useState(() => storedNumber("dt-edit-inspector-width", 31, 18, 45));
  const project = projects.find((item) => item.id === projectId);
  const disabled = !!busy || !desktop;
  const editsDisabled = disabled || !ready || (projectId !== null
    && (loadedTimeline?.id !== projectId || loadedTimeline.revision !== timelineRevision));
  const clips = history.present;
  const selectedClip = clips.find((clip) => clip.key === selectedKey);
  const total = totalMs(clips);
  const marks = rangeMarks?.projectId === projectId ? rangeMarks : null;
  const exportRange: ExportRange | undefined = marks
    ? { startMs: marks.start ?? 0, endMs: Math.min(total, marks.end ?? total) } : undefined;
  const captions = subtitleCues(clips);
  const needCatalog = view === "library" && (tool === "audio" || tool === "stickers");
  const rendering = jobs.some(isActive);

  const soundAssets = [...new Set(clips.filter((clip) => clip.available && !clip.look?.disabled
    && (clip.track === "audio" || (clip.kind === "video" && !clip.look?.audioDetached))).map((clip) => clip.assetId))].slice(0, 16);
  const nextLevels = soundAssets.find((id) => !levels.current.has(id));
  useEffect(() => {
    if (!desktop || nextLevels === undefined || !ready) return;
    levels.current.set(nextLevels, "loading");
    void api.audioLevels(nextLevels).then((values) => levels.current.set(nextLevels, values), () => levels.current.set(nextLevels, "failed"))
      .finally(() => setLevelsVersion((value) => value + 1));
  }, [nextLevels, ready]);
  const meterDb = (() => {
    void levelsVersion;
    let power = 0;
    let sounding = false;
    for (const clip of clips) {
      if (clip.look?.disabled || !clip.available || laneControl(laneControls, clip.track, layerOf(clip))?.muted) continue;
      if (clip.track !== "audio" && (clip.kind !== "video" || clip.look?.audioDetached)) continue;
      const values = levels.current.get(clip.assetId);
      if (!Array.isArray(values)) continue;
      const db = clipLevelAt(clip, values, playheadMs);
      if (db === null) continue;
      sounding = true;
      power += 10 ** (db / 10);
    }
    return sounding ? 10 * Math.log10(Math.max(power, 1e-9)) : null;
  })();

  function resizeColumn(event: PointerEvent<HTMLDivElement>, side: "library" | "inspector") {
    if (!event.currentTarget.hasPointerCapture(event.pointerId)) return;
    const bounds = event.currentTarget.parentElement?.getBoundingClientRect();
    if (!bounds?.width) return;
    const share = 100 * (side === "library" ? event.clientX - bounds.left : bounds.right - event.clientX) / bounds.width;
    if (side === "library") {
      const value = Math.round(Math.max(20, Math.min(50, share)));
      setLibraryWidth(value);
      try { localStorage.setItem("dt-edit-library-width", String(value)); } catch { /* optional */ }
    } else {
      const value = Math.round(Math.max(18, Math.min(45, share)));
      setInspectorWidth(value);
      try { localStorage.setItem("dt-edit-inspector-width", String(value)); } catch { /* optional */ }
    }
  }

  function smart(action: SmartAction, key: string) {
    const clip = clips.find((item) => item.key === key);
    if (!clip) return;
    const message = (error: unknown) => (error instanceof Error ? error.message : String(error));
    if (action === "speed") {
      selectClip(key);
      setInspectorTab("speed");
      return;
    }
    if (action === "track") {
      const source = clips.filter((item) => item.track === "video" && item.kind === "video" && item.available && !item.look?.disabled
        && layerOf(item) < layerOf(clip) && playheadMs >= item.positionMs && playheadMs < clipFinish(item))
        .sort((a, b) => layerOf(b) - layerOf(a))[0];
      if (!source) { notify("Đặt playhead trên một clip video ở tầng dưới lớp cần bám theo.", true); return; }
      setPlaying(false);
      setFrameMode(true);
      setSelectedKey(key);
      setTracking({ sourceKey: source.key, targetKey: key });
      notify("Kéo một khung quanh vật thể trên trình phát. Nhấn Esc để hủy.", false);
      return;
    }
    void run(action === "scenes" ? "Đang dò cảnh…" : "Đang đo âm lượng…", async () => {
      try {
        if (action === "scenes") {
          const cuts = await api.detectScenes(clip.assetId, clip.startMs, clip.endMs, 32);
          if (!cuts.length) { notify("Không tìm thấy điểm chuyển cảnh trong clip này.", false); return; }
          const next = splitAtSourceTimes(clips, key, cuts);
          if (edit(commit(history, next))) success(`Đã tách thành ${next.length - clips.length + 1} cảnh.`);
          return;
        }
        const values = await api.audioLevels(clip.assetId);
        levels.current.set(clip.assetId, values);
        if (action === "silence") {
          const next = removeSilences(clips, key, values);
          if (next === clips) { notify("Không có khoảng lặng dài từ 0,6 giây trong clip này.", false); return; }
          if (edit(commit(history, next))) success("Đã xóa các khoảng lặng và dồn clip phía sau.");
        } else {
          const beats = clipBeatMarkers(clip, values);
          if (!beats.length) { notify("Không phát hiện nhịp rõ trong clip này.", false); return; }
          timelineDrop.current?.addMarkers(beats);
          success(`Đã thêm ${Math.min(100, beats.length)} marker theo nhịp.`);
        }
      } catch (error) {
        notify(message(error), true);
      }
    });
  }

  function trackRegion(region: TrackRegion) {
    const job = tracking;
    setTracking(null);
    const source = clips.find((clip) => clip.key === job?.sourceKey);
    if (!job || !source) return;
    const start = Math.round(source.startMs + sourcePosition(source, Math.max(0, playheadMs - source.positionMs)).offset);
    void run("Đang theo dõi chuyển động…", async () => {
      try {
        const points = await api.trackMotion(source.assetId, start, source.endMs, region);
        const latest = history.present;
        if (edit(commit(history, followTrack(latest, job.sourceKey, job.targetKey, points)))) {
          success(`Lớp đã bám theo vật thể qua ${points.length} khung.`);
        }
      } catch (error) {
        notify(error instanceof Error ? error.message : String(error), true);
      }
    });
  }

  function resizeTimeline(event: PointerEvent<HTMLDivElement>) {
    const bounds = event.currentTarget.parentElement?.getBoundingClientRect();
    if (bounds?.height) setTimelineShare(Math.round(Math.max(30, Math.min(68, 100 * (bounds.bottom - event.clientY) / bounds.height))));
  }

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
      setReady(true);
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
    if (seededProject.current === projectId) { seededProject.current = null; return; }
    let current = true;
    // Wait for queued saves so a reload never reads a stale timeline.
    void saves.current.chain.then(() => api.timeline(projectId)).then((saved) => {
      if (!current) return;
      setHistory(newHistory(fromTimeline(saved)));
      setLoadedTimeline({ id: projectId, revision: timelineRevision });
      setSelectedKey(null);
      setPlayheadMs(0);
      setAspect(saved.aspect ?? "source");
      setLane({ track: "video", layer: 0 });
      setLaneControls(saved.lanes ?? []);
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
    if (drop.type === "hover") {
      timelineDrop.current?.hover(drop.x / window.devicePixelRatio, drop.y / window.devicePixelRatio);
      return;
    }
    if (drop.type === "left") { timelineDrop.current?.hover(); return; }
    if (drop.type === "started") {
      const target = timelineDrop.current?.target(drop.x / window.devicePixelRatio, drop.y / window.devicePixelRatio);
      timelineDrop.current?.hover();
      if (target) dropTargets.current.set(drop.id, { projectId, target });
      return;
    }
    const captured = dropTargets.current.get(drop.id);
    dropTargets.current.delete(drop.id);
    if ("Err" in drop.result) {
      setNotice({ text: drop.result.Err, error: true });
      return;
    }
    const target = captured?.projectId === projectId && view === "library" && !editsDisabled ? captured.target : undefined;
    void applyImported(drop.result.Ok, target).catch((error: unknown) => notify(String(error), true));
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

  async function applyImported(report: ImportedFiles, target?: MediaDropTarget) {
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
    const inserted = target ? await insertDroppedMedia(report.assets.map(selectAsset), target) : 0;
    success(`Đã nhập ${report.assets.length} tệp${target ? `, đặt ${inserted} clip lên timeline` : ""}${report.skipped ? `, bỏ qua ${report.skipped} tệp` : ""}.`);
  }

  function pickMediaFiles() {
    void run("Đang nhập tệp media…", async () => {
      const report = await api.pickMediaFiles();
      if (report) await applyImported(report);
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
  function edit(next: History, nextAspect = aspect, nextLanes = laneControls) {
    if (!project || editsDisabled || (next === history && nextAspect === aspect && nextLanes === laneControls)) return false;
    if (changesLockedLane(clips, next.present, laneControls)) {
      notify("Mở khóa tầng trước khi chỉnh clip trên tầng đó.", true);
      return false;
    }
    const id = project.id;
    const snapshot = toSnapshot(next.present, nextAspect, nextLanes);
    setHistory(next);
    setAspect(nextAspect);
    setLaneControls(nextLanes);
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
    return true;
  }

  function toggleLane(target: Lane, flag: "locked" | "hidden" | "muted") {
    const current = laneControl(laneControls, target.track, target.layer) ?? { ...target, locked: false, hidden: false, muted: false };
    const changed = { ...current, [flag]: !current[flag] };
    const next = laneControls.filter((control) => control !== current);
    if (changed.locked || changed.hidden || changed.muted) next.push(changed);
    edit(history, aspect, next);
  }

  async function commitMedia(next: Clip[]) {
    const inserted = next[clips.length];
    if (!inserted) return 0;
    if (project) {
      if (!edit(commit(history, next))) return 0;
    }
    else {
      if (creatingFromMedia.current) return 0;
      creatingFromMedia.current = true;
      setBusy("Đang tạo dự án từ media…");
      try {
        const created = await api.createEditedProject(`Dự án ${new Date().toLocaleString("vi-VN")}`, toSnapshot(next));
        seededProject.current = created.id;
        setLoadedTimeline({ id: created.id, revision: timelineRevision });
        setProjects((saved) => [created, ...saved]);
        setProjectId(created.id);
        setHistory(commit(newHistory(), next));
        setAspect("source");
        setLaneControls([]);
        setSaveState("saved");
        setView("library");
      } finally {
        creatingFromMedia.current = false;
        setBusy("");
      }
    }
    setSelectedKey(inserted.key);
    setInspectorTab(inserted.track === "audio" ? "audio" : "video");
    setLane({ track: inserted.track, layer: layerOf(inserted) });
    setPlaying(false);
    if (playheadMs < inserted.positionMs || playheadMs >= clipFinish(inserted)) setPlayheadMs(inserted.positionMs);
    setFrameMode(true);
    return next.length - clips.length;
  }

  function insertDroppedMedia(media: MediaRef[], target: MediaDropTarget) {
    return commitMedia(addDroppedMedia(clips, media, target, laneControls));
  }

  function dropMedia(media: MediaRef, target: MediaDropTarget) {
    if (editsDisabled) return;
    void insertDroppedMedia([media], target).then((added) => notify(added ? vi.clipAdded : vi.clipNoLength, !added))
      .catch((error: unknown) => notify(String(error), true));
  }

  function addMedia(media: MediaRef, positionMs?: number, target = lane, appearance?: Partial<ClipLook>) {
    if (editsDisabled) return;
    const track = trackOf(media.kind);
    const layer = target.track === track ? target.layer : 0;
    if (laneControl(laneControls, track, layer)?.locked) return notify("Mở khóa tầng trước khi thêm clip.", true);
    const next = addClip(clips, media, positionMs, layer);
    if (!next) return notify(vi.clipNoLength, true);
    if (appearance) next[next.length - 1] = { ...next[next.length - 1], look: appearance };
    void commitMedia(next).then((added) => { if (added) success(vi.clipAdded); })
      .catch((error: unknown) => notify(String(error), true));
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
    if (next === clips || !title || !edit(commit(history, next))) return;
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
    if (clipLane(laneControls, selectedClip)?.locked) return notify("Mở khóa tầng trước khi áp dụng hiệu ứng.", true);
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
    if (!edit(commit(history, next))) return;
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

        {view === "library" ? <div className="editor-workspace" style={{ "--panels-fr": `${100 - timelineShare}fr`, "--timeline-fr": `${timelineShare}fr` } as CSSProperties}>
          <div className="editor-columns" style={{ "--library-fr": `${libraryWidth}fr`, "--inspector-fr": `${inspectorWidth}fr`, "--player-fr": `${100 - libraryWidth - inspectorWidth}fr` } as CSSProperties}>
            <EditorLibrary smartTarget={selectedClip && !selectedClip.title ? { key: selectedClip.key, kind: selectedClip.kind, track: selectedClip.track,
              layer: layerOf(selectedClip), detached: !!selectedClip.look?.audioDetached, linked: selectedClip.look?.audioLink !== undefined } : null}
              onSmartTool={(action, key) => {
                if (action !== "detach") { smart(action, key); return; }
                const target = clips.find((clip) => clip.key === key);
                if (!target) return;
                try {
                  const next = target.look?.audioLink !== undefined ? restoreAudio(clips, key) : detachAudio(clips, key);
                  if (edit(commit(history, next))) success(target.look?.audioLink !== undefined ? "Đã gộp âm thanh về clip video." : "Đã tách âm thanh sang tầng âm thanh.");
                } catch (error) { notify(error instanceof Error ? error.message : String(error), true); }
              }}
              tab={tool} onTab={openTool} busy={disabled} catalog={catalog} catalogFailed={catalogFailed}
              onRetryCatalog={() => { setCatalogFailed(false); setCatalogRetry((value) => value + 1); }}
              hasProject={!!project && !editsDisabled} hasVisual={selectedClip?.track === "video" && !editsDisabled}
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
                onImport={pickMediaFiles} onFolderImport={pickFolder} busy={disabled} canAdd={!editsDisabled} timeline={timelineDrop}
                onAppend={(media) => addMedia(media, playheadMs)}
                onPage={(index) => { setAssets(null); setPage(index); }}
                onFolder={(id) => {
                  if (id === folderId) return;
                  setAssets(null); setFolderId(id); setPage(0);
                }} />}
              templates={<TemplateLibrary initialReference={assets?.items.find((asset) => asset.id === selection?.assetId && asset.kind === "video")}
                disabled={disabled} onProject={openTemplateProject} notify={notify} />}
            />
            <div className="column-divider" role="separator" aria-orientation="vertical" aria-label="Đổi chiều rộng thư viện" tabIndex={0}
              onPointerDown={(event) => { if (event.button === 0) event.currentTarget.setPointerCapture(event.pointerId); }}
              onPointerMove={(event) => resizeColumn(event, "library")} onDoubleClick={() => setLibraryWidth(34)}
              onKeyDown={(event) => { if (event.key === "ArrowLeft" || event.key === "ArrowRight") { event.preventDefault(); setLibraryWidth((width) => Math.max(20, Math.min(50, width + (event.key === "ArrowRight" ? 2 : -2)))); } }} />
            <EditorPlayer meterDb={meterDb} tracking={!!tracking} trackingSource={tracking?.sourceKey} onTrackRegion={trackRegion}
              onCancelTracking={() => { setTracking(null); notify("Đã hủy theo dõi chuyển động.", false); }}
              source={<Preview selection={selection} revision={libraryRevision} busy={editsDisabled}
              onAppend={addMedia} onReference={() => openTool("templates")} />}
              clips={clips} laneControls={laneControls} aspect={aspect} at={playheadMs} total={total} revision={libraryRevision} frameMode={frameMode} playing={playing}
              onMode={(mode) => { setFrameMode(mode); if (!mode) setPlaying(false); }}
              onPlay={togglePlayback} onSeek={movePlayhead} onAspect={(value) => edit(history, value)} disabled={editsDisabled || !project}
              selectedKey={selectedKey} onSelect={selectClip} onTransform={(clip) => changeClip(clip, true)}
            />
            <div className="column-divider" role="separator" aria-orientation="vertical" aria-label="Đổi chiều rộng bảng thuộc tính" tabIndex={0}
              onPointerDown={(event) => { if (event.button === 0) event.currentTarget.setPointerCapture(event.pointerId); }}
              onPointerMove={(event) => resizeColumn(event, "inspector")} onDoubleClick={() => setInspectorWidth(31)}
              onKeyDown={(event) => { if (event.key === "ArrowLeft" || event.key === "ArrowRight") { event.preventDefault(); setInspectorWidth((width) => Math.max(18, Math.min(45, width + (event.key === "ArrowLeft" ? 2 : -2)))); } }} />
            <ClipInspector clip={selectedClip} aspect={aspect} disabled={editsDisabled || !project || !!(selectedClip && clipLane(laneControls, selectedClip)?.locked)}
              name={project?.name} total={total} playheadMs={playheadMs} tab={inspectorTab} onTab={setInspectorTab}
              onKeyframe={toggleTransformKey} onSeek={movePlayhead}
              onAspect={(value) => edit(history, value)}
              onLayer={(layer) => {
                if (!selectedClip) return;
                if (edit(commit(history, changeLayer(clips, selectedClip.key, layer)))) setLane({ track: selectedClip.track, layer });
              }}
              onClip={changeClip} />
          </div>
          <div className="workspace-divider" role="separator" aria-label="Đổi chiều cao timeline" aria-orientation="horizontal"
            aria-valuemin={30} aria-valuemax={68} aria-valuenow={timelineShare} tabIndex={0}
            onPointerDown={(event) => { if (event.button === 0) event.currentTarget.setPointerCapture(event.pointerId); }}
            onPointerMove={(event) => { if (event.currentTarget.hasPointerCapture(event.pointerId)) resizeTimeline(event); }}
            onDoubleClick={() => setTimelineShare(44)} onKeyDown={(event) => {
              if (event.key !== "ArrowUp" && event.key !== "ArrowDown") return;
              event.preventDefault();
              setTimelineShare((share) => Math.max(30, Math.min(68, share + (event.key === "ArrowUp" ? 3 : -3))));
            }} />
          <TimelineEditor ref={timelineDrop} key={projectId} project={project} clips={clips} selectedKey={selectedKey} playheadMs={playheadMs} revision={libraryRevision}
            busy={editsDisabled} canUndo={history.past.length > 0} canRedo={history.future.length > 0}
            saveState={saveState} lane={lane} laneControls={laneControls} onLaneControl={toggleLane} onLane={setLane} onTitle={() => insertTitle()}
            onChange={(next) => edit(commit(history, next))} onSelect={selectClip} onPlayhead={movePlayhead} onPlay={togglePlayback}
            onDropMedia={dropMedia} onUndo={() => edit(undo(history))} onRedo={() => edit(redo(history))}
            onExport={startRender} range={exportRange} onRange={markRange} onNotify={notify} onSmart={smart} />
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
