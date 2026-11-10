# AI Video Studio

Desktop editor local-first dành cho Windows và macOS. Thư viện media và dự án lưu trên máy. Tích hợp AI, TTS, workflow và publishing theo các mốc trong backlog.

## Điểm vào

| Mục | Vị trí |
| --- | --- |
| Cài đặt và demo | [README](../../README.md) |
| Trạng thái | [CURRENT_STATE](CURRENT_STATE.md) |
| Bàn giao | [HANDOFF](HANDOFF.md) |
| Task và acceptance | [TASK_BACKLOG](TASK_BACKLOG.md) |
| Tính năng theo source | [FEATURE_MAP](FEATURE_MAP.md) |
| Kiến trúc và hướng mở rộng | [ARCHITECTURE](ARCHITECTURE.md) |
| Quyền và ranh giới tin cậy | [SECURITY](SECURITY.md) |
| Tích hợp ngoài máy | [API_INTEGRATIONS](API_INTEGRATIONS.md) |
| ADR và lịch sử | [DECISIONS](DECISIONS.md) · [CHANGELOG](CHANGELOG.md) |

## Mở theo tác vụ

- Giao diện, typed IPC và kiểm tra runtime. [Desktop](modules/desktop.md)
- Quyền thư mục, scan, FFprobe, FFmpeg và xem trước. [Media library](modules/media-library.md)
- Migration, project và timeline. [Persistence](modules/persistence.md)
- Trim, split, undo/redo và xuất MP4. [Editor và render](modules/editor.md)
- Tài khoản mạng xã hội, bản nháp, duyệt và đăng bài. [Publishing](modules/publishing.md)
- Catalog của agent và kế hoạch runtime skills. [Workflows](modules/workflows.md)

Git lưu lịch sử source. Bộ nhớ Markdown ghi trạng thái dự án và các quyết định. SQLite lưu dữ liệu ứng dụng của người dùng. Ghi kết quả kiểm chứng và task tiếp theo trong handoff sau mỗi phiên.
