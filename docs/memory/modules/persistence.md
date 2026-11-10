# Persistence

[Store](../../../apps/desktop/src-tauri/src/store.rs) dùng một connection SQLite trong mutex, WAL, foreign keys và transactions. Ba migration chạy lần lượt trong một giao dịch và đưa `user_version` lên 3: [001](../../../apps/desktop/src-tauri/migrations/001_library.sql) thư viện, [002](../../../apps/desktop/src-tauri/migrations/002_timeline_edit_points.sql) edit points và render, [003](../../../apps/desktop/src-tauri/migrations/003_publishing.sql) publishing. Foreign keys tắt trong lúc migrate để dựng lại bảng mà không cascade, sau đó `foreign_key_check` phải sạch rồi mới bật lại. App mở cơ sở dữ liệu ở thư mục app data, có `STUDIO_DEV_DATA_DIR` riêng cho debug.

Schema hiện có `projects`, `timelines`, `timeline_tracks`, `timeline_clips`, `render_jobs`, `assets`, `asset_metadata`, `folder_grants`, `connected_accounts` và `publishing_jobs`. Clip lưu `start_ms`, `end_ms`, `position_ms`, và `timelines.schema_version` bằng 2. Dự án schema 1 được chuyển thành các clip phát trọn nguồn nối tiếp nhau, ảnh dài 3 giây. Thu hồi grant cascade dữ liệu index và clip liên quan, còn bài đăng trỏ tới asset đó mất tham chiếu media.

Lưu timeline thay toàn bộ clip của dự án bằng một snapshot đã kiểm tra trong một giao dịch. SQL của publishing nằm ở [records.rs](../../../apps/desktop/src-tauri/src/publish/records.rs).

| Migration tiếp theo | Entities theo milestone |
| --- | --- |
| M2 | `ai_providers`, `generation_sessions`, `script_versions`, `voice_jobs` |
| M3 | `asset_tags`, `classification_rules`, `operation_plans`, `operation_logs`, `workflow_runs`, `installed_skills` |
| M4-C | `publishing_campaigns`, `publishing_targets`, lịch đăng |
| M5 | Backup có version, kiểm thử restore và nâng cấp nhiều phiên bản |

Migrations mới cần kiểm thử mở DB phiên bản trước và giữ nguyên dữ liệu trong phạm vi grant. [Smoke tests](../../../apps/desktop/src-tauri/src/smoke.rs)
