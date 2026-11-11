# Trạng thái hiện tại

Snapshot: 2026-11-11/EDITOR-031

Next task: M1-H

## Đã triển khai

- M0 và M1-A: monorepo pnpm, desktop shell Tauri/React, thư viện media SQLite, FFprobe, thumbnail, preview theo asset ID.
- M1-B/M1-C: timeline nhiều tầng video, audio và chữ, snapshot version 3. Có kéo thả, trim, split, snap, undo/redo, thuộc tính màu, transform, fade và animation trượt. FFmpeg ghép tầng và trộn audio. [Editor và render](modules/editor.md)
- M1-E: kho mẫu cục bộ có ba preset và mẫu tạo từ điểm cắt/tỷ lệ video tham chiếu. Người dùng gán nguồn theo cảnh, chữ, preset, nhạc, SFX và voice rồi tạo dự án.
- M1-G và một phần M1-D: editor 0.3.0 có thư viện, player, inspector và timeline trên một màn hình. Có tài nguyên tích hợp, SRT, Whisper cục bộ, tốc độ 0,5–2×, hiệu ứng và công cụ xử lý nâng cao. [Editor và render](modules/editor.md)
- M1-I: bản 0.3.1 cho kéo media từ thư viện, đổi tầng trên timeline, thu phóng timeline và preview, kéo và biến đổi hình ngay trên preview. [Editor và render](modules/editor.md)
- M5-B một phần: quy trình NSIS Windows x64 và DMG Universal arm64/x86_64. [Bàn giao](HANDOFF.md)
- M4-B và M4-C, một phần: kết nối Threads, Facebook Page, Instagram và TikTok bằng access token lưu trong keychain. Bản nháp, duyệt bằng hộp thoại native, đăng, danh sách bài, sửa bài Facebook và xóa bài. [Publishing](modules/publishing.md)

## Mức kiểm chứng

- Kiểm chứng bản 0.3.1 và trạng thái artifact ở [HANDOFF](HANDOFF.md).
- Chưa có lần gọi API mạng xã hội thật nào. Các adapter được kiểm tra bằng máy chủ giả lập theo tài liệu chính thức ngày 10/11/2026.

## Tiếp theo

M1-H ưu tiên thao tác timeline và công cụ biên tập nâng cao theo phản hồi ngày 11/11/2026. M1-F mở rộng phân tích tham chiếu. M5-B còn kiểm thử trên máy macOS và ký phát hành. [Backlog](TASK_BACKLOG.md)
