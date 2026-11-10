# Bàn giao

Snapshot: 2026-11-10/WORKBENCH-030

**Mục tiêu** M1-G và một phần M1-C/M1-D trong 0.3.0. Đã xem CapCut 9.7.1 trên Windows và đối chiếu ba ảnh về bố cục, kho âm thanh và inspector.

**Source** [Thư viện](../../apps/desktop/src/EditorLibrary.tsx), [Player](../../apps/desktop/src/EditorPlayer.tsx), [Inspector](../../apps/desktop/src/ClipInspector.tsx), [Catalog](../../apps/desktop/src-tauri/src/catalog.rs), [Phụ đề](../../apps/desktop/src-tauri/src/captions.rs) và [Renderer](../../apps/desktop/src-tauri/src/render.rs). Snapshot vẫn là version 3 với thuộc tính mặc định cho dữ liệu cũ. Không có migration SQLite mới.

**Kiểm chứng đã chạy trên Windows 11**

- Đã mở cửa sổ Tauri với SQLite kiểm thử riêng và quan sát bố cục ở hai kích thước cửa sổ.
- Lint, TypeScript, Vite build, 13 test Node, 20 test Rust, `context:check` và `skills:check` đã đạt.
- 4 test FFmpeg thật, gồm kiểm tra pixel cho tốc độ 1,5×, chroma key, sticker alpha và phụ đề tiếng Việt. Filter Whisper đã chạy với mẫu nói tổng hợp và mô hình GGML cục bộ.
- Quy trình đóng gói [NSIS và DMG Universal](../../.github/workflows/installers.yml) dùng FFmpeg/FFprobe cài riêng. Windows chưa ký và DMG ký ad hoc.

**Giới hạn** Một số hiệu ứng nâng cao hiển thị đầy đủ khi xuất. Kho mẫu nhận timing và tỷ lệ, các lớp nguồn và preset do người dùng gán. AI avatar, xóa đối tượng, mở rộng ảnh, retouch, keyframe và chuyển cảnh giữa hai clip còn trong backlog. macOS còn kiểm thử cài đặt và phát media trên máy người dùng. Publishing đã kiểm tra bằng máy chủ giả lập.

**Git** Nền trước phiên là `aff9213`. Bản trước [v0.2.0](https://github.com/trancaodai1651/DTVideoEditer/actions/runs/42792075988) đã xác minh arm64 và x86_64.

**Task tiếp theo** M1-F mở rộng nhận dạng chữ, chuyển động, chuyển cảnh và âm thanh từ video tham chiếu. M1-H theo dõi các công cụ biên tập nâng cao. [Backlog](TASK_BACKLOG.md) · [Editor](modules/editor.md)
