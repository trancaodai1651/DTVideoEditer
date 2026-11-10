import { convertFileSrc, invoke, isTauri } from "@tauri-apps/api/core";

export type MediaKind = "video" | "audio" | "image";
export type Track = "video" | "audio";

export interface Folder {
  id: number;
  root: string;
  assetCount: number;
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
}

export interface Timeline {
  version: number;
  clips: TimelineClip[];
}

export interface ClipEdit {
  assetId: number;
  startMs: number;
  endMs: number;
  positionMs: number;
}

/** Versioned contract shared with the native store and renderer. */
export interface TimelineSnapshot {
  version: number;
  tracks: { kind: Track; clips: ClipEdit[] }[];
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
  scan: (folderId: number) => invoke<ScanReport>("scan_folder", { folderId }),
  folders: () => invoke<Folder[]>("list_folders"),
  revoke: (folderId: number) => invoke<void>("revoke_folder", { folderId }),
  assets: (folderId: number | null, page: number) => invoke<AssetPage>("list_assets", { folderId, page }),
  projects: () => invoke<Project[]>("list_projects"),
  createProject: (name: string) => invoke<Project>("create_project", { name }),
  timeline: (projectId: number) => invoke<Timeline>("load_timeline", { projectId }),
  saveTimeline: (projectId: number, snapshot: TimelineSnapshot) => invoke<void>("save_timeline", { projectId, snapshot }),
  startRender: (projectId: number) => invoke<RenderJob | null>("start_render", { projectId }),
  retryRender: (jobId: number) => invoke<RenderJob>("retry_render", { jobId }),
  cancelRender: (jobId: number) => invoke<void>("cancel_render", { jobId }),
  renderJobs: (projectId: number) => invoke<RenderJob[]>("list_render_jobs", { projectId }),
  tools: () => invoke<MediaTools>("media_tools"),
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

export function mediaUrl(route: "source" | "thumbnail", id: number, revision: number) {
  return `${convertFileSrc(`${route}-${id}`, "studio-media")}?v=${revision}`;
}

export function fileName(relativePath: string) {
  return relativePath.split(/[\\/]/).at(-1) ?? relativePath;
}
