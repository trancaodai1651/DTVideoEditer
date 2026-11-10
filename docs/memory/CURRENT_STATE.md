# Trạng thái hiện tại

Snapshot: 2026-11-10/EDITOR-020

Next task: M1-F

## Đã triển khai

- M0 và M1-A: monorepo pnpm, desktop shell Tauri/React, thư viện media SQLite, FFprobe, thumbnail, preview theo asset ID.
- M1-B/M1-C: timeline nhiều tầng video, audio và chữ, snapshot version 3. Có kéo thả, trim, split, snap, undo/redo, thuộc tính màu, transform, fade và animation trượt. FFmpeg ghép tầng và trộn audio. [Editor và render](modules/editor.md)
- M1-E: kho mẫu cục bộ có ba preset và mẫu tạo từ điểm cắt/tỷ lệ video tham chiếu. Người dùng gán nguồn theo cảnh, chữ, preset, nhạc, SFX và voice rồi tạo dự án.
- M5-B một phần: bản 0.2.0 có bộ cài NSIS Windows x64 và DMG Universal đã kiểm tra arm64/x86_64.
- M4-B và M4-C, một phần: kết nối Threads, Facebook Page, Instagram và TikTok bằng access token lưu trong keychain. Bản nháp, duyệt bằng hộp thoại native, đăng, danh sách bài, sửa bài Facebook và xóa bài. [Publishing](modules/publishing.md)

## Mức kiểm chứng

- Kiểm chứng bản 0.2.0 và trạng thái artifact ở [HANDOFF](HANDOFF.md).
- Chưa có lần gọi API mạng xã hội thật nào. Các adapter được kiểm tra bằng máy chủ giả lập theo tài liệu chính thức ngày 10/11/2026.

## Tiếp theo

M1-F mở rộng phân tích tham chiếu. M5-B còn kiểm thử cài đặt và phát media trên macOS, ký phát hành và notarization. M4-B còn live test và OAuth. [Backlog](TASK_BACKLOG.md)
