# Kiến trúc

## Luồng đã triển khai

```text
React App → desktop.ts → Tauri commands
                          ├─ native picker → folder_grants
                          ├─ library → MediaProbe → FFprobe / FFmpeg
                          ├─ Store → SQLite migration / assets / projects / tracks / jobs
                          ├─ render → TimelineSnapshot + media đã kiểm tra grant → FFmpeg → MP4
                          └─ publish → keychain + adapter theo nền tảng → HTTPS API

WebView video / audio / img → studio-media → asset ID → grant + path guard → bytes
```

Frontend giữ UI state, lịch sử sửa timeline và gọi IPC có kiểu. Native quản lý quyền, giới hạn scan, xác minh đường dẫn, chạy tiến trình và điều phối giao dịch. Store giữ SQL và ánh xạ row. Thumbnail dùng JPEG nén lưu SQLite. Preview dùng media gốc theo phạm vi đọc giới hạn.

## Ranh giới khi mở rộng

| Module | Contract dự kiến | Quy tắc phụ thuộc |
| --- | --- | --- |
| Library | `AssetIndexer`, `MediaProbe`, `Classifier` | Kiểm tra grant trong native trước mỗi lần đọc. Classifier nhận dữ liệu tối thiểu theo opt-in. |
| Editor và render | `TimelineSnapshot`, `render::plan` và `render::run` đã có | Renderer nhận snapshot timeline JSON có version cùng media resolver. Preview UI và render dùng cùng semantics trim, speed và track. |
| AI và speech | `ScriptProvider`, `SpeechProvider` | Dùng adapter và schema. Provider không nhận quyền truy cập toàn bộ thư viện. |
| Secrets và jobs | `SecretStore` đã có, `JobQueue` chung còn chờ | Keychain giữ secrets. Jobs ghi tiến độ, trạng thái, khóa idempotency và lỗi vào SQLite. `render_jobs` và `publishing_jobs` hiện tự quản worker của mình. |
| Skills và workflow | `SkillRegistry`, `WorkflowExecutor` | Registry xác thực manifest. Executor chỉ dùng step được cho phép, duy trì approval gate và audit. |
| Publishing và lịch | `Publisher` cùng bốn adapter đã có, lịch còn chờ | Provider xác thực riêng từng target. Worker nhận approval rõ ràng trước mọi lần gửi. |

`MediaProbe` và `SecretStore` là Rust trait. Typed IPC và SQLite schema của phạm vi hiện tại có source. Các contract mở rộng là thiết kế theo milestone và sẽ được hiện thực cùng caller và kiểm thử.
