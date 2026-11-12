# Bản đồ tính năng

| Module | Source hoặc tài liệu | Trạng thái |
| --- | --- | --- |
| Desktop và Settings | [App](../../apps/desktop/src/App.tsx) · [IPC](../../apps/desktop/src/desktop.ts) · [Tiếng Việt](../../apps/desktop/src/vi.ts) | Có navigation, form dự án, quản lý thư mục và kiểm tra công cụ |
| Media library | [Scanner](../../apps/desktop/src-tauri/src/library.rs) · [FFmpeg](../../apps/desktop/src-tauri/src/probe.rs) · [Gallery](../../apps/desktop/src/MediaPanels.tsx) | Chọn thư mục, chọn nhiều tệp và native drop, cache metadata/JPEG/waveform, phân trang |
| Preview | [Protocol](../../apps/desktop/src-tauri/src/preview.rs) | Nguồn, filmstrip và waveform theo asset ID, byte range, audio/video/ảnh tùy codec WebView |
| Project và timeline | [Store](../../apps/desktop/src-tauri/src/store.rs) · [Snapshot](../../apps/desktop/src-tauri/src/timeline.rs) · [Editor](../../apps/desktop/src/TimelineEditor.tsx) · [Phép sửa](../../apps/desktop/src/timeline.ts) | Nhiều tầng, kéo thả và tự tạo dự án, khóa/ẩn/tắt tiếng, trim và split, dồn clip/liên kết, đa chọn/nhóm, undo/redo, tự lưu |
| Render và hàng đợi | [Renderer](../../apps/desktop/src-tauri/src/render.rs) · [Hàng đợi](../../apps/desktop/src/ExportQueue.tsx) | Ghép lớp, chữ, màu, keyframe, hai chuyển cảnh, MP4 H.264/AAC, xuất In–Out, FIFO, hủy/thử lại và phát tệp đã xuất |
| Kho mẫu | [Giao diện](../../apps/desktop/src/TemplateLibrary.tsx) · [Phân tích](../../apps/desktop/src-tauri/src/templates.rs) | Mẫu dựng sẵn và mẫu local theo điểm cắt, gán media theo cảnh |
| Không gian biên tập | [Thư viện](../../apps/desktop/src/EditorLibrary.tsx) · [Player](../../apps/desktop/src/EditorPlayer.tsx) · [Inspector](../../apps/desktop/src/ClipInspector.tsx) · [Menu chuột phải](../../apps/desktop/src/ContextMenu.tsx) · [Tốc độ](../../apps/desktop/src/SpeedPanel.tsx) | Preset và tài nguyên gốc, chỉnh clip, phát timeline, meter, vẽ khung tracking, speed curve, tab Thông minh, ba cột đổi rộng |
| Phụ đề | [SRT và Whisper](../../apps/desktop/src-tauri/src/captions.rs) | Chữ có thể sửa, nhập/xuất SRT UTF-8, nhận dạng cục bộ |
| Phân tích cục bộ | [analysis.rs](../../apps/desktop/src-tauri/src/analysis.rs) · [Migration 009](../../apps/desktop/src-tauri/migrations/009_audio_levels.sql) | Mức RMS 50 ms có cache, dò cảnh, tracking block matching; dùng cho meter, xóa khoảng lặng, marker nhịp, tách cảnh và bám chuyển động |
| Editor đầy đủ | [Backlog](TASK_BACKLOG.md) | M1-C, M1-D, M1-H và M5 |
| AI script và voice | [Tích hợp](API_INTEGRATIONS.md) | M2 |
| Rules, tìm kiếm và sắp xếp | [Media library](modules/media-library.md) | M3 |
| Developer skills | [Catalog](../../skills/catalog) · [Sync](../../scripts/sync-skills.mjs) | Codex và Claude dùng các bản sao có checksum |
| Runtime skills và workflow | [Workflows](modules/workflows.md) | M3 |
| Publishing | [Adapters](../../apps/desktop/src-tauri/src/publish/mod.rs) · [Giao diện](../../apps/desktop/src/PublishPanel.tsx) · [Migration 003](../../apps/desktop/src-tauri/migrations/003_publishing.sql) · [Module](modules/publishing.md) | Threads, Facebook Page, Instagram, TikTok: kết nối bằng token, nháp, duyệt, đăng, danh sách, sửa, xóa. Chưa live test |
| Scheduler và campaign | [Backlog](TASK_BACKLOG.md) | M4-C |
| CI và phân phối | [Workflow](../../.github/workflows/ci.yml) · [Bộ cài](../../.github/workflows/installers.yml) | Windows x64 NSIS và quy trình macOS Universal. Ký phát hành và cập nhật thuộc M5 |
