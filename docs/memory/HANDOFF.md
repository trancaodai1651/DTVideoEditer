# Bàn giao

Snapshot: 2026-11-11/EDITOR-031

**Mục tiêu** M1-I trong 0.3.1 cải thiện kéo thả, thu phóng timeline và chỉnh trực tiếp trên preview. M1-G đưa bố cục và kho công cụ vào 0.3.0 sau khi xem CapCut 9.7.1.

**Source** [Thư viện](../../apps/desktop/src/EditorLibrary.tsx), [Player](../../apps/desktop/src/EditorPlayer.tsx), [Inspector](../../apps/desktop/src/ClipInspector.tsx), [Catalog](../../apps/desktop/src-tauri/src/catalog.rs), [Phụ đề](../../apps/desktop/src-tauri/src/captions.rs) và [Renderer](../../apps/desktop/src-tauri/src/render.rs). Snapshot vẫn là version 3 với thuộc tính mặc định cho dữ liệu cũ. Không có migration SQLite mới.

**Kiểm chứng đã chạy trên Windows 11**

- Cửa sổ Tauri với SQLite riêng đã kéo MP4 từ thư viện tới 1,8 giây, di chuyển lên Video 2, zoom timeline và kéo sticker. Tay nắm góc đổi tỷ lệ từ 28% lên 48%, tay nắm xoay đổi góc từ 0° sang −50°. Inspector và trạng thái tự lưu cập nhật.
- Lint, TypeScript, Vite build, 15 test Node, `context:check` và `skills:check` đạt. Bản 0.3.0 đã qua 20 test Rust.
- 4 test FFmpeg thật, gồm kiểm tra pixel cho tốc độ 1,5×, chroma key, sticker alpha và phụ đề tiếng Việt. Filter Whisper đã chạy với mẫu nói tổng hợp và mô hình GGML cục bộ.
- Quy trình đóng gói [NSIS và DMG Universal](../../.github/workflows/installers.yml) dùng FFmpeg/FFprobe cài riêng. Windows chưa ký và DMG ký ad hoc.

**Giới hạn** Một số hiệu ứng nâng cao hiển thị đầy đủ khi xuất. Kho mẫu nhận timing và tỷ lệ, các lớp nguồn và preset do người dùng gán. AI avatar, xóa đối tượng, mở rộng ảnh, retouch, keyframe và chuyển cảnh giữa hai clip còn trong backlog. macOS còn kiểm thử cài đặt và phát media trên máy người dùng. Publishing đã kiểm tra bằng máy chủ giả lập.

**Git** Nền trước phiên là `b9e92f1`. Bộ cài [v0.3.0](https://github.com/trancaodai1651/DTVideoEditer/actions/runs/42799878792) đã build trên Windows và macOS.

**Task tiếp theo** M1-F mở rộng nhận dạng chữ, chuyển động, chuyển cảnh và âm thanh từ video tham chiếu. M1-H theo dõi các công cụ biên tập nâng cao. [Backlog](TASK_BACKLOG.md) · [Editor](modules/editor.md)
