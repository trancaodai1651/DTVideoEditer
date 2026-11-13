# Changelog

Snapshot: 2026-11-13/EDITOR-121

## 2026-11-13 · Editor 0.12.1

- M1-H8 sửa cú pháp FFmpeg khi dùng Âm bản trên lớp điều chỉnh để giữ nguyên alpha và áp dụng đúng khoảng thời gian.

## 2026-11-13 · Editor 0.12.0

- M1-H8/M1-D mở rộng năm kho tích hợp. Thêm 12 sticker, 10 mẫu phụ đề, ba hiệu ứng, bốn chuyển cảnh giữa clip và chín bộ lọc. Các kho có tìm mẫu và lưu yêu thích trên thiết bị.

## 2026-11-13 · Editor 0.11.0

- M1-D/M1-H8 thêm kiểu phụ đề tô sáng và hiện dần theo mốc từ của Whisper, tùy chỉnh màu nhấn từng câu và áp kiểu hàng loạt. Preview và MP4 dùng cùng mốc. Phụ đề cũ có thể dùng mốc ước tính.

## 2026-11-12 · Editor 0.10.1

- M1-D đo im lặng ở đầu mỗi đoạn nhận dạng để Whisper không đặt câu vào khoảng im lặng dài. Bỏ qua đoạn không có tiếng và giữ nguyên vị trí câu trên timeline.

## 2026-11-12 · Editor 0.10.0

- M1-D sửa luồng Tạo phụ đề mở picker khi không tìm thấy resource. Dùng model đi kèm, cache hoặc tải bản Whisper đã pin và kiểm tra SHA-256. Hộp thoại GGML ở trong tùy chọn riêng.
- M1-D nhận dạng clip theo đoạn 5 phút, cộng offset theo tốc độ, hiện tiến độ, nâng giới hạn phụ đề/chữ lên 1800 và SRT UTF-8 lên 6 MiB.
- M1-L thêm xuất Final Cut Pro XML 4 có tầng hình/tiếng và tham chiếu nguồn. Tạo SRT cùng tên khi có phụ đề để nhập thêm vào Premiere.
- M1-H8 đưa thư viện về đầu nội dung khi chuyển tab. M5-B kiểm tra resource Whisper sau đóng gói trên Windows/macOS.

## 2026-11-12 · Editor 0.9.0

- M1-D: bộ cài kèm `ggml-small-q5_1.bin` (whisper.cpp revision `5359861c`, SHA-256 đối chiếu khi build qua `scripts/package-whisper.py`). **Tạo phụ đề** dùng mô hình này không mở hộp thoại; **Dùng mô hình GGML khác…** vẫn cho chọn tệp. FFmpeg nhận mô hình qua hard link trong thư mục tạm.
- M5-A: Proxy tắt mặc định (preference mới `dt-edit-proxy-use`), không tự tạo cho video nặng. Bật nút **Proxy** hoặc chọn **Tạo proxy** mới mã hóa; proxy đã có trong cache được dùng lại qua lệnh `proxy_status` chỉ đọc.
- M1-K: chấm cảnh theo chuyển động có phạt rung, độ nét (gradient luma), độ màu, phơi sáng, năng lượng và đỉnh âm; ngưỡng cắt cảnh thích ứng theo từng clip; cửa sổ 4 giây và `peakMs` để cắt quanh khoảnh khắc mạnh nhất. Highlight mặc định không giới hạn thời lượng (giữ mọi cảnh nổi bật, gộp cửa sổ kề nhau), có ô **Giới hạn thời lượng tối đa** tới 600 giây. Dựng theo âm thanh dài đúng timeline âm thanh, tối đa 600 đoạn, luân phiên đoạn chưa dùng trước khi lặp.
- M1-H6: chỉnh màu có tab **Bánh xe** (Lift/Gamma/Gain + độ sáng), **HSL** sáu dải (đỏ, vàng, xanh lá, lục lam, xanh dương, tím hồng) và đường cong R/G/B 5 điểm. Bánh xe và đường cong kênh dùng chung công thức 17 điểm giữa SVG preview và FFmpeg `curves`; HSL dùng `huesaturation` khi xuất. Timeline vẫn v3, schema SQLite 10.

## 2026-11-12 · Editor 0.8.1

- M5-A sửa mặc định Proxy bật ở lần mở đầu tiên. M5-B bỏ biên dịch JIT cho các bộ lọc PyMatting không dùng trong pipeline xóa nền tích hợp để giảm thời gian khởi động.

## 2026-11-12 · Editor 0.8.0

- M1-K quét toàn đoạn video trên timeline theo khối, giải mã/thu nhỏ bằng CUDA hoặc VideoToolbox khi hỗ trợ, có đường giải mã phần mềm. Giữ nguồn nếu phân tích không đủ, phân bổ thời lượng cho nhiều tệp trước và giữ một hoặc nhiều lớp âm thanh của bản dựng theo nhịp.
- M5-A có proxy H.264 720p tự tạo nền khi xem video nặng và bỏ filter CSS trung tính khỏi trình phát. Render và Xem bản xuất đọc nguồn gốc.
- M1-L có Lưu/Mở tệp dự án `.dtedit` tại thư mục người dùng chọn, giữ timeline và LUT, đối chiếu lại nguồn theo thư viện và grant.
- M5-B đóng gói runtime `rembg` 2.0.87 và model `u2netp` cho Windows x64, Mac arm64 và Mac x86_64. Giữ schema SQLite 10 và timeline v3.

