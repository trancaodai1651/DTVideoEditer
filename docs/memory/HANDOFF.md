# Bàn giao

Snapshot: 2026-11-11/EDITOR-040

## Điểm vào cho Claude Code hoặc Codex

Chạy `pnpm context:summary` và `git status -sb`. Đọc [bản đồ dự án](PROJECT_INDEX.md), [trạng thái](CURRENT_STATE.md), [khảo sát CapCut](CAPCUT_DESKTOP_AUDIT.md) và [backlog](TASK_BACKLOG.md). Người dùng muốn DT_Edit có thao tác timeline, preview, các thư viện và thuộc tính tương tự CapCut Desktop, kho mẫu từ video tham chiếu, hàng đợi xuất nhiều dự án và bộ cài Windows/macOS Universal. Người dùng đã cho phép push source lên `origin` và chạy GitHub Actions. Tiếp tục M1-H3, rồi M1-H6 và M1-F. Đọc [quyền media](SECURITY.md) trước khi sửa quyền, picker hoặc native drop.

Phiên khảo sát dùng Computer Use trên CapCut Windows 9.7.1.4203, draft tổng hợp **1111 (1)**. Đã thử import nhiều tệp, split theo frame, trim với magnet/linkage, chọn phải, group/compound, keyframe, Black Fade, kéo chữ, mask hình chữ nhật, SRT tiếng Việt, fade và kéo clip WAV, lớp hiệu ứng riêng, zoom vừa khung, xuất MP4 toàn timeline và xuất riêng range In–Out. Người dùng chưa có quyền CapCut Pro. Dùng ca CC-06/CC-07 cho thao tác timeline, CC-14 cho keyframe, CC-18/CC-19 cho audio và CC-23/CC-29 cho nối cảnh và xuất vùng. [Kết quả khảo sát](CAPCUT_DESKTOP_AUDIT.md)

## Bản 0.4.0

- M1-H1. [Native picker và drop](../../apps/desktop/src-tauri/src/main.rs), [cấp quyền](../../apps/desktop/src-tauri/src/library.rs) và [migration 005](../../apps/desktop/src-tauri/migrations/005_file_grants.sql). Các lệnh đọc nguồn dùng `authorized_asset`. Drop vào timeline lấy dự án, tầng và thời điểm tại lúc thả rồi đặt các clip theo loại sau khi index.
- M1-H2. [Phép sửa timeline](../../apps/desktop/src/timeline.ts) xử lý dồn clip chính, liên kết tầng phía sau, hít mép, chọn theo hướng, group, clipboard và undo. Marker giữ theo dự án trong WebView. Mốc In/Out được dùng cho lượt xuất và có thể đặt lại khi đổi dự án.
- M1-H3. [Migration 006](../../apps/desktop/src-tauri/migrations/006_waveforms.sql) lưu waveform theo asset. Waveform hiển thị phạm vi trim. Gain dB, fade đầu và fade cuối lưu trong thuộc tính clip. WebView giới hạn volume ở 100%, FFmpeg áp dụng gain dương khi xuất.
- M1-H4/H5. [Inspector](../../apps/desktop/src/ClipInspector.tsx) và [renderer](../../apps/desktop/src-tauri/src/render.rs) nội suy transform, xử lý mối nối kề nhau và giữ tổng thời lượng. Hòa trộn giữ frame cuối clip trước trong khoảng chuyển cảnh, qua đen chia thời lượng làm hai nửa. Âm thanh giữ nguyên nhịp dựng.
- M1-H6. `exportRange` là thuộc tính tùy chọn của snapshot lưu cùng từng render job. FFmpeg cắt video và audio đã ghép rồi đặt lại timestamp. Job cũ dùng toàn timeline.

**Đã kiểm chứng**

- Hộp thoại native trên Windows nhập cùng lượt một MP4 và một WAV có tên tiếng Việt. Thư viện báo nhập 2 tệp, ảnh PNG cùng thư mục không được nhập. Thử với bản dev dùng ID app và SQLite riêng.
- Lint, TypeScript, Vite build, 19 test Node, 21 test Rust, 5 test FFmpeg, kiểm tra định dạng Rust và hai checker bộ nhớ. Một test keychain cần OS thật vẫn được bỏ qua mặc định.
- Fixture FFmpeg kiểm tra PNG waveform và cache, màu pha ở dissolve, màu đen tại ranh giới fade, pixel sticker có transform động, MP4 chứa audio và chỉ dài 1,1 giây theo In–Out.

**Còn mở**

- Kiểm tra thả tệp từ Explorer/Finder và cài đặt/chạy trực tiếp trên macOS. UI và codec có thể khác nhau giữa WebView2 và WKWebView.
- M1-H3 tiếp theo cần filmstrip nhiều khung, khóa/ẩn/tắt tiếng theo tầng, meter và tách audio. Tiếp tục M1-H6 với compound, multicam, speed curve, tracking, rich text, adjustment layer/LUT và preset xuất. M1-F cần tái dựng đề xuất chữ, hiệu ứng, chuyển động và audio từ video tham chiếu. Các mục Pro/cloud vẫn ở M1-J.

**Git và bộ cài** Bản 0.4.0 dùng tag `v0.4.0`. Workflow nhận tag và tạo NSIS Windows x64 cùng DMG Universal arm64/x86_64. Kiểm tra bằng `lipo` và `hdiutil` trên runner. [Workflow](../../.github/workflows/installers.yml)

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
