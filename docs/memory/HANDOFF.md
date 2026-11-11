# Bàn giao

Snapshot: 2026-11-11/CAPCUT-AUDIT

## Điểm vào cho Claude Code hoặc Codex

Đọc [bản đồ dự án](PROJECT_INDEX.md), [trạng thái](CURRENT_STATE.md), [khảo sát CapCut](CAPCUT_DESKTOP_AUDIT.md) và [backlog](TASK_BACKLOG.md). Người dùng muốn DT_Edit tiến tới các thao tác dựng thực tế của CapCut Desktop và dùng chung bộ nhớ để chuyển agent. Bắt đầu M1-H1. Đọc [quyền media](SECURITY.md) trước khi sửa picker, quyền tệp hoặc native drop. Ca CC-06 là chuẩn cho M1-H2. Các dòng Đã thấy hoặc Cần thử trong khảo sát chưa phải hành vi đã xác minh.

Phiên khảo sát dùng Computer Use trên CapCut Windows 9.7.1.4203, draft tổng hợp **1111 (1)**. Đã thử import nhiều tệp, split theo frame, trim với magnet/linkage, chọn phải, group/compound, keyframe, Black Fade, kéo chữ, mask hình chữ nhật, SRT tiếng Việt, fade và kéo clip WAV, lớp hiệu ứng riêng, zoom vừa khung, xuất MP4 toàn timeline và xuất riêng range In–Out. Người dùng hiện chưa có quyền CapCut Pro. Các ca Pro/cloud và một số thao tác trên fixture khác vẫn chờ kiểm chứng. Mốc source trước khảo sát là `16c13bc`. Phiên khảo sát cập nhật tài liệu, DT_Edit hiện tại là 0.3.1.

## Kiểm chứng bản 0.3.1

**Mục tiêu** M1-I trong 0.3.1 cải thiện kéo thả, thu phóng timeline và chỉnh trực tiếp trên preview. M1-G đưa bố cục và kho công cụ vào 0.3.0 sau khi xem CapCut 9.7.1.

**Source** [Thư viện](../../apps/desktop/src/EditorLibrary.tsx), [Player](../../apps/desktop/src/EditorPlayer.tsx), [Inspector](../../apps/desktop/src/ClipInspector.tsx), [Catalog](../../apps/desktop/src-tauri/src/catalog.rs), [Phụ đề](../../apps/desktop/src-tauri/src/captions.rs) và [Renderer](../../apps/desktop/src-tauri/src/render.rs). Snapshot vẫn là version 3 với thuộc tính mặc định cho dữ liệu cũ. Không có migration SQLite mới.

**Kiểm chứng đã chạy trên Windows 11**

- Cửa sổ Tauri với SQLite riêng đã kéo MP4 từ thư viện tới 1,8 giây, di chuyển lên Video 2, zoom timeline và kéo sticker. Tay nắm góc đổi tỷ lệ từ 28% lên 48%, tay nắm xoay đổi góc từ 0° sang −50°. Inspector và trạng thái tự lưu cập nhật.
- Lint, TypeScript, Vite build, 15 test Node, 20 test Rust, `context:check` và `skills:check` đạt. Đã thử preview 200%, hoàn tác và làm lại trong cửa sổ thật.
- Đã xuất fixture H.264/AAC 640×360 dài 9,701 giây từ giao diện. Pixel ở tâm sticker đã kéo có RGB 254/194/73 tại vị trí dự kiến.
- 4 test FFmpeg thật, gồm kiểm tra pixel cho tốc độ 1,5×, chroma key, sticker alpha và phụ đề tiếng Việt. Filter Whisper đã chạy với mẫu nói tổng hợp và mô hình GGML cục bộ.
- Quy trình đóng gói [NSIS và DMG Universal](../../.github/workflows/installers.yml) dùng FFmpeg/FFprobe cài riêng. Windows chưa ký và DMG ký ad hoc.
- Hai job bộ cài 0.3.1 thành công. Runner xác minh DMG và binary arm64/x86_64. Hai bộ cài nằm trong `apps/desktop/src-tauri/target/verified-installers/v0.3.1`. Bản Windows được build tại máy và bản DMG được tải từ Actions sau khi đối chiếu SHA-256 của archive. [Build bộ cài](https://github.com/trancaodai1651/DTVideoEditer/actions/runs/42975842217) · [Kiểm tra CI](https://github.com/trancaodai1651/DTVideoEditer/actions/runs/42975842172)

**Giới hạn** Một số hiệu ứng nâng cao hiển thị đầy đủ khi xuất. Kho mẫu nhận timing và tỷ lệ, các lớp nguồn và preset do người dùng gán. AI avatar, xóa đối tượng, mở rộng ảnh, retouch, keyframe và chuyển cảnh giữa hai clip còn trong backlog. macOS còn kiểm thử cài đặt và phát media trên máy người dùng. Publishing đã kiểm tra bằng máy chủ giả lập.

**Git** Nền trước phiên là `b9e92f1`. Commit `6bbb387` và tag `v0.3.1` đã push. [Workflow bộ cài 0.3.1](https://github.com/trancaodai1651/DTVideoEditer/actions/runs/42975842217).

**Task tiếp theo** M1-H1 bổ sung picker nhiều tệp và kéo tệp trực tiếp. M1-H2 tiếp theo cho đa chọn và ripple. M1-J theo dõi phần khảo sát còn mở. M1-F tiếp tục nhận dạng video tham chiếu. [Backlog](TASK_BACKLOG.md) · [Editor](modules/editor.md)
