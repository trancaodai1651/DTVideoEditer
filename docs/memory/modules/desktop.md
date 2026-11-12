# Desktop

[App](../../../apps/desktop/src/App.tsx) quản lý navigation, trạng thái lựa chọn, yêu cầu scan và project picker. [MediaPanels](../../../apps/desktop/src/MediaPanels.tsx) hiển thị gallery và preview. [TimelineEditor](../../../apps/desktop/src/TimelineEditor.tsx) là trình biên tập timeline và danh sách lượt xuất, [PublishPanel](../../../apps/desktop/src/PublishPanel.tsx) là màn hình đăng bài. App giữ lịch sử undo/redo và hàng đợi lưu timeline. [vi.ts](../../../apps/desktop/src/vi.ts) gom chuỗi UI và định dạng theo locale tiếng Việt.

[desktop.ts](../../../apps/desktop/src/desktop.ts) định kiểu DTO và là cổng gọi IPC. [main.rs](../../../apps/desktop/src-tauri/src/main.rs) cài command handlers, app data và media scheme. Frontend chạy riêng bằng Vite để phát triển layout. Nghiệp vụ media cần Tauri. Cửa sổ bật `dragDropEnabled` để Tauri nhận tệp thả từ hệ điều hành. Kéo trong editor dùng pointer capture.

Native drop của cửa sổ `main` tới `on_window_event` vì WebView là nội dung chính của cửa sổ. IPC tùy chỉnh gửi trạng thái rê/thả, tọa độ và kết quả cấp quyền. Frontend đổi tọa độ vật lý sang CSS theo `devicePixelRatio` và giữ dự án, tầng, vị trí lúc thả.

Kiểm tra bằng `pnpm lint`, `pnpm typecheck`, `pnpm build` và luồng demo ở [README](../../../README.md).
