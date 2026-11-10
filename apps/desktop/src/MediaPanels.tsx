import { useEffect, useRef, useState } from "react";
import { fileName, mediaUrl } from "./desktop";
import type { Asset, AssetPage, Folder, Project } from "./desktop";
import { Icon } from "./Icon";
import { MEDIA_DRAG_TYPE } from "./TimelineEditor";
import type { MediaRef } from "./timeline";
import { duration, size, vi } from "./vi";

export interface Selection {
  assetId: number;
  relativePath: string;
  kind: Asset["kind"];
  durationMs: number | null;
  detail?: string;
  /** Source time the preview should show, driven by the timeline playhead. */
  seekMs?: number;
}

export function selectAsset(asset: Asset): Selection {
  const resolution = asset.width && asset.height ? `${asset.width} × ${asset.height}` : "";
  return {
    assetId: asset.id, relativePath: asset.relativePath, kind: asset.kind, durationMs: asset.durationMs,
    detail: [resolution, asset.codec?.toUpperCase(), size(asset.bytes)].filter(Boolean).join(" · "),
  };
}

interface GalleryProps {
  data: AssetPage | null;
  folders: Folder[];
  folderId: number | null;
  page: number;
  revision: number;
  selected: number | undefined;
  onFolder: (id: number | null) => void;
  onPage: (page: number) => void;
  onSelect: (selection: Selection) => void;
}

export function Gallery({ data, folders, folderId, page, revision, selected, onFolder, onPage, onSelect }: GalleryProps) {
  const pages = data ? Math.ceil(data.total / data.pageSize) : 0;
  return (
    <section className="panel gallery" aria-labelledby="gallery-heading">
      <div className="panel-head">
        <div>
          <div className="panel-title"><Icon name="library" /><h2 id="gallery-heading">{vi.library}</h2></div>
          <p>{vi.libraryHint}</p>
        </div>
        <span className="count-pill">{data ? vi.mediaCount(data.total) : "—"}</span>
      </div>
      {folders.length > 0 && (
        <div className="gallery-filter">
          <select aria-label={vi.filter} value={folderId ?? ""} onChange={(e) => onFolder(e.target.value ? Number(e.target.value) : null)}>
            <option value="">{vi.allFolders}</option>
            {folders.map((folder) => <option key={folder.id} value={folder.id} title={folder.root}>{fileName(folder.root) || folder.root}</option>)}
          </select>
        </div>
      )}
      {!data ? <div className="empty small-empty">{vi.loading}</div> : data.items.length ? (
        <div className="asset-grid">
          {data.items.map((asset) => (
            <button type="button" key={asset.id} aria-pressed={selected === asset.id}
              className={`asset ${selected === asset.id ? "selected" : ""}`}
              title={asset.relativePath} onClick={() => onSelect(selectAsset(asset))}
              draggable onDragStart={(event) => {
                const media: MediaRef = {
                  assetId: asset.id, relativePath: asset.relativePath, kind: asset.kind, durationMs: asset.durationMs,
                };
                event.dataTransfer.setData(MEDIA_DRAG_TYPE, JSON.stringify(media));
                event.dataTransfer.effectAllowed = "copy";
              }}>
              <div className={`thumb ${asset.kind}`}>
                {asset.hasThumbnail ? <img src={mediaUrl("thumbnail", asset.id, revision)} alt="" loading="lazy" /> : <Icon name={asset.kind} size={26} />}
                {asset.durationMs !== null && <span>{duration(asset.durationMs)}</span>}
              </div>
              <span className="asset-name">{fileName(asset.relativePath)}</span>
              <span className="asset-kind">{vi.media[asset.kind]} · {size(asset.bytes)}</span>
            </button>
          ))}
        </div>
      ) : (
        <div className="empty">
          <span className="empty-icon"><Icon name="folder" size={25} /></span>
          <strong>{folders.length ? vi.folderEmpty : vi.libraryEmpty}</strong>
          <p>{folders.length ? vi.folderEmptyHint : vi.libraryEmptyHint}</p>
        </div>
      )}
      {pages > 1 && <div className="pagination">
        <button className="icon-button" type="button" aria-label={vi.previous} disabled={page === 0} onClick={() => onPage(page - 1)}><Icon name="left" /></button>
        <span>{vi.page(page + 1, pages)}</span>
        <button className="icon-button" type="button" aria-label={vi.next} disabled={page + 1 >= pages} onClick={() => onPage(page + 1)}><Icon name="right" /></button>
      </div>}
    </section>
  );
}

export function Preview({ selection, project, revision, busy, onAppend, onReference }: {
  selection: Selection | null;
  project: Project | undefined;
  revision: number;
  busy: boolean;
  onAppend: (selection: Selection) => void;
  onReference: () => void;
}) {
  return (
    <section className="panel preview" aria-labelledby="preview-heading">
      <div className="panel-head">
        <div className="panel-title"><Icon name="play" /><h2 id="preview-heading">{vi.preview}</h2></div>
        {selection && <span className="count-pill">{vi.media[selection.kind]}</span>}
      </div>
      <div className="monitor">
        {selection ? <MediaPlayer key={`${selection.assetId}-${revision}`} selection={selection} revision={revision} /> : (
          <div className="empty">
            <span className="empty-icon"><Icon name="play" size={25} /></span>
            <strong>{vi.previewEmpty}</strong><p>{vi.previewHint}</p>
          </div>
        )}
      </div>
      {selection && <div className="preview-info">
        <div className="preview-meta">
          <strong title={selection.relativePath}>{fileName(selection.relativePath)}</strong>
          <span>{[duration(selection.durationMs), selection.detail].filter(Boolean).join(" · ")}</span>
        </div>
        <div className="preview-actions">
          {selection.kind === "video" && <button className="button secondary compact" type="button" disabled={busy}
            onClick={onReference}>Dùng làm video mẫu</button>}
          <button className="button secondary compact" type="button" disabled={busy || !project}
            title={!project ? vi.needProject : undefined} onClick={() => onAppend(selection)}>
            <Icon name="plus" />{vi.addClip}
          </button>
        </div>
      </div>}
    </section>
  );
}

function MediaPlayer({ selection, revision }: { selection: Selection; revision: number }) {
  const [failed, setFailed] = useState(false);
  const player = useRef<HTMLMediaElement | null>(null);
  const src = mediaUrl("source", selection.assetId, revision);
  const label = fileName(selection.relativePath);
  const { seekMs } = selection;
  const fail = () => setFailed(true);

  useEffect(() => {
    const media = player.current;
    if (!media || seekMs === undefined) return;
    const seek = () => { media.currentTime = seekMs / 1000; };
    if (media.readyState >= 1) return seek();
    media.addEventListener("loadedmetadata", seek, { once: true });
    return () => media.removeEventListener("loadedmetadata", seek);
  }, [seekMs]);

  if (failed) return <p role="status" className="player-error">{vi.previewFailed}</p>;
  if (selection.kind === "image") return <img className="full-image" src={src} alt={label} onError={fail} />;
  if (selection.kind === "audio") return <div className="audio-player">
    <Icon name="audio" size={50} />
    <audio ref={(element) => { player.current = element; }} src={src} aria-label={label} onError={fail} controls preload="metadata" />
  </div>;
  return <video ref={(element) => { player.current = element; }} src={src} aria-label={label} onError={fail}
    controls playsInline preload="metadata" />;
}
