import { convertFileSrc, invoke, isTauri } from "@tauri-apps/api/core";
import { listen } from "@tauri-apps/api/event";

export type MediaKind = "video" | "audio" | "image";
export type Track = "video" | "audio";

export interface Folder {
  id: number;
  root: string;
  assetCount: number;
  fileOnly: boolean;
}

export interface Asset {
  id: number;
  folderId: number;
  relativePath: string;
  kind: MediaKind;
  bytes: number;
  durationMs: number | null;
  width: number | null;
  height: number | null;
  codec: string | null;
  frameRate: number | null;
  hasThumbnail: boolean;
}

export interface AssetPage {
  items: Asset[];
  total: number;
  pageSize: number;
}

export interface ImportedFiles {
  assets: Asset[];
  skipped: number;
}

export type MediaDrop = { type: "hover"; x: number; y: number } | { type: "left" }
  | { type: "started"; id: number; x: number; y: number }
  | { type: "finished"; id: number; result: { Ok: ImportedFiles } | { Err: string } };
export interface ExportRange { startMs: number; endMs: number }

export interface Project {
  id: number;
  name: string;
}

export interface TimelineClip {
  id: number;
  assetId: number;
  relativePath: string;
  kind: MediaKind;
  track: Track;
  startMs: number;
  endMs: number;
  positionMs: number;
  sourceDurationMs: number | null;
  available: boolean;
  layer: number;
  look: ClipLook;
  width: number | null;
  height: number | null;
  hasThumbnail: boolean;
}

export type Aspect = "source" | "landscape" | "portrait" | "square";
export type TitleColor = "white" | "yellow" | "cyan" | "black";
export type EditorTrack = Track | "text";
export interface LaneControl {
  track: EditorTrack;
  layer: number;
  locked: boolean;
  muted: boolean;
  hidden: boolean;
}
export interface ClipLook {
  brightness: number;
  contrast: number;
  saturation: number;
  opacity: number;
  scale: number;
  x: number;
  y: number;
  volume: number;
  fadeMs: number;
  motion: "none" | "slide" | "slide_right" | "rise";
  speed: number;
  rotate: number;
  flip: boolean;
  temperature: number;
  effect: "none" | "blur" | "vignette" | "grain";
  keyColor: "none" | "green" | "blue";
  ellipse: boolean;
  denoise: boolean;
  sharpen: boolean;
  stabilize: boolean;
  opticalFlow: boolean;
  cleanAudio: boolean;
  audioFadeInMs?: number;
  audioFadeOutMs?: number;
  gainDb?: number;
  editGroup?: number;
  keyframes?: TransformKey[];
  transition?: ClipTransition;
  /** A video clip whose sound now lives on its own audio clip. */
  audioDetached?: boolean;
  /** Pairs a detached audio clip with the video clip it came from. */
  audioLink?: number;
  /** Kept on the timeline but left out of preview and export. */
  disabled?: boolean;
  compound?: { id: number; name: string };
  /** Clips sharing a multicam id are camera angles of one take. */
  multicam?: number;
  speedCurve?: SpeedPoint[];
}
/** `at` is the position in the source range in thousandths, `speed` a percentage. */
export interface SpeedPoint { at: number; speed: number }
export interface TrackPoint { atMs: number; x: number; y: number }
export interface TrackRegion { x: number; y: number; width: number; height: number }
export type TransitionKind = "black" | "dissolve";
export interface ClipTransition {
  kind: TransitionKind;
  durationMs: number;
  fromAssetId: number;
  fromStartMs: number;
}
export interface TransformKey {
  atMs: number;
  x: number;
  y: number;
  scale: number;
  rotate: number;
  opacity: number;
  smooth?: boolean;
}
export interface TitleStyle {
  text: string;
  size: number;
  x: number;
  y: number;
  color: TitleColor;
  caption?: boolean;
  background?: boolean;
  editGroup?: number;
}
export interface Cue { startMs: number; endMs: number; text: string }
export interface CatalogItem { title: string; group: "music" | "sound" | "sticker"; asset: Asset }
export interface TitleEdit extends TitleStyle {
  positionMs: number;
  durationMs: number;
  layer: number;
}
export interface TemplateEntry {
  id: number;
  template: { name: string; aspect: Aspect; sceneMs: number[] };
}

