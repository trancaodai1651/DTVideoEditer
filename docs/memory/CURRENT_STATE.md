# Trạng thái hiện tại

Snapshot: 2026-11-12/EDITOR-041

Next task: M1-H3

## Đã triển khai

- M0 và M1-A: monorepo pnpm, desktop shell Tauri/React, thư viện media SQLite, FFprobe, thumbnail, preview theo asset ID.
- M1-B/M1-C: timeline nhiều tầng video, audio và chữ, snapshot version 3. Có kéo thả, trim, split, snap, undo/redo, thuộc tính màu, transform, fade và animation trượt. FFmpeg ghép tầng và trộn audio. [Editor và render](modules/editor.md)
- M1-E: kho mẫu cục bộ có ba preset và mẫu tạo từ điểm cắt/tỷ lệ video tham chiếu. Người dùng gán nguồn theo cảnh, chữ, preset, nhạc, SFX và voice rồi tạo dự án.
- M1-G và một phần M1-D: editor 0.3.0 có thư viện, player, inspector và timeline trên một màn hình. Có tài nguyên tích hợp, SRT, Whisper cục bộ, tốc độ 0,5–2×, hiệu ứng và công cụ xử lý nâng cao. [Editor và render](modules/editor.md)
- M1-I: bản 0.3.1 cho kéo media từ thư viện, đổi tầng trên timeline, thu phóng timeline và preview, kéo và biến đổi hình ngay trên preview. [Editor và render](modules/editor.md)
- M1-H1 đến M1-H6: bản 0.4.0 bổ sung chọn nhiều tệp, native drop, dồn clip, đa chọn, nhóm, marker, waveform, gain/fade âm thanh, keyframe transform, chuyển cảnh giữa hai clip và xuất In–Out. [Editor và render](modules/editor.md) · [Quyền media](SECURITY.md)
- M1-H7 và M1-H2/H3: bản 0.4.1 nhận native drop đúng cấp cửa sổ, tạo dự án khi thả clip đầu, thả vào tầng phủ và âm thanh, có tay kéo đổi chiều cao timeline, điều hướng 30 fps, filmstrip và khóa/ẩn/tắt tiếng theo tầng. [Bàn giao](HANDOFF.md)
- M5-B một phần: quy trình NSIS Windows x64 và DMG Universal arm64/x86_64. [Bàn giao](HANDOFF.md)
- M4-B và M4-C, một phần: kết nối Threads, Facebook Page, Instagram và TikTok bằng access token lưu trong keychain. Bản nháp, duyệt bằng hộp thoại native, đăng, danh sách bài, sửa bài Facebook và xóa bài. [Publishing](modules/publishing.md)

## Mức kiểm chứng

- Người dùng xác nhận cả kéo từ thư viện và kéo trực tiếp từ Explorer xuống timeline trong bản production QA 0.4.1 trên Windows. Fixture FFmpeg kiểm tra filmstrip nhiều thời điểm, điểm ảnh của chuyển cảnh, sticker có keyframe và thời lượng In–Out với audio. [Bàn giao](HANDOFF.md)
- M1-J đã khảo sát CapCut Desktop 9.7.1.4203 bằng Computer Use trên Windows. Có bản đồ 29 nhóm thao tác, bảng phím tắt và kết quả tái lập cho ripple/linkage, keyframe, transition, compound, audio fade, effect layer, mask, SRT và export. [Bộ nhớ khảo sát](CAPCUT_DESKTOP_AUDIT.md)
- Chưa có lần gọi API mạng xã hội thật nào. Các adapter được kiểm tra bằng máy chủ giả lập theo tài liệu chính thức ngày 10/11/2026.

## Tiếp theo

M1-H3 tiếp theo là tách/khôi phục audio, meter và tay nắm fade. Tiếp tục M1-H6 cho compound, multicam và chỉnh tốc độ nâng cao. M1-F mở rộng phân tích tham chiếu từ nhịp cắt và tỷ lệ sang chữ, hiệu ứng, chuyển động và lớp âm thanh. M1-J giữ các ca Pro, cloud và thao tác chưa kiểm chứng. [Backlog](TASK_BACKLOG.md)
