# Media library

1. `pick_folder` nhận đường dẫn từ dialog native và lưu root canonical. `scan_folder` nhận folder ID.
2. [library.rs](../../../apps/desktop/src-tauri/src/library.rs) giới hạn 600 media, 10.000 entries và sâu 12 cấp. Size + mtime bỏ qua tệp đã đọc. Scan đầy đủ đánh dấu tệp thiếu. Scan một phần giữ các bản ghi cũ để tránh mất trạng thái ngoài giới hạn.
3. [probe.rs](../../../apps/desktop/src-tauri/src/probe.rs) chạy FFprobe và FFmpeg, trả duration, kích thước, codec, frame rate và JPEG. Hỗ trợ MP4/MOV/M4A, WebM/MKV, MP3/WAV/FLAC/OGG/Opus, JPG/PNG/WebP. Danh sách này là định dạng index. Khả năng phát phụ thuộc WebView và codec.
4. [preview.rs](../../../apps/desktop/src-tauri/src/preview.rs) tra asset ID và grant. Range tối đa 4 MiB mỗi response, request toàn tệp tối đa 24 MiB. Preview lớn cần WebView gửi Range.

Quét do người dùng yêu cầu. Cancellation, watcher, ignore patterns, hash, rules và tìm kiếm thuộc M3. [Bảo mật](../SECURITY.md) · [Backlog](../TASK_BACKLOG.md)
