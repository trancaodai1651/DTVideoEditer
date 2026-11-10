# Editor và render

## Timeline

[timeline.rs](../../../apps/desktop/src-tauri/src/timeline.rs) định nghĩa `TimelineSnapshot` version 2. Mỗi clip có `assetId`, `startMs`, `endMs` (khoảng đọc từ nguồn) và `positionMs` (vị trí trên timeline). Snapshot này là contract chung của IPC, SQLite và renderer. Native là nơi quyết định hợp lệ khi lưu: đúng track, không chồng lấn, không vượt độ dài nguồn, clip tối thiểu 100 ms, ảnh tối đa 10 phút, mỗi track tối đa 200 clip.

[timeline.ts](../../../apps/desktop/src/timeline.ts) chứa các phép sửa thuần ở frontend: thêm, di chuyển, trim hai đầu, split, snap và lịch sử undo/redo 100 bước. [TimelineEditor](../../../apps/desktop/src/TimelineEditor.tsx) hiển thị thước, playhead, tay nắm trim và nhận kéo thả từ gallery. Mỗi thao tác hoàn tất gửi nguyên snapshot qua `save_timeline`, các lần lưu chạy tuần tự. Playhead đưa preview tới đúng khung hình nguồn của clip bên dưới.

Phím tắt: `S` tách tại playhead, `Delete` gỡ clip, mũi tên dịch 100 ms (giữ Shift 1 giây), `Ctrl+Z` và `Ctrl+Y`.

## Render

[render.rs](../../../apps/desktop/src-tauri/src/render.rs) dựng một lệnh FFmpeg từ snapshot và media đã qua kiểm tra grant.

- Khung hình lấy theo clip hình đầu tiên, làm chẵn, tối đa 3840 px, 30 fps. Clip khác kích thước được scale và pad đen.
- Khoảng trống trên track video là nền đen, trên track âm thanh là im lặng. Âm thanh của clip video được trộn với track âm thanh.
- Đầu ra H.264 (CRF 20, veryfast) và AAC 192 kb/s, `+faststart`.
- FFmpeg ghi vào `<tên>.mp4.part` rồi đổi tên khi xong, nên tệp đích chỉ xuất hiện khi render trọn vẹn. Hủy hoặc lỗi xóa tệp tạm.

`render_jobs` lưu snapshot của lượt xuất, đường dẫn đích từ hộp thoại lưu native, tiến độ phần nghìn và lỗi. Mỗi lúc chạy một lượt. Thử lại dùng đúng snapshot và đích đã lưu. Lượt đang chạy khi ứng dụng đóng được đánh dấu lỗi lúc mở lại.

## Giới hạn hiện tại

Chưa có phát lại toàn timeline trong preview, chưa đọc rotation metadata, chưa có preset kích thước. Lệnh FFmpeg bị chặn ở 30.000 ký tự nên timeline rất nhiều clip cần chia đoạn (M5). Các mục này thuộc M1-C và M5 trong [backlog](../TASK_BACKLOG.md).

Kiểm tra bằng `pnpm test`, `pnpm test:native` và `pnpm test:media`.