export interface Timeline {
  version: number;
  clips: TimelineClip[];
  titles: TitleEdit[];
  aspect: Aspect;
  lanes: LaneControl[];
}

export interface ClipEdit {
  assetId: number;
  startMs: number;
  endMs: number;
  positionMs: number;
  layer?: number;
  look?: Partial<ClipLook>;
}

/** Versioned contract shared with the native store and renderer. */
export interface TimelineSnapshot {
  version: number;
  tracks: { kind: Track; clips: ClipEdit[] }[];
  titles?: TitleEdit[];
  aspect?: Aspect;
  lanes?: LaneControl[];
}

export type RenderStatus = "queued" | "running" | "done" | "failed" | "canceled";

export interface RenderJob {
  id: number;
  projectId: number;
  status: RenderStatus;
  /** Thousandths of the timeline already encoded. */
  progress: number;
  outputPath: string;
  durationMs: number;
  error: string | null;
  createdAt: string;
  finishedAt: string | null;
}

export interface MediaTools {
  ffprobe: boolean;
  ffmpeg: boolean;
}

export interface ScanReport {
  indexed: number;
  reused: number;
  skipped: number;
  partial: boolean;
}

export type Platform = "threads" | "facebook" | "instagram" | "tiktok";
export type PostFormat = "text" | "image" | "video" | "reel";
export type PublishStatus = "draft" | "publishing" | "published" | "failed" | "removed";

/** What an account can do through its platform API. */
export interface Capabilities {
  formats: PostFormat[];
  urlMedia: PostFormat[];
  localMedia: PostFormat[];
  delete: boolean;
  edit: boolean;
  refresh: boolean;
  privacy: boolean;
  captionLimit: number;
}

export interface SocialAccount {
  id: number;
  platform: Platform;
  variant: string;
  remoteId: string;
  name: string;
  /** Unix seconds, when the platform reported it. */
  expiresAt: number | null;
  capabilities: Capabilities;
}

export interface ConnectInput {
  platform: Platform;
  variant: string;
  accessToken: string;
  refreshToken: string | null;
  clientKey: string | null;
  clientSecret: string | null;
}

export interface DraftInput {
  accountId: number;
  format: PostFormat;
  caption: string;
  title: string;
  privacy: string;
  mediaUrl: string | null;
  assetId: number | null;
  renderJobId: number | null;
}

export interface PublishJob {
  id: number;
  accountId: number;
  platform: Platform;
  accountName: string;
  format: PostFormat;
  caption: string;
  title: string;
  privacy: string;
  media: "none" | "url" | "asset" | "render";
  mediaLabel: string | null;
  status: PublishStatus;
  remoteId: string | null;
  permalink: string | null;
  error: string | null;
  createdAt: string;
  publishedAt: string | null;
}

export interface RemotePost {
  id: string;
  text: string;
  kind: string;
  permalink: string | null;
  createdAt: string | null;
}

export interface PublishOptions {
  privacyLevels: string[];
  creatorName: string | null;
  maxVideoSeconds: number | null;
}

export const desktop = isTauri();

