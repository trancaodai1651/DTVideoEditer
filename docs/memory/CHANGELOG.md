# Changelog

Snapshot: 2026-11-11/CAPCUT-AUDIT

## 2026-11-11 · Khảo sát CapCut Desktop

- M1-J ghi các thao tác quan sát, ca đã thử trên draft Windows riêng, điều kiện Free/Pro và phím tắt. Các tiêu chí được liên kết tới những phần cần bổ sung trong DT_Edit. [Bộ nhớ khảo sát](CAPCUT_DESKTOP_AUDIT.md)
- Tách M1-H thành nhập file, thao tác timeline, waveform/audio, keyframe, transition và các quy trình dựng nâng cao.

## 2026-11-11 · Editor 0.3.1

- M1-I: kéo media từ thư viện bằng con trỏ, xem vị trí trước khi thả, kéo clip sang tầng cùng loại. Thêm thanh zoom, zoom theo vị trí chuột, vừa khung và nút hít mép.
- Kéo chữ và hình trên preview. Video, ảnh và sticker có tay nắm đổi cỡ và xoay. Menu zoom preview tách khỏi tỷ lệ của bản xuất.

## 2026-11-10 · Editor 0.3.0

- M1-G: chuyển editor sang bố cục thư viện, trình phát, inspector và timeline, dựa trên CapCut desktop đã quan sát. Thêm nhạc, SFX, sticker gốc, preset chữ, hiệu ứng, chuyển động, bộ lọc và mẫu.
- M1-C/M1-D: phát timeline trong WebView, chỉnh tốc độ, xoay, lật, chroma key, mặt nạ, xử lý hình/tiếng, nhập và xuất SRT, nhận dạng cục bộ qua Whisper. Snapshot cũ dùng mặc định, schema SQLite giữ nguyên.
- Export dùng tệp filter graph tạm khi graph dài. Bộ test FFmpeg đọc pixel để kiểm tra chroma key, sticker và phụ đề trên MP4.

## 2026-11-10 · Editor 0.2.0

- Thêm tầng video/audio/chữ, khung hình bản dựng và inspector. FFmpeg xuất transform, màu, alpha, chữ, fade, animation và âm thanh trộn.
- Thêm kho mẫu, phân tích điểm cắt video local, gán nguồn và tạo dự án từ mẫu.
- Hàng đợi FIFO lưu qua restart, kiểm tra trùng đích, MP4 preview theo ID lượt xuất. Thêm bộ cài Windows và workflow macOS Universal.

## 2026-11-10 · M1-B và publishing M4

- Migration 002 thêm edit points theo mili giây và `render_jobs`, chuyển dự án schema 1 sang clip nối tiếp. Store chạy migration tuần tự với foreign keys tắt rồi kiểm tra toàn vẹn.
- Timeline mới: kéo thả từ gallery, di chuyển có snap, trim hai đầu, split tại playhead, undo/redo, tự lưu snapshot version 2. Lệnh `append_clip` và `remove_clip` được thay bằng `save_timeline`.
- Xuất MP4 H.264/AAC bằng một filter graph FFmpeg, có tiến độ, hủy, thử lại và ghi qua tệp tạm.
- Migration 003 và module publish: Threads, Facebook Page, Instagram, TikTok với token trong keychain, bản nháp, duyệt native, đăng, danh sách, sửa và xóa bài.
- Thêm phụ thuộc `reqwest` (blocking, TLS hệ điều hành) và `keyring`. `pnpm test:media` chạy cả test render.

## 2026-11-09 · M0 và M1-A

- Khởi tạo desktop app và shared memory, đồng bộ hai developer skills có provenance, thêm workflow kiểm tra Windows/macOS.
- Thêm migration SQLite và luồng media cục bộ từ picker tới thumbnail, preview và hai track có thể mở lại.
- Thêm fixture tạo bằng FFmpeg, smoke tests cho SQLite, file ngoài phạm vi, byte range, thu hồi và index media thật.
