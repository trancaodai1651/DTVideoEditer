# Changelog

Snapshot: 2026-11-10/M1B-M4

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
