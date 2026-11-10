import type { Platform, PostFormat, PublishStatus, RenderStatus, ScanReport } from "./desktop";

const count = new Intl.NumberFormat("vi-VN");
const decimal = new Intl.NumberFormat("vi-VN", { maximumFractionDigits: 1 });

export const vi = {
  brand: "AI Video Studio",
  workspace: "Không gian biên tập",
  library: "Thư viện media",
  settings: "Cài đặt",
  publish: "Đăng bài",
  project: "Dự án",
  projectNone: "Chưa có dự án",
  projectName: "Tên dự án",
  projectPlaceholder: "Ví dụ: Video giới thiệu",
  create: "Tạo dự án",
  projectCreated: "Đã tạo dự án.",
  local: "Lưu trên máy",
  loading: "Đang tải…",
  working: "Đang xử lý…",
  pick: "Chọn thư mục",
  picking: "Đang mở trình chọn thư mục…",
  scanning: "Đang đọc metadata và tạo ảnh thu nhỏ…",
  rescan: "Quét lại",
  revoke: "Thu hồi",
  revokeConfirm: "Xác nhận thu hồi",
  revokeBody: "Ảnh thu nhỏ, metadata và các clip tham chiếu thư mục này sẽ được gỡ khỏi ứng dụng. Tệp gốc vẫn nằm trong thư mục.",
  revoked: "Đã thu hồi quyền thư mục.",
  cancel: "Hủy",
  grantedFolders: "Thư mục đã cấp quyền",
  noFolders: "Bạn chưa cấp quyền cho thư mục nào.",
  folderHint: "Ứng dụng đọc media trong những thư mục bạn chọn.",
  allFolders: "Tất cả thư mục",
  filter: "Lọc theo thư mục",
  mediaCount: (value: number) => `${count.format(value)} tệp`,
  previous: "Trang trước",
  next: "Trang sau",
  page: (current: number, total: number) => `Trang ${current} / ${total}`,
  libraryHint: "Chọn một tệp để xem trước hoặc thêm vào dự án.",
  libraryEmpty: "Thư viện chưa có media",
  libraryEmptyHint: "Chọn thư mục chứa video, audio hoặc ảnh để bắt đầu.",
  folderEmpty: "Chưa tìm thấy media trong thư mục này",
  folderEmptyHint: "Kiểm tra định dạng tệp hoặc quét lại trong Cài đặt.",
  preview: "Xem trước",
  previewEmpty: "Chọn một tệp media",
  previewHint: "Video, âm thanh và ảnh sẽ hiển thị ở đây.",
  previewFailed: "Không phát được tệp này. Hãy kiểm tra tệp gốc và codec được hỗ trợ trên máy.",
  addClip: "Thêm vào timeline",
  needProject: "Tạo hoặc chọn một dự án để thêm tệp.",
  clipAdded: "Đã thêm clip vào dự án.",
  clipNoLength: "Không đọc được độ dài của tệp này nên chưa thể đưa vào timeline.",
  timeline: "Timeline",
  timelineHint: "Kéo clip để di chuyển, kéo hai mép để cắt. Thay đổi được lưu ngay vào dự án.",
  timelineTools: "Công cụ timeline",
  noClips: "Chưa có clip",
  dropHint: "Kéo media từ thư viện vào đây",
  noProjectTimeline: "Tạo dự án ở thanh bên để bắt đầu lưu clip.",
  removeClip: "Gỡ clip",
  split: "Tách",
  splitHint: "Tách clip tại vạch thời gian (phím S)",
  undo: "Hoàn tác (Ctrl+Z)",
  redo: "Làm lại (Ctrl+Y)",
  zoomIn: "Phóng to timeline",
  zoomOut: "Thu nhỏ timeline",
  clipLabel: (name: string, at: string, length: string) => `${name}, bắt đầu ${at}, dài ${length}`,
  saveState: { saved: "Đã lưu", saving: "Đang lưu…", error: "Chưa lưu được" },
  exportMp4: "Xuất MP4",
  exports: "Các lượt xuất video",
  exportStarted: "Đã bắt đầu xuất video.",
  renderProgress: "Tiến độ xuất video",
  renderStatus: {
    queued: "Đang chờ", running: "Đang xuất", done: "Đã xuất xong", failed: "Xuất lỗi", canceled: "Đã hủy",
  } satisfies Record<RenderStatus, string>,
  retry: "Thử lại",
  unavailable: "Tệp không còn trong thư mục",
  environment: "Công cụ trên máy",
  installed: "Sẵn sàng",
  missing: "Chưa tìm thấy",
  checkTools: "Kiểm tra lại",
  toolsHint: "FFprobe đọc metadata. FFmpeg tạo ảnh thu nhỏ và xuất MP4. Cài hai công cụ, thêm vào PATH rồi khởi động lại ứng dụng.",
  browserHint: "Mở ứng dụng desktop để chọn thư mục, quét media và lưu dự án.",
  media: { video: "Video", audio: "Âm thanh", image: "Ảnh" },
  scanReport: ({ indexed, reused, skipped, partial }: ScanReport) =>
    `Đã lập chỉ mục ${count.format(indexed)} tệp, giữ lại ${count.format(reused)} và bỏ qua ${count.format(skipped)}.`
    + (partial ? " Một phần thư mục nằm ngoài giới hạn quét hoặc không đọc được." : ""),
};

