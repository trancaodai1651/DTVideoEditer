# Trạng thái hiện tại

Snapshot: 2026-11-10/M1B-M4

Next task: M4-B

## Đã triển khai

- M0 và M1-A: monorepo pnpm, desktop shell Tauri/React, thư viện media SQLite, FFprobe, thumbnail, preview theo asset ID.
- M1-B: timeline có edit points theo mili giây, snapshot JSON version 2, kéo thả, trim, split, snap, undo/redo và tự lưu. Xuất MP4 H.264/AAC từ timeline với tiến độ, hủy và thử lại. [Editor và render](modules/editor.md)
- M4-B và M4-C, một phần: kết nối Threads, Facebook Page, Instagram và TikTok bằng access token lưu trong keychain. Bản nháp, duyệt bằng hộp thoại native, đăng, danh sách bài, sửa bài Facebook và xóa bài. [Publishing](modules/publishing.md)

## Mức kiểm chứng

- Đã chạy trên Windows 11: lint, TypeScript, test Node, test Rust, hai test FFmpeg thật, test keychain thật và build release. [Chi tiết](HANDOFF.md)
- Giao diện mới được thao tác trong trình duyệt với IPC giả lập. Chưa chạy trong cửa sổ Tauri thật.
- Chưa có lần gọi API mạng xã hội thật nào. Các adapter được kiểm tra bằng máy chủ giả lập theo tài liệu chính thức ngày 10/11/2026.

## Tiếp theo

M4-B cần token thật để chạy live test từng nền tảng, sau đó là OAuth. M1-C tiếp tục phía editor. [Backlog](TASK_BACKLOG.md)