export const api = {
  pickFolder: () => invoke<number | null>("pick_folder"),
  pickMediaFiles: () => invoke<ImportedFiles | null>("pick_media_files"),
  onMediaDrop: (receive: (drop: MediaDrop) => void) => listen<MediaDrop>("studio-media-drop", ({ payload }) => receive(payload)),
  scan: (folderId: number) => invoke<ScanReport>("scan_folder", { folderId }),
  folders: () => invoke<Folder[]>("list_folders"),
  revoke: (folderId: number) => invoke<void>("revoke_folder", { folderId }),
  assets: (folderId: number | null, page: number, keyword = "", kind: MediaKind | null = null) =>
    invoke<AssetPage>("list_assets", { folderId, page, keyword, kind }),
  catalog: () => invoke<CatalogItem[]>("list_studio_catalog"),
  importSrt: () => invoke<Cue[] | null>("import_srt"),
  exportSrt: (cues: Cue[]) => invoke<boolean>("export_srt", { cues }),
  transcribe: (clip: { assetId: number; startMs: number; endMs: number; speed: number }, language: string) =>
    invoke<Cue[] | null>("transcribe_clip", { clip, language }),
  projects: () => invoke<Project[]>("list_projects"),
  createProject: (name: string) => invoke<Project>("create_project", { name }),
  createEditedProject: (name: string, snapshot: TimelineSnapshot) =>
    invoke<Project>("create_edited_project", { name, snapshot }),
  timeline: (projectId: number) => invoke<Timeline>("load_timeline", { projectId }),
  saveTimeline: (projectId: number, snapshot: TimelineSnapshot) => invoke<void>("save_timeline", { projectId, snapshot }),
  startRender: (projectId: number, queueOnly: boolean, exportRange?: ExportRange) =>
    invoke<RenderJob | null>("start_render", { projectId, queueOnly, exportRange }),
  retryRender: (jobId: number) => invoke<RenderJob>("retry_render", { jobId }),
  cancelRender: (jobId: number) => invoke<void>("cancel_render", { jobId }),
  renderJobs: (projectId: number) => invoke<RenderJob[]>("list_render_jobs", { projectId }),
  renderQueue: () => invoke<RenderJob[]>("list_render_queue"),
  runRenderQueue: () => invoke<void>("run_render_queue"),
  templates: () => invoke<TemplateEntry[]>("list_editor_templates"),
  analyzeReference: (assetId: number, name: string) => invoke<TemplateEntry>("analyze_reference", { assetId, name }),
  tools: () => invoke<MediaTools>("media_tools"),
  /** Loudness per 50 ms, 0 = -60 dBFS or quieter, 255 = full scale. */
  audioLevels: (assetId: number) => invoke<number[]>("audio_levels", { assetId }),
  detectScenes: (assetId: number, startMs: number, endMs: number, threshold: number) =>
    invoke<number[]>("detect_scenes", { assetId, startMs, endMs, threshold }),
  trackMotion: (assetId: number, startMs: number, endMs: number, region: TrackRegion) =>
    invoke<TrackPoint[]>("track_motion", { assetId, startMs, endMs, region }),
  accounts: () => invoke<SocialAccount[]>("list_social_accounts"),
  connectAccount: (input: ConnectInput) => invoke<SocialAccount>("connect_social_account", { input }),
  disconnectAccount: (accountId: number) => invoke<void>("disconnect_social_account", { accountId }),
  refreshToken: (accountId: number) => invoke<SocialAccount>("refresh_social_token", { accountId }),
  publishOptions: (accountId: number) => invoke<PublishOptions>("publish_options", { accountId }),
  publishJobs: () => invoke<PublishJob[]>("list_publish_jobs"),
  createDraft: (draft: DraftInput) => invoke<PublishJob>("create_publish_draft", { draft }),
  deleteDraft: (jobId: number) => invoke<void>("delete_publish_draft", { jobId }),
  /** Opens a native confirmation. The job stays a draft when the user declines. */
  approvePublish: (jobId: number) => invoke<PublishJob>("approve_publish", { jobId }),
  remotePosts: (accountId: number) => invoke<RemotePost[]>("list_remote_posts", { accountId }),
  deleteRemotePost: (accountId: number, remoteId: string) => invoke<boolean>("delete_remote_post", { accountId, remoteId }),
  editRemotePost: (accountId: number, remoteId: string, message: string) =>
    invoke<boolean>("edit_remote_post", { accountId, remoteId, message }),
};

export function mediaUrl(route: "source" | "thumbnail" | "render" | "waveform" | "filmstrip", id: number, revision: number) {
  return `${convertFileSrc(`${route}-${id}`, "studio-media")}?v=${revision}`;
}

export function fileName(relativePath: string) {
  return relativePath.split(/[\\/]/).at(-1) ?? relativePath;
}
