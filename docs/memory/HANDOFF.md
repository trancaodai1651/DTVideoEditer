# Bàn giao

Snapshot: 2026-11-10/M1B-M4

**Mục tiêu** hoàn thành M1-B (trim, split, xuất MP4) và mở phần API đăng bài cho Threads, Facebook Page, Instagram, TikTok theo yêu cầu ngày 10/11/2026. Repo chưa có code đăng Threads nào trước phiên này, nên cả bốn adapter được viết mới.

**Source** timeline ở [timeline.rs](../../apps/desktop/src-tauri/src/timeline.rs), [timeline.ts](../../apps/desktop/src/timeline.ts) và [TimelineEditor](../../apps/desktop/src/TimelineEditor.tsx). Render ở [render.rs](../../apps/desktop/src-tauri/src/render.rs). Publishing ở [publish](../../apps/desktop/src-tauri/src/publish/mod.rs) và [PublishPanel](../../apps/desktop/src/PublishPanel.tsx). [Migration 002](../../apps/desktop/src-tauri/migrations/002_timeline_edit_points.sql) và [003](../../apps/desktop/src-tauri/migrations/003_publishing.sql) đưa schema lên version 3. Mô tả ở [editor](modules/editor.md) và [publishing](modules/publishing.md).

**Đã kiểm tra trên Windows 11 Pro**

- `pnpm lint`, `pnpm typecheck`, `cargo fmt --check`.
- `pnpm test`: 9 test, gồm 6 test cho phép sửa timeline (thêm, trim, split, di chuyển, undo/redo, snapshot).
- `pnpm test:native`: 17 test. Có migration từ DB schema 1 giữ nguyên clip, lưu và mở lại edit points, kế hoạch FFmpeg, và 8 test publishing chạy với máy chủ HTTP cục bộ cho cả bốn nền tảng (hình dạng request, upload theo chunk, thử lại không đăng trùng, token không nằm trong tệp SQLite, URL tải lên ngoài tên miền bị chặn).
- `pnpm test:media`: FFmpeg 9.0.2 thật render timeline có trim, split, khoảng trống, ảnh tĩnh và audio lệch. FFprobe đo MP4 dài 5,5 giây (sai số cho phép 0,1 giây), H.264 640×360 30 fps, AAC. Hủy không để lại tệp, ghi đè tệp nguồn bị từ chối.
- Test keychain thật (`cargo test real_keychain -- --ignored`): lưu, đọc, xóa một entry thử trong Windows Credential Manager.
- `pnpm tauri build --no-bundle --ci` tạo `ai-video-studio.exe`.
- `pnpm tauri dev --no-watch` với `STUDIO_DEV_DATA_DIR` riêng: ứng dụng khởi động và chạy ổn định, cơ sở dữ liệu mới có `user_version = 3` cùng đủ mười bảng. Không thao tác gì trong cửa sổ.
- Giao diện chạy trong trình duyệt với IPC giả lập tạm thời: kéo tay nắm trim, kéo di chuyển có snap, tách, hoàn tác, `Ctrl+Y`, thả media vào track, tiến độ xuất, và luồng kết nối, nháp, duyệt, danh sách bài. Harness này đã được gỡ khỏi repo.

**Chưa kiểm tra**

- Chưa thao tác trong cửa sổ Tauri thật: hộp thoại lưu MP4, hộp thoại duyệt đăng, kéo thả HTML5 trong WebView2 và xuất từ giao diện.
- Chưa có request nào tới API thật của Threads, Facebook, Instagram hay TikTok, vì chưa có token. Hành vi thật có thể khác tài liệu ở vài điểm đã ghi trong [tích hợp API](API_INTEGRATIONS.md).
- macOS, Windows 10 và CI từ xa.

**Giới hạn** kết nối bằng access token dán tay, chưa có OAuth. Chưa có lịch đăng, campaign, retry tự động. Timeline chưa phát lại toàn bộ trong preview. Render dùng một lệnh FFmpeg nên timeline rất nhiều clip sẽ bị từ chối.

**Git** toàn bộ công việc tới snapshot này nằm trong commit đầu tiên `da51781` trên nhánh `master`. Chưa push và chưa có remote.

**Task tiếp theo** M4-B. Lấy token thật cho từng nền tảng rồi chạy live test theo bảng trong [tích hợp API](API_INTEGRATIONS.md), bắt đầu từ bài chữ Threads và Facebook vì ít điều kiện nhất. Sau đó quyết định nơi giữ app secret để làm OAuth. Việc song song không cần token: smoke M1-B trong cửa sổ Tauri bằng `pnpm demo:media`, rồi M1-C. [Tiêu chí](TASK_BACKLOG.md)