export const publishText = {
  platform: { threads: "Threads", facebook: "Facebook Page", instagram: "Instagram", tiktok: "TikTok" } satisfies Record<Platform, string>,
  formats: { text: "Bài chữ", image: "Ảnh", video: "Video", reel: "Reel" } satisfies Record<PostFormat, string>,
  status: {
    draft: "Bản nháp", publishing: "Đang đăng", published: "Đã đăng", failed: "Đăng lỗi", removed: "Đã xóa trên nền tảng",
  } satisfies Record<PublishStatus, string>,
  variant: { instagram_login: "Đăng nhập Instagram", facebook_login: "Qua Facebook Page" },
  accounts: "Tài khoản đã kết nối",
  accountsHint: "Token nằm trong keychain của hệ điều hành. Cơ sở dữ liệu của ứng dụng chỉ giữ tên tài khoản.",
  noAccounts: "Chưa kết nối tài khoản nào.",
  platformLabel: "Nền tảng",
  variantLabel: "Kiểu kết nối",
  token: "Access token",
  secretField: { refreshToken: "Refresh token", clientKey: "Client key", clientSecret: "Client secret" },
  connectHint: {
    threads: "Token dài hạn của Threads API với quyền threads_basic, threads_content_publish và threads_delete. Ảnh và video chỉ đăng được qua URL công khai.",
    facebook: "Page access token với quyền pages_manage_posts, pages_read_engagement và pages_show_list.",
    instagram_login: "Token của Instagram Login với quyền instagram_business_basic và instagram_business_content_publish. Media đăng qua URL công khai.",
    facebook_login: "Page access token của Page đã liên kết Instagram, với quyền instagram_basic, instagram_content_publish và instagram_manage_contents. Kiểu này đăng được Reel từ tệp trên máy và xóa bài.",
    tiktok: "Access token với quyền user.info.basic, video.publish và video.list. Nhập thêm ba ô còn lại để ứng dụng tự làm mới token, vì token TikTok chỉ sống vài giờ.",
  },
  connect: "Kết nối",
  connecting: "Đang xác minh token với nền tảng…",
  connected: (name: string) => `Đã kết nối ${name}.`,
  refreshToken: "Làm mới token",
  tokenRefreshed: "Đã làm mới token.",
  expires: (at: string) => `hết hạn ${at}`,
  disconnect: "Gỡ kết nối",
  disconnectConfirm: "Xác nhận gỡ",
  disconnectBody: "Token bị xóa khỏi keychain và các bản ghi bài đăng của tài khoản này bị gỡ khỏi ứng dụng. Bài đã đăng vẫn còn trên nền tảng.",
  compose: "Soạn bài đăng",
  composeHint: "Bài được lưu thành bản nháp. Chỉ khi bạn duyệt trong hộp thoại của hệ điều hành thì bài mới được gửi đi.",
  needAccount: "Kết nối một tài khoản để soạn bài.",
  account: "Tài khoản",
  format: "Định dạng",
  caption: "Nội dung",
  title: "Tiêu đề video",
  privacy: "Ai xem được",
  privacyChoose: "Chọn chế độ hiển thị",
  privacyLevel: {
    PUBLIC_TO_EVERYONE: "Mọi người", MUTUAL_FOLLOW_FRIENDS: "Bạn bè", FOLLOWER_OF_CREATOR: "Người theo dõi", SELF_ONLY: "Chỉ mình tôi",
  },
  tiktokNote: "Ứng dụng TikTok chưa qua kiểm duyệt chỉ đăng được ở chế độ Chỉ mình tôi, và tài khoản phải đặt riêng tư.",
  media: "Media",
  source: { url: "URL công khai", asset: "Tệp đang chọn trong thư viện", render: "Video đã xuất của dự án" },
  pickAsset: (kind: string) => `Chọn một ${kind.toLowerCase()} trong Thư viện media rồi quay lại đây.`,
  noExports: "Dự án đang mở chưa có video xuất xong.",
  saveDraft: "Lưu bản nháp",
  draftSaved: "Đã lưu bản nháp.",
  jobs: "Bài đăng từ ứng dụng",
  approve: "Duyệt và đăng",
  waitingApproval: "Đang chờ bạn xác nhận trong hộp thoại…",
  sending: "Đã duyệt. Bài đang được gửi, trạng thái hiện ở danh sách bên dưới.",
  discard: "Xóa nháp",
  remote: "Bài trên nền tảng",
  remoteHint: "Danh sách đọc trực tiếp từ API của nền tảng.",
  loadPosts: "Tải danh sách",
  loadingPosts: "Đang tải danh sách bài…",
  noPosts: "Nền tảng không trả về bài nào.",
  noText: "(không có chữ)",
  edit: "Sửa",
  saveEdit: "Lưu",
  postEdited: "Đã sửa bài.",
  deletePost: "Xóa",
  postDeleted: "Đã xóa bài trên nền tảng.",
  noDelete: "Nền tảng không cho xóa bài qua API với kiểu kết nối này.",
};

export function duration(ms: number | null) {
  if (ms === null) return "";
  const seconds = Math.floor(ms / 1000);
  const minutes = Math.floor(seconds / 60);
  return `${String(minutes).padStart(2, "0")}:${String(seconds % 60).padStart(2, "0")}`;
}

/** Minutes, seconds and tenths, for edit points. */
export function timecode(ms: number) {
  const tenths = Math.floor(ms / 100);
  return `${String(Math.floor(tenths / 600)).padStart(2, "0")}:${String(Math.floor(tenths / 10) % 60).padStart(2, "0")}.${tenths % 10}`;
}

export function size(bytes: number) {
  const units = ["B", "KB", "MB", "GB", "TB", "PB"];
  const index = Math.min(Math.max(Math.floor(Math.log(bytes) / Math.log(1024)), 0), units.length - 1);
  return `${decimal.format(bytes / 1024 ** index)} ${units[index]}`;
}