## 2026-11-12 · Editor 0.7.0

- M1-K thêm hai chế độ dựng từ timeline. Highlight xếp hạng cảnh theo chuyển động, độ sáng và âm thanh nguồn. Dựng theo âm thanh chọn điểm cắt gần đỉnh nhịp, có cách chia đều nếu tín hiệu không có nhịp rõ. Hai chế độ tạo dự án riêng, áp chuyển cảnh và keyframe phóng ảnh có thể sửa.
- M1-H6 thêm **Xem bản xuất**, phát tối đa 20 giây từ playhead bằng cùng graph FFmpeg dùng cho MP4, gồm LUT, màu, đảo ngược, hình và tiếng.
- M1-H8 thêm lọc loại media, sidebar nhóm Âm thanh/Chữ và menu chuột phải trên thẻ media và trình phát. Dự án có clip mở thẳng ở chế độ Bản dựng.
- M2-A/M1-J thêm xóa nền trên máy bằng rembg U²-Net và tạo avatar qua HeyGen với keychain và xác nhận native. Không đổi schema.
- M5-B thêm kiểm tra khởi động ứng dụng đóng gói trên runner macOS và giữ kiểm tra hai kiến trúc trong DMG.

## 2026-11-12 · Editor 0.6.0

- Migration 010 thêm `adjustments_json` cho lớp điều chỉnh, bảng `luts` và xóa cache mức âm lượng cũ.
- Chỉnh màu đầy đủ trong Thuộc tính với đường cong tông dùng chung công thức giữa SVG preview và FFmpeg `curves`; LUT .cube qua `lut3d`; lớp điều chỉnh áp lên ảnh ghép bằng các filter có `enable`.
- Chữ có phông, màu hex, viền, nền, căn lề, bóng, hiện/ẩn dần và giãn dòng; FFmpeg chép phông theo kiểu vào thư mục tạm.
- Sao chép/dán thuộc tính (`Ctrl+Shift+C/V`), thay clip bằng media đang chọn, khung hình tĩnh 3 giây, đảo ngược (`reverse`/`areverse`, tối đa 60 giây nguồn), timeline con của compound.
- Multicam đồng bộ theo âm thanh bằng tương quan onset 10 ms; tracking thêm tỷ lệ và góc xoay từ hai nửa vùng.
- Lồng tiếng qua System.Speech (Windows) hoặc `say` (macOS); dịch phụ đề bằng Claude API với key trong keychain.
- Sửa: giải mã PCM để đo mức âm lượng và đồng bộ giờ giữ khoảng trống ở đầu luồng tiếng (`aresample=async=1:first_pts=0`).

## 2026-11-12 · Editor 0.5.0

- M1-H8 thêm menu chuột phải cho clip, tầng và timeline, chọn bằng khung, tab Thông minh và vách chia đổi rộng ba cột.
- M1-H3 thêm tách/khôi phục âm thanh, tay nắm fade, meter âm lượng. Migration 009 cache mức RMS 50 ms.
- M1-H6 thêm tắt clip, compound thu gọn, multicam đổi góc, tốc độ 0,1–10× và speed curve, tracking thành keyframe, dò cảnh, xóa khoảng lặng và marker nhịp. FFmpeg xuất speed curve cho cả hình và tiếng.
- Đổi tốc độ trong Thuộc tính giờ đẩy clip phía sau trên cùng tầng thay vì dời clip sang chỗ trống khác.

## 2026-11-12 · Editor 0.4.1

- M1-H7 sửa bộ lắng nghe kéo tệp từ hệ điều hành. Kéo trong thư viện hoặc kéo tệp vào timeline trống có thể tạo dự án và lưu clip đầu cùng một giao dịch. Cả hai dùng chung quy tắc đặt clip và hít mép.
- M1-H2 thêm điều hướng theo frame và điểm cắt, chuyển focus từ thước tới timeline, kéo vách chia để đổi chiều cao và đưa thư viện công cụ về một hàng cuộn ngang.
- M1-H3 thêm filmstrip 8 khung qua migration 007. Migration 008 lưu khóa/ẩn/tắt tiếng theo tầng. Trạng thái ẩn và tắt tiếng đi cùng snapshot xuất.

## 2026-11-11 · Editor 0.4.0

- M1-H1 thêm hộp thoại nhập nhiều tệp và native drop vào thư viện hoặc timeline. Migration 005 cấp quyền theo tệp đã chọn. Nguồn ở vị trí gốc.
- M1-H2 thêm dồn clip chính, hít mép và liên kết độc lập. Đa chọn, chọn theo hướng, nhóm, clipboard và marker dùng chung lịch sử timeline cho các phép sửa clip.
- M1-H3 thêm waveform PNG qua migration 006, gain dB và fade in/out riêng cho audio.
- M1-H4 và M1-H5 thêm keyframe transform, easing, hòa trộn và qua đen ở mối nối giữa hai clip.
- M1-H6 thêm điểm In/Out. Mỗi lượt xuất giữ phạm vi của timeline tại lúc đưa vào hàng đợi.

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
