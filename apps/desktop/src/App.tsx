import { useCallback, useEffect, useRef, useState } from "react";
import type { FormEvent } from "react";
import { api, desktop, fileName } from "./desktop";
import type { AssetPage, Folder, MediaTools, Project, RenderJob } from "./desktop";
import { Icon } from "./Icon";
import { Gallery, Preview } from "./MediaPanels";
import { PublishPanel } from "./PublishPanel";
import type { Selection } from "./MediaPanels";
import { addClip, clipsAt, commit, fromTimeline, newHistory, redo, toSnapshot, undo } from "./timeline";
import type { Clip, History, MediaRef } from "./timeline";
import { TimelineEditor } from "./TimelineEditor";
import { vi } from "./vi";

type View = "library" | "publish" | "settings";
type Notice = { text: string; error: boolean };
const EMPTY_PAGE: AssetPage = { items: [], total: 0, pageSize: 48 };
const isActive = (job: RenderJob) => job.status === "queued" || job.status === "running";

/** The preview target for a clip, seeked to the source frame under the playhead. */
function clipSelection(clip: Clip, playheadMs: number): Selection {
  const inside = playheadMs >= clip.positionMs && playheadMs < clip.positionMs + clip.endMs - clip.startMs;
  return {
    assetId: clip.assetId, relativePath: clip.relativePath, kind: clip.kind, durationMs: clip.sourceMs,
    seekMs: clip.kind === "image" ? undefined : clip.startMs + (inside ? playheadMs - clip.positionMs : 0),
  };
}

