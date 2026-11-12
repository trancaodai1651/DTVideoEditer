# Trạng thái hiện tại

Snapshot: 2026-11-12/EDITOR-050

Next task: M1-H8

## Đã triển khai

- M0 và M1-A: monorepo pnpm, desktop shell Tauri/React, thư viện media SQLite, FFprobe, thumbnail, preview theo asset ID.
- M1-B/M1-C: timeline nhiều tầng video, audio và chữ, snapshot version 3. Có kéo thả, trim, split, snap, undo/redo, thuộc tính màu, transform, fade và animation trượt. FFmpeg ghép tầng và trộn audio. [Editor và render](modules/editor.md)
- M1-E: kho mẫu cục bộ có ba preset và mẫu tạo từ điểm cắt/tỷ lệ video tham chiếu. Người dùng gán nguồn theo cảnh, chữ, preset, nhạc, SFX và voice rồi tạo dự án.
- M1-G và một phần M1-D: thư viện, player, inspector và timeline trên một màn hình. Có tài nguyên tích hợp, SRT, Whisper cục bộ, hiệu ứng và công cụ xử lý nâng cao.
- M1-I và M1-H1 đến M1-H7: kéo thả từ thư viện và hệ điều hành, dồn clip, đa chọn, nhóm, marker, waveform, filmstrip, gain/fade, keyframe transform, chuyển cảnh, xuất In–Out, khóa/ẩn/tắt tiếng theo tầng. [Bàn giao](HANDOFF.md)
- Bản 0.5.0 (M1-H3, M1-H6, M1-H8 một phần): menu chuột phải trên clip, tầng và timeline; chọn bằng khung; tách/khôi phục âm thanh; tắt/bật clip; compound thu gọn được; multicam đổi góc bằng phím 1–9; tốc độ 0,1–10× và speed curve có đồ thị; tay nắm fade audio; meter âm lượng; bám theo chuyển động; dò cảnh, xóa khoảng lặng, marker theo nhịp; tab Thông minh; đổi chiều rộng ba cột; phím `V`, `Q`, `W`, `Ctrl+R`, `Shift+B`, `Ctrl+Shift+S`, `Alt+G`, `Ctrl+D`. [Editor và render](modules/editor.md)
- M5-B một phần: quy trình NSIS Windows x64 và DMG Universal arm64/x86_64.
- M4-B và M4-C, một phần: kết nối Threads, Facebook Page, Instagram và TikTok bằng access token trong keychain, nháp, duyệt native, đăng, danh sách, sửa và xóa bài. [Publishing](modules/publishing.md)

## Mức kiểm chứng

- 0.5.0: 28 test Node, 26 test Rust và 6 test FFmpeg thật đạt. Test FFmpeg mới đo mức âm lượng, dò điểm chuyển cảnh, bám theo hình vuông chuyển động và xuất speed curve kèm âm thanh đã tách, đo thời lượng hình và tiếng bằng FFprobe. Giao diện đã thao tác trong trình duyệt với IPC giả lập: menu chuột phải, tách âm thanh, multicam, compound, speed curve, tab Thông minh và vẽ khung tracking. Chưa thao tác trong cửa sổ Tauri thật. [Bàn giao](HANDOFF.md)
- Bản 0.4.1 đã được người dùng xác nhận kéo từ thư viện và Explorer trên Windows.
- Chưa có lần gọi API mạng xã hội thật nào.

## Tiếp theo

M1-H8: thử 0.5.0 trong cửa sổ thật theo các ca trong bàn giao, rồi bổ sung copy/paste thuộc tính, thay clip, freeze/reverse và đối chiếu bố cục ở 1280×720 và 2560×1440. M1-H6 còn timeline con cho compound, rich text, adjustment layer/LUT và preset xuất. M1-F mở rộng phân tích video mẫu. [Backlog](TASK_BACKLOG.md)
