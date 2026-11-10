# Editor và render

## Timeline

[timeline.rs](../../../apps/desktop/src-tauri/src/timeline.rs) định nghĩa `TimelineSnapshot` version 3 với `layer`, `look`, lớp chữ và tỷ lệ khung. Clip giữ điểm in/out và vị trí theo mili giây. Các tầng cùng nhóm có thể chồng thời gian. Mỗi tầng media tối đa 200 clip và mỗi nhóm tối đa 12 tầng. Snapshot version 2 dùng thuộc tính mặc định.

[timeline.ts](../../../apps/desktop/src/timeline.ts) chứa các phép sửa ở frontend và undo/redo 100 bước. [TimelineEditor](../../../apps/desktop/src/TimelineEditor.tsx) nhận media theo tầng. [ClipInspector](../../../apps/desktop/src/ClipInspector.tsx) chỉnh lớp chữ, màu, vị trí và hiệu ứng. `save_timeline` ghi snapshot trong giao dịch. Preview hiển thị tổ hợp hình/chữ tại playhead.

Phím tắt: `S` tách tại playhead, `Delete` gỡ clip, mũi tên dịch 100 ms (giữ Shift 1 giây), `Ctrl+Z` và `Ctrl+Y`.

## Render

[render.rs](../../../apps/desktop/src-tauri/src/render.rs) dựng một lệnh FFmpeg từ snapshot và media đã qua kiểm tra grant.

- 30 fps với kích thước nguồn hoặc khung 1080p ngang, dọc, vuông. Các tầng hình phủ theo thứ tự, hỗ trợ scale, vị trí, độ đục, màu, fade và trượt. Chữ đi qua `drawtext` bằng tệp UTF-8 tạm với expansion tắt.
- Âm thanh nguồn video và nhiều tầng WAV/MP3 được trộn với volume, fade và limiter. Khoảng trống dùng nền đen và im lặng.
- Đầu ra H.264 (CRF 20, veryfast) và AAC 192 kb/s, `+faststart`.
- FFmpeg ghi vào tệp tạm riêng trong thư mục đích và hoàn tất bằng thao tác chống ghi đè. Hủy hoặc lỗi dọn tệp tạm.

`render_jobs` lưu snapshot, đích đã chọn trong hộp thoại native, tiến độ và lỗi. [ExportQueue](../../../apps/desktop/src/ExportQueue.tsx) chạy FIFO giữa các dự án. Lượt chờ giữ qua restart. Lượt bị gián đoạn được đánh dấu lỗi. Thử lại giữ snapshot và đích đã lưu.

## Kho mẫu

[templates.rs](../../../apps/desktop/src-tauri/src/templates.rs) dùng FFmpeg dò điểm cắt video trong grant, tối đa 3 phút và 24 đoạn. [TemplateLibrary](../../../apps/desktop/src/TemplateLibrary.tsx) cho phép gán media theo cảnh, nhạc nền/SFX/voice theo tầng và cấu hình chữ/màu/fade/trượt. Dự án mới và snapshot được tạo trong cùng một giao dịch. Video tham chiếu chỉ cung cấp timing và khung hình.

## Giới hạn hiện tại

Preview tương tác là khung hình, bản MP4 có playback và audio hoàn chỉnh. Lệnh FFmpeg bị chặn ở 30.000 ký tự nên timeline rất nhiều clip cần chia đoạn. Nhận dạng nội dung chữ, hiệu ứng và tách các lớp âm thanh của bản mẫu thuộc M1-F. [Backlog](../TASK_BACKLOG.md)

Kiểm tra bằng `pnpm test`, `pnpm test:native` và `pnpm test:media`.
