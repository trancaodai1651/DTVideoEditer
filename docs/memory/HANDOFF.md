# Bàn giao

Snapshot: 2026-11-10/EDITOR-020

**Mục tiêu** 0.2.0 triển khai M1-C, M1-E và phần đóng gói M5-B. Đã quan sát CapCut 9.7.1 trên Windows, gồm trang mẫu và bố cục thư viện, player, thuộc tính, timeline trong dự án trống.

**Source** [Editor](../../apps/desktop/src/TimelineEditor.tsx), [Inspector](../../apps/desktop/src/ClipInspector.tsx), [Kho mẫu](../../apps/desktop/src/TemplateLibrary.tsx), [Hàng đợi](../../apps/desktop/src/ExportQueue.tsx) và [Renderer](../../apps/desktop/src-tauri/src/render.rs). [Migration 004](../../apps/desktop/src-tauri/migrations/004_editor_layers.sql) nâng cơ sở dữ liệu lên version 4. Snapshot timeline là version 3, các lượt xuất version 2 vẫn đọc được.

**Đã kiểm tra trên Windows 11**

- Lint, TypeScript và 11 test Node. Có test cho đặt clip trên nhiều tầng, chữ và dựng đúng thời lượng các đoạn theo mẫu.
- 18 test Rust mặc định. Có migration từ DB schema 1, bảo toàn việc chờ qua restart, trùng tên đích và thử lại lượt xuất gián đoạn.
- 3 test FFmpeg thật. Fixture cắt đen/trắng được nhận ra thành hai đoạn 1 giây. FFmpeg ghép hai tầng video, hai tầng âm thanh và chữ tiếng Việt. Test đọc pixel để kiểm tra overlay đã chỉnh màu và chữ. Kiểm tra HTTP Range phát MP4 đã xuất.
- Đã mở editor 0.2.0 trong cửa sổ Tauri thật với DB kiểm thử riêng. NSIS Windows x64 đã tạo bằng lệnh pnpm tauri build --bundles nsis --ci. Bộ cài dùng FFmpeg/FFprobe cài riêng và chưa ký.
- GitHub Actions build thành công Windows x64 và macOS Universal ở commit `583b5aa`. `lipo` xác nhận arm64 và x86_64, `hdiutil verify` kiểm tra DMG. Đã tải và đối chiếu SHA-256 của archive, rồi giải nén DMG vào `apps/desktop/src-tauri/target/verified-installers/v0.2.0`. DMG ký ad hoc. [Bộ cài](https://github.com/trancaodai1651/DTVideoEditer/actions/runs/42792075988) · [CI](https://github.com/trancaodai1651/DTVideoEditer/actions/runs/42792074443)

**Giới hạn** preview bản dựng hiện theo playhead. Phát đủ hình và tiếng đã trộn dùng tệp xuất. Phân tích video mẫu dò điểm cắt và tỷ lệ khung. Chữ, preset, chuyển cảnh và các lớp nhạc/SFX/voice cần người dùng gán. Tương thích codec, phát trên máy Mac và notarization cần kiểm thử tiếp. Publishing giữ trạng thái thử bằng máy chủ giả lập.

**Git** nền trước phiên là `b5aa997`. Tag `v0.2.0` trỏ tới commit ứng dụng `204f69b`. Hai sửa đổi CI sau tag chuẩn hóa LF cho lock skills và xác minh DMG. Nhánh `master` được push vào [DTVideoEditer](https://github.com/trancaodai1651/DTVideoEditer).

**Task tiếp theo** M1-F. Mở rộng nhận dạng chữ, chuyển động, chuyển cảnh và âm thanh trên video tham chiếu có bộ dữ liệu kiểm thử. [Tiêu chí](TASK_BACKLOG.md) · [Editor](modules/editor.md) · [Workflow bộ cài](../../.github/workflows/installers.yml)