export function App() {
  const [view, setView] = useState<View>("library");
  const [folders, setFolders] = useState<Folder[]>([]);
  const [folderId, setFolderId] = useState<number | null>(null);
  const [page, setPage] = useState(0);
  const [assets, setAssets] = useState<AssetPage | null>(desktop ? null : EMPTY_PAGE);
  const [selection, setSelection] = useState<Selection | null>(null);
  const [projects, setProjects] = useState<Project[]>([]);
  const [projectId, setProjectId] = useState<number | null>(null);
  const [projectName, setProjectName] = useState("");
  const [history, setHistory] = useState<History>(newHistory);
  const [selectedKey, setSelectedKey] = useState<string | null>(null);
  const [playheadMs, setPlayheadMs] = useState(0);
  const [saveState, setSaveState] = useState<"saved" | "saving" | "error">("saved");
  const [jobs, setJobs] = useState<RenderJob[]>([]);
  const saves = useRef({ chain: Promise.resolve(), pending: 0 });
  const [tools, setTools] = useState<MediaTools | null>(null);
  const [busy, setBusy] = useState("");
  const [notice, setNotice] = useState<Notice | null>(null);
  const [libraryRevision, setLibraryRevision] = useState(0);
  const [revokeId, setRevokeId] = useState<number | null>(null);
  const project = projects.find((item) => item.id === projectId);
  const disabled = !!busy || !desktop;
  const clips = history.present;
  const rendering = jobs.some(isActive);

  useEffect(() => {
    if (!desktop) return;
    let current = true;
    void Promise.all([api.folders(), api.projects(), api.tools()]).then(([grants, saved, capabilities]) => {
      if (!current) return;
      setFolders(grants);
      setProjects(saved);
      setProjectId((existing) => existing ?? saved[0]?.id ?? null);
      setTools(capabilities);
    }).catch((error: unknown) => {
      if (current) setNotice({ text: String(error), error: true });
    });
    return () => { current = false; };
  }, []);

  useEffect(() => {
    if (!desktop) return;
    let current = true;
    void api.assets(folderId, page).then((data) => {
      if (current) setAssets(data);
    }).catch((error: unknown) => {
      if (current) {
        setAssets(EMPTY_PAGE);
        setNotice({ text: String(error), error: true });
      }
    });
    return () => { current = false; };
  }, [folderId, page, libraryRevision]);

  useEffect(() => {
    if (projectId === null) return;
    let current = true;
    // Wait for queued saves so a reload never reads a stale timeline.
    void saves.current.chain.then(() => Promise.all([api.timeline(projectId), api.renderJobs(projectId)])).then(([saved, renders]) => {
      if (!current) return;
      setHistory(newHistory(fromTimeline(saved)));
      setSelectedKey(null);
      setPlayheadMs(0);
      setJobs(renders);
    }).catch((error: unknown) => {
      if (current) setNotice({ text: String(error), error: true });
    });
    return () => { current = false; };
  }, [projectId, libraryRevision]);

  useEffect(() => {
    if (projectId === null || !rendering) return;
    const timer = setInterval(() => {
      void api.renderJobs(projectId).then(setJobs).catch(() => undefined);
    }, 500);
    return () => clearInterval(timer);
  }, [projectId, rendering]);

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
      }
    });
  }

  function rescan(id: number) {
    void run(vi.scanning, async () => {
      success(vi.scanReport(await api.scan(id)));
      await refreshLibrary();
    });
  }

  function revoke(id: number) {
    void run(vi.working, async () => {
      await api.revoke(id);
      setRevokeId(null);
      setSelection(null);
      if (folderId === id) setFolderId(null);
      await refreshLibrary();
      success(vi.revoked);
    });
  }

  function createProject(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    void run(vi.working, async () => {
      const created = await api.createProject(projectName);
      setProjects((saved) => [created, ...saved]);
      setProjectId(created.id);
      setHistory(newHistory());
      setJobs([]);
      setProjectName("");
      setView("library");
      success(vi.projectCreated);
    });
  }

  /** Applies an edit and queues its save. Saves run in order, one at a time. */
  function edit(next: History) {
    if (!project || next === history) return;
    const id = project.id;
    const snapshot = toSnapshot(next.present);
    setHistory(next);
    setSaveState("saving");
    const queue = saves.current;
    queue.pending += 1;
    queue.chain = queue.chain.then(() => api.saveTimeline(id, snapshot)).then(() => {
      queue.pending -= 1;
      if (queue.pending === 0) setSaveState("saved");
    }, (error: unknown) => {
      queue.pending -= 1;
      setSaveState("error");
      setNotice({ text: String(error), error: true });
    });
  }

  function addMedia(media: MediaRef, positionMs?: number) {
    if (!project || disabled) return;
    const next = addClip(clips, media, positionMs);
    if (!next) return setNotice({ text: vi.clipNoLength, error: true });
    edit(commit(history, next));
    setSelectedKey(next.at(-1)?.key ?? null);
    success(vi.clipAdded);
  }

  function selectClip(key: string | null) {
    setSelectedKey(key);
    const clip = clips.find((item) => item.key === key);
    if (clip?.available) setSelection(clipSelection(clip, playheadMs));
  }

  function movePlayhead(ms: number) {
    setPlayheadMs(ms);
    const under = clipsAt(clips, ms).filter((clip) => clip.available);
    const clip = under.find((item) => item.key === selectedKey) ?? under.find((item) => item.track === "video") ?? under[0];
    if (clip) setSelection(clipSelection(clip, ms));
  }

  function startRender() {
    if (!project) return;
    void run(vi.working, async () => {
      await saves.current.chain;
      const job = await api.startRender(project.id);
      if (!job) return;
      setJobs(await api.renderJobs(project.id));
      success(vi.exportStarted);
    });
  }

  function retryRender(jobId: number) {
    if (!project) return;
    void run(vi.working, async () => {
      await api.retryRender(jobId);
      setJobs(await api.renderJobs(project.id));
    });
  }

  function cancelRender(jobId: number) {
    void api.cancelRender(jobId).catch((error: unknown) => setNotice({ text: String(error), error: true }));
  }

  return (
    <div className="shell">
      <aside className="sidebar">
        <div className="brand">
          <span className="brand-icon"><Icon name="play" size={23} /></span>
          <div><strong>{vi.brand}</strong><small>{vi.workspace}</small></div>
        </div>
        <nav aria-label={vi.workspace}>
          <button type="button" aria-current={view === "library" ? "page" : undefined} onClick={() => setView("library")}>
            <Icon name="library" />{vi.library}
          </button>
          <button type="button" aria-current={view === "publish" ? "page" : undefined} onClick={() => setView("publish")}>
            <Icon name="send" />{vi.publish}
          </button>
          <button type="button" aria-current={view === "settings" ? "page" : undefined} onClick={() => setView("settings")}>
            <Icon name="settings" />{vi.settings}
          </button>
        </nav>
        <div className="project-picker">
          <label className="eyebrow" htmlFor="active-project">{vi.project}</label>
          <select id="active-project" value={projectId ?? ""} disabled={disabled || projects.length === 0}
            onChange={(event) => { setHistory(newHistory()); setJobs([]); setProjectId(Number(event.target.value)); }}>
            {!projects.length && <option value="">{vi.projectNone}</option>}
            {projects.map((item) => <option key={item.id} value={item.id}>{item.name}</option>)}
          </select>
          <form onSubmit={createProject}>
            <label className="sr-only" htmlFor="project-name">{vi.projectName}</label>
            <input id="project-name" value={projectName} maxLength={160} required placeholder={vi.projectPlaceholder}
              disabled={disabled} onChange={(event) => setProjectName(event.target.value)} />
            <button type="submit" className="button secondary" disabled={disabled || !projectName.trim()}><Icon name="plus" />{vi.create}</button>
          </form>
        </div>
        <div className="sidebar-footer"><Icon name="shield" size={17} />{vi.local}</div>
      </aside>

      <main className="main">
        <header className="topbar">
          <div>
            <span className="eyebrow">{vi.workspace}</span>
            <h1>{view === "library" ? vi.library : view === "publish" ? vi.publish : vi.settings}</h1>
          </div>
          <button type="button" className="button primary" onClick={pickFolder} disabled={disabled}><Icon name="folder" />{vi.pick}</button>
        </header>
        <div className="notification" aria-live="polite">
          {!desktop && <p className="notice">{vi.browserHint}</p>}
          {busy && <p className="notice"><span className="spinner" aria-hidden="true" />{busy}</p>}
          {!busy && notice && <p className={`notice ${notice.error ? "error" : "success"}`}>
            <Icon name={notice.error ? "close" : "check"} />{notice.text}
          </p>}
        </div>

        {view === "library" ? <>
          <div className="editor-grid">
            <Gallery data={assets} folders={folders} folderId={folderId} page={page} revision={libraryRevision}
              selected={selection?.assetId} onSelect={setSelection}
              onPage={(index) => { setAssets(null); setPage(index); }}
              onFolder={(id) => {
                if (id === folderId) return;
                setAssets(null); setFolderId(id); setPage(0);
              }} />
            <Preview selection={selection} project={project} revision={libraryRevision} busy={disabled} onAppend={addMedia} />
          </div>
          <TimelineEditor project={project} clips={clips} selectedKey={selectedKey} playheadMs={playheadMs}
            busy={disabled} canUndo={history.past.length > 0} canRedo={history.future.length > 0}
            saveState={saveState} jobs={jobs}
            onChange={(next) => edit(commit(history, next))} onSelect={selectClip} onPlayhead={movePlayhead}
            onDropMedia={addMedia} onUndo={() => edit(undo(history))} onRedo={() => edit(redo(history))}
            onExport={startRender} onCancelRender={cancelRender} onRetryRender={retryRender} />
        </> : view === "publish" ? <PublishPanel selection={selection} exports={jobs} notify={notify} /> : <>
          <section className="panel settings-panel" aria-labelledby="folders-heading">
            <div className="panel-head"><div>
              <div className="panel-title"><Icon name="shield" /><h2 id="folders-heading">{vi.grantedFolders}</h2></div>
              <p>{vi.folderHint}</p>
            </div></div>
            {!folders.length && <p className="setting-empty">{vi.noFolders}</p>}
            {folders.map((folder) => <div className="setting-item" key={folder.id}>
              <div className="folder-row">
                <span className="empty-icon"><Icon name="folder" /></span>
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
