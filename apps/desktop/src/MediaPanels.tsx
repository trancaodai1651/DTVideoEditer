import { useEffect, useRef, useState } from "react";
import { fileName, mediaUrl } from "./desktop";
import type { Asset, AssetPage, Folder, MediaKind } from "./desktop";
import { Icon } from "./Icon";
import type { PointerEvent, RefObject } from "react";
import type { TimelineDrop } from "./TimelineEditor";
import type { MediaRef } from "./timeline";
import { duration, size, vi } from "./vi";
import { ContextMenu } from "./ContextMenu";
import type { MenuState } from "./ContextMenu";

export interface Selection {
  assetId: number;
  relativePath: string;
  kind: Asset["kind"];
  durationMs: number | null;
  detail?: string;
  /** Source time the preview should show, driven by the timeline playhead. */
  seekMs?: number;
  hasThumbnail?: boolean;
  width?: number | null;
  height?: number | null;
}

export function selectAsset(asset: Asset): Selection {
  const resolution = asset.width && asset.height ? `${asset.width} × ${asset.height}` : "";
  return {
    assetId: asset.id, relativePath: asset.relativePath, kind: asset.kind, durationMs: asset.durationMs,
    detail: [resolution, asset.codec?.toUpperCase(), size(asset.bytes)].filter(Boolean).join(" · "),
    hasThumbnail: asset.hasThumbnail, width: asset.width, height: asset.height,
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
  query: string;
  onQuery: (query: string) => void;
  kind: MediaKind | null;
  audioOnly: boolean;
  onKind: (kind: MediaKind | null) => void;
  onImport: () => void;
  onFolderImport: () => void;
  busy: boolean;
  canAdd: boolean;
  timeline: RefObject<TimelineDrop | null>;
  onAppend: (media: MediaRef) => void;
}

export function Gallery({ data, folders, folderId, page, revision, selected, onFolder, onPage, onSelect,
  query, onQuery, kind, audioOnly, onKind, onImport, onFolderImport, busy, canAdd, timeline, onAppend }: GalleryProps) {
  const gesture = useRef<{ pointer: number; x: number; y: number; media: MediaRef; moved: boolean } | null>(null);
  const [menu, setMenu] = useState<MenuState | null>(null);
  const pages = data ? Math.ceil(data.total / data.pageSize) : 0;

  function startDrag(event: PointerEvent<HTMLButtonElement>, asset: Asset) {
    gesture.current = null;
    if (!canAdd || event.button !== 0 || !event.isPrimary) return;
    gesture.current = { pointer: event.pointerId, x: event.clientX, y: event.clientY, media: selectAsset(asset), moved: false };
    event.currentTarget.setPointerCapture(event.pointerId);
  }

  function moveDrag(event: PointerEvent<HTMLButtonElement>, commit: boolean) {
    const drag = gesture.current;
    if (drag?.pointer !== event.pointerId) return;
    drag.moved ||= Math.hypot(event.clientX - drag.x, event.clientY - drag.y) >= 5;
    if (drag.moved) timeline.current?.media(drag.media, event.clientX, event.clientY, commit);
  }

  return (
    <section className="panel gallery" aria-labelledby="gallery-heading">
      <h2 className="sr-only" id="gallery-heading">Thư viện media</h2>
      <div className="media-toolbar">
        <button type="button" className="button primary compact" onClick={onImport} disabled={busy}><Icon name="plus" size={15} />Nhập tệp</button>
        <button type="button" className="icon-button" onClick={onFolderImport} disabled={busy} title="Chọn thư mục media" aria-label="Chọn thư mục media"><Icon name="folder" size={15} /></button>
        <label className="media-search"><Icon name="search" size={15} />
          <input aria-label="Tìm media" placeholder="Tìm trong thư viện" maxLength={120} value={query} onChange={(event) => onQuery(event.target.value)} />
        </label>
      </div>
      <div className="gallery-filter">
        {!audioOnly && <nav className="media-kinds" aria-label="Loại media">
          {([[null, "Tất cả"], ["video", "Video"], ["image", "Ảnh"], ["audio", "Âm thanh"]] as const).map(([value, label]) =>
            <button type="button" key={label} className="button secondary compact" aria-pressed={value === kind} onClick={() => onKind(value)}>{label}</button>)}
        </nav>}
        {folders.length > 0 &&
          <select aria-label={vi.filter} value={folderId ?? ""} onChange={(e) => onFolder(e.target.value ? Number(e.target.value) : null)}>
            <option value="">{vi.allFolders}</option>
            {folders.map((folder) => <option key={folder.id} value={folder.id} title={folder.root}>{fileName(folder.root) || folder.root}</option>)}
          </select>}
        <span className="count-pill">{data ? vi.mediaCount(data.total) : "—"}</span>
      </div>
      {!data ? <div className="empty small-empty">{vi.loading}</div> : data.items.length ? (
        <div className="asset-grid">
          {data.items.map((asset) => (
            <div className="asset-tile" key={asset.id}>
            <button type="button" aria-pressed={selected === asset.id}
              className={`asset ${selected === asset.id ? "selected" : ""}`}
              title={asset.relativePath}
              onClick={(event) => { if (event.detail === 0 || !gesture.current?.moved) onSelect(selectAsset(asset)); }}
              onDoubleClick={() => { if (canAdd && !gesture.current?.moved) onAppend(selectAsset(asset)); }}
              onContextMenu={(event) => {
                event.preventDefault();
                setMenu({ x: event.clientX, y: event.clientY, label: fileName(asset.relativePath), items: [
                  { label: "Xem trong trình phát", action: () => onSelect(selectAsset(asset)) },
                  { label: "Thêm vào timeline tại playhead", disabled: !canAdd, action: () => onAppend(selectAsset(asset)) },
                  { label: "Xem các tệp cùng nguồn", action: () => onFolder(asset.folderId) },
                ] });
              }}
              onDragStart={(event) => event.preventDefault()}
              onPointerDown={(event) => startDrag(event, asset)} onPointerMove={(event) => moveDrag(event, false)}
              onPointerUp={(event) => moveDrag(event, true)}
              onLostPointerCapture={() => timeline.current?.clear()}
              onPointerCancel={() => { gesture.current = null; timeline.current?.clear(); }}>
              <div className={`thumb ${asset.kind}`}>
                {asset.hasThumbnail ? <img src={mediaUrl("thumbnail", asset.id, revision)} alt="" loading="lazy" draggable={false} /> : <Icon name={asset.kind} size={26} />}
                {asset.durationMs !== null && <span>{duration(asset.durationMs)}</span>}
              </div>
              <span className="asset-name">{fileName(asset.relativePath)}</span>
              <span className="asset-kind">{vi.media[asset.kind]} · {size(asset.bytes)}</span>
            </button>
            {canAdd && <button type="button" className="asset-add icon-button" title="Thêm tại playhead"
              aria-label={`Thêm ${fileName(asset.relativePath)} vào timeline`} onClick={() => onAppend(selectAsset(asset))}><Icon name="plus" size={14} /></button>}
            </div>
          ))}
        </div>
      ) : (
        <div className="empty">
          <span className="empty-icon"><Icon name="folder" size={25} /></span>
          <strong>{query.trim() ? "Không tìm thấy media" : folders.length ? vi.folderEmpty : vi.libraryEmpty}</strong>
          <p>{query.trim() ? "Thử tên khác hoặc đổi bộ lọc." : folders.length ? vi.folderEmptyHint : "Chọn tệp, chọn thư mục hoặc kéo tệp từ Explorer/Finder vào đây."}</p>
        </div>
      )}
      {pages > 1 && <div className="pagination">
        <button className="icon-button" type="button" aria-label={vi.previous} disabled={page === 0} onClick={() => onPage(page - 1)}><Icon name="left" /></button>
        <span>{vi.page(page + 1, pages)}</span>
        <button className="icon-button" type="button" aria-label={vi.next} disabled={page + 1 >= pages} onClick={() => onPage(page + 1)}><Icon name="right" /></button>
      </div>}
      {menu && <ContextMenu menu={menu} onClose={() => setMenu(null)} />}
    </section>
  );
}

export function Preview({ selection, revision, busy, onAppend, onReference }: {
  selection: Selection | null;
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
          <button className="button secondary compact" type="button" disabled={busy} onClick={() => onAppend(selection)}>
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
