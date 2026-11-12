# Changelog

Snapshot: 2026-11-12/EDITOR-060

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
