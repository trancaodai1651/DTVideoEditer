# Trạng thái hiện tại

Snapshot: 2026-11-12/EDITOR-081

Next task: M1-H8

## Đã triển khai

- M0 và M1-A: monorepo pnpm, desktop shell Tauri/React, thư viện media SQLite, FFprobe, thumbnail, preview theo asset ID.
- M1-B/M1-C: timeline nhiều tầng video, audio và chữ, snapshot version 3. Có kéo thả, trim, split, snap, undo/redo, thuộc tính màu, transform, fade và animation trượt. FFmpeg ghép tầng và trộn audio. [Editor và render](modules/editor.md)
- M1-E: kho mẫu cục bộ có ba preset và mẫu tạo từ điểm cắt/tỷ lệ video tham chiếu. Người dùng gán nguồn theo cảnh, chữ, preset, nhạc, SFX và voice rồi tạo dự án.
- M1-G và một phần M1-D: thư viện, player, inspector và timeline trên một màn hình. Có tài nguyên tích hợp, SRT, Whisper cục bộ, hiệu ứng và công cụ xử lý nâng cao.
- M1-I và M1-H1 đến M1-H7: kéo thả từ thư viện và hệ điều hành, dồn clip, đa chọn, nhóm, marker, waveform, filmstrip, gain/fade, keyframe transform, chuyển cảnh, xuất In–Out, khóa/ẩn/tắt tiếng theo tầng. [Bàn giao](HANDOFF.md)
- Bản 0.5.0 (M1-H3, M1-H6, M1-H8 một phần): menu chuột phải trên clip, tầng và timeline; chọn bằng khung; tách/khôi phục âm thanh; tắt/bật clip; compound thu gọn được; multicam đổi góc bằng phím 1–9; tốc độ 0,1–10× và speed curve có đồ thị; tay nắm fade audio; meter âm lượng; bám theo chuyển động; dò cảnh, xóa khoảng lặng, marker theo nhịp; tab Thông minh; đổi chiều rộng ba cột; phím `V`, `Q`, `W`, `Ctrl+R`, `Shift+B`, `Ctrl+Shift+S`, `Alt+G`, `Ctrl+D`. [Editor và render](modules/editor.md)
- Bản 0.6.0 (M1-H6, M1-H8, M2-B một phần): chỉnh màu đầy đủ (phơi sáng, vùng sáng/tối, điểm trắng/đen, nhiệt độ, sắc độ, tông, bão hòa, rực màu, đường cong tông, LUT .cube), lớp điều chỉnh, chữ phong phú (5 phông, màu tùy chọn, viền, nền, căn lề, bóng, hiện/ẩn dần, giãn dòng), sao chép/dán thuộc tính, thay clip, khung hình tĩnh, đảo ngược, timeline con cho compound, multicam đồng bộ theo âm thanh, tracking theo vị trí/tỷ lệ/góc xoay, lồng tiếng bằng giọng của hệ điều hành và dịch phụ đề bằng Claude API có hỏi xác nhận. [Editor và render](modules/editor.md)
- M5-B một phần: quy trình NSIS Windows x64 và DMG Universal arm64/x86_64.
- Bản 0.7.0 (M1-K, M1-H6, M1-H8, M2-A/M1-J): dựng highlight hoặc dựng theo một clip âm thanh từ timeline, mở thành dự án mới có thể sửa; **Xem bản xuất** bằng FFmpeg; lọc loại media và menu chuột phải của thẻ/trình phát; xóa nền AI cục bộ và tạo avatar HeyGen. Cơ sở dữ liệu schema 10, timeline version 3. [Editor và render](modules/editor.md)
- Bản 0.8.1 (M1-K, M1-L, M5-A/M5-B): quét toàn bộ khoảng video được dùng trên timeline, giữ nhiều nguồn trong highlight, dựng theo một hoặc nhiều âm thanh, proxy 720p mặc định bật, tệp `.dtedit` lưu ở nơi được chọn và runtime xóa nền đi kèm bộ cài. [Bàn giao](HANDOFF.md)
- M4-B và M4-C, một phần: kết nối Threads, Facebook Page, Instagram và TikTok bằng access token trong keychain, nháp, duyệt native, đăng, danh sách, sửa và xóa bài. [Publishing](modules/publishing.md)

## Mức kiểm chứng

- 0.8.0: test Windows tạo proxy 1280×720 giữ thời lượng/AAC của video 4K, đọc range 206 và từ chối sau thu hồi. Test quét tới cảnh cuối nguồn 125 giây, lưu/mở `.dtedit` với asset ID khác, phân bổ thời lượng cho ba tệp và giữ âm thanh chồng tầng. [Bàn giao](HANDOFF.md)
- 0.7.0 trên Windows 11: cửa sổ Tauri 1280×720 và trên màn hình 2560×1440, kéo MP4/PNG/WAV, tạo cả highlight và bản theo WAV, phát preview FFmpeg và xóa nền PNG. Test rembg thật xuất ProRes có alpha và AAC. CI macOS kiểm tra DMG hai kiến trúc và khởi động app trên ARM64. Live test Claude/HeyGen cần key. [Bàn giao](HANDOFF.md)

- 0.6.0: 33 test Node, 32 test Rust, 7 test FFmpeg thật và test giọng đọc Windows thật đạt. Test FFmpeg mới đo độ lệch âm thanh 700 ms giữa hai góc, kiểm tra điểm ảnh cho reverse, freeze, LUT đảo màu, hue, lớp điều chỉnh khử màu, và xuất chữ nhiều thuộc tính. Giao diện đã thao tác trong trình duyệt với IPC giả lập. Chưa thử trong cửa sổ Tauri thật và chưa gọi Claude API thật. [Bàn giao](HANDOFF.md)

- 0.5.0: 28 test Node, 26 test Rust và 6 test FFmpeg thật đạt. Test FFmpeg mới đo mức âm lượng, dò điểm chuyển cảnh, bám theo hình vuông chuyển động và xuất speed curve kèm âm thanh đã tách, đo thời lượng hình và tiếng bằng FFprobe. Giao diện đã thao tác trong trình duyệt với IPC giả lập: menu chuột phải, tách âm thanh, multicam, compound, speed curve, tab Thông minh và vẽ khung tracking. Chưa thao tác trong cửa sổ Tauri thật. [Bàn giao](HANDOFF.md)
- Bản 0.4.1 đã được người dùng xác nhận kéo từ thư viện và Explorer trên Windows.
- Chưa có lần gọi API mạng xã hội thật nào.

## Tiếp theo

M1-H8: tiếp tục preset và các ca giao diện còn mở trong [bàn giao](HANDOFF.md). M1-H6 còn preset xuất, HSL từng màu, bánh xe màu, mask theo tracking và LUT trong preview tương tác. M2-A/M1-J còn live test Claude/HeyGen. M1-F mở rộng phân tích video mẫu. [Backlog](TASK_BACKLOG.md)
