# Trạng thái hiện tại

Snapshot: 2026-11-13/EDITOR-121

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
- Bản 0.9.0 (M1-D, M1-K, M1-H6, M5-A/M5-B): bộ cài kèm mô hình Whisper `ggml-small-q5_1.bin` nên tạo phụ đề không cần chọn mô hình; proxy chỉ tạo khi người dùng bật/bấm tạo; highlight phân tích độ nét, màu, rung máy, điểm cắt thích ứng và đỉnh âm, mặc định không giới hạn thời lượng; dựng theo âm thanh dài đúng timeline âm thanh và đi qua hết tư liệu trước khi lặp; chỉnh màu thêm bánh xe Lift/Gamma/Gain, đường cong R/G/B kéo điểm và HSL sáu dải. [Bàn giao](HANDOFF.md)
- Bản 0.10.0 (M1-D, M1-L, M1-H8): luồng Tạo phụ đề tìm model trong bộ cài hoặc cache và tự tải bản đã pin khi thiếu. Nhận dạng theo đoạn 5 phút có tiến độ, tối đa 1800 câu/chữ trên timeline. Xuất Final Cut Pro XML 4 và SRT để chuyển dự án sang Adobe Premiere. Đổi tab thư viện đưa phần nội dung về đầu tab mới. [Bàn giao](HANDOFF.md)
- Bản 0.10.1 (M1-D): bỏ qua đoạn 5 phút im lặng hoàn toàn, bỏ khoảng im lặng dài ở đầu mỗi đoạn và cộng lại đúng mốc vào phụ đề. [Bàn giao](HANDOFF.md)
- Bản 0.11.0 (M1-D/M1-H8) thêm phụ đề tô sáng hoặc hiện dần từng từ, áp kiểu cho các câu hiện có và lưu mốc trong timeline. Hiệu ứng có trong preview và MP4. [Bàn giao](HANDOFF.md)
- Bản 0.12.1 (M1-H8/M1-D) có 18 sticker, 10 mẫu phụ đề, 6 hiệu ứng, 6 chuyển cảnh giữa hai clip và 14 bộ lọc. Năm kho có tìm kiếm và yêu thích, sticker kéo được lên timeline. [Bàn giao](HANDOFF.md)
- M4-B và M4-C, một phần: kết nối Threads, Facebook Page, Instagram và TikTok bằng access token trong keychain, nháp, duyệt native, đăng, danh sách, sửa và xóa bài. [Publishing](modules/publishing.md)

## Mức kiểm chứng

- 0.11.0: 43 test Node, 37 test Rust, 12 test FFmpeg thật và hai test Whisper thật đạt. MP4 đã đo màu và chữ ẩn/hiện theo từng mốc. Tauri release QA build được. Kiểm thử tương tác DT Edit còn mở sau khi dừng Computer Use. [Bàn giao](HANDOFF.md)

- 0.10.1: hai bộ cài GitHub Actions đạt và đã xác minh ZIP. Tauri Windows tạo phụ đề tiếng Việt với model đi kèm. Whisper thật xử lý WAV 15:57 qua bốn đoạn, nhận dạng lời nói ở cuối tệp. macOS Universal đã xác minh hai kiến trúc và khởi động trên arm64. [Bàn giao](HANDOFF.md)

- 0.10.0: 42 test Node, 37 test Rust, 11 test FFmpeg thật, lint và TypeScript đạt. Trong cửa sổ Tauri Windows, đã kéo clip từ thư viện, tạo hai câu phụ đề bằng model đi kèm và xuất XML/SRT. OpenTimelineIO đọc lại tầng và điểm cắt. Chưa mở XML bằng Adobe Premiere. [Bàn giao](HANDOFF.md)

- 0.9.0: 42 test Node, 37 test Rust, 10 test FFmpeg thật và test Whisper thật (giọng Windows → mô hình small trong bố cục `resources/whisper/`) đạt. Test FFmpeg mới đo pixel cho bánh xe màu, đường cong lam và HSL đỏ. Đường cong kênh khớp tuyệt đối giữa TS và Rust. Chưa QA bằng tay trong cửa sổ Tauri. [Bàn giao](HANDOFF.md)

- 0.8.1: Tauri Windows thử highlight một/hai video, dựng theo hai WAV, lưu/mở `.dtedit` và proxy tự tạo. Test Windows tạo proxy 1280×720 giữ thời lượng/AAC của video 4K, đọc range 206 và từ chối sau thu hồi. Test quét tới cảnh cuối nguồn 125 giây, mở `.dtedit` với asset ID khác và chạy xóa nền bằng archive đóng gói. [Bàn giao](HANDOFF.md)
- 0.7.0 trên Windows 11: cửa sổ Tauri 1280×720 và trên màn hình 2560×1440, kéo MP4/PNG/WAV, tạo cả highlight và bản theo WAV, phát preview FFmpeg và xóa nền PNG. Test rembg thật xuất ProRes có alpha và AAC. CI macOS kiểm tra DMG hai kiến trúc và khởi động app trên ARM64. Live test Claude/HeyGen cần key. [Bàn giao](HANDOFF.md)

- 0.6.0: 33 test Node, 32 test Rust, 7 test FFmpeg thật và test giọng đọc Windows thật đạt. Test FFmpeg mới đo độ lệch âm thanh 700 ms giữa hai góc, kiểm tra điểm ảnh cho reverse, freeze, LUT đảo màu, hue, lớp điều chỉnh khử màu, và xuất chữ nhiều thuộc tính. Giao diện đã thao tác trong trình duyệt với IPC giả lập. Chưa thử trong cửa sổ Tauri thật và chưa gọi Claude API thật. [Bàn giao](HANDOFF.md)

- 0.5.0: 28 test Node, 26 test Rust và 6 test FFmpeg thật đạt. Test FFmpeg mới đo mức âm lượng, dò điểm chuyển cảnh, bám theo hình vuông chuyển động và xuất speed curve kèm âm thanh đã tách, đo thời lượng hình và tiếng bằng FFprobe. Giao diện đã thao tác trong trình duyệt với IPC giả lập: menu chuột phải, tách âm thanh, multicam, compound, speed curve, tab Thông minh và vẽ khung tracking. Chưa thao tác trong cửa sổ Tauri thật. [Bàn giao](HANDOFF.md)
- Bản 0.4.1 đã được người dùng xác nhận kéo từ thư viện và Explorer trên Windows.
- Chưa có lần gọi API mạng xã hội thật nào.

## Tiếp theo

M1-H8: tiếp tục preset và các ca giao diện còn mở trong [bàn giao](HANDOFF.md). M1-L kiểm thử import XML trong Adobe Premiere và lưu `.prproj`. M1-H6 còn preset xuất, mask theo tracking, HSL và LUT trong preview tương tác. M2-A/M1-J còn live test Claude/HeyGen. M1-F mở rộng phân tích video mẫu. [Backlog](TASK_BACKLOG.md)
