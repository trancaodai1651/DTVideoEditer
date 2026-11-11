# Persistence

[Store](../../../apps/desktop/src-tauri/src/store.rs) dùng SQLite WAL và giao dịch. [001](../../../apps/desktop/src-tauri/migrations/001_library.sql) thêm thư viện, [002](../../../apps/desktop/src-tauri/migrations/002_timeline_edit_points.sql) thêm edit points và render, [003](../../../apps/desktop/src-tauri/migrations/003_publishing.sql) thêm publishing, [004](../../../apps/desktop/src-tauri/migrations/004_editor_layers.sql) thêm tầng, thuộc tính và kho mẫu, [005](../../../apps/desktop/src-tauri/migrations/005_file_grants.sql) thêm quyền từng tệp, [006](../../../apps/desktop/src-tauri/migrations/006_waveforms.sql) thêm cache waveform. `user_version = 6`. Dựng lại bảng với foreign keys tắt và kiểm tra `foreign_key_check` trước khi bật lại. Debug dùng `STUDIO_DEV_DATA_DIR` để tách dữ liệu.

Clip lưu `start_ms`, `end_ms`, `position_ms`, `layer` và `look_json`. Timeline schema 3 có danh sách chữ và tỷ lệ khung. `editor_templates` giữ nhịp cắt theo mili giây và tỷ lệ. Dự án cũ lên tầng 0 với thuộc tính mặc định. Thu hồi grant cascade dữ liệu index và clip tham chiếu. Snapshot version 2 trong hàng đợi vẫn đọc được.

Lưu timeline thay toàn bộ clip của dự án bằng một snapshot đã kiểm tra trong một giao dịch. SQL của publishing nằm ở [records.rs](../../../apps/desktop/src-tauri/src/publish/records.rs).

| Migration tiếp theo | Entities theo milestone |
| --- | --- |
| M2 | `ai_providers`, `generation_sessions`, `script_versions`, `voice_jobs` |
| M3 | `asset_tags`, `classification_rules`, `operation_plans`, `operation_logs`, `workflow_runs`, `installed_skills` |
| M4-C | `publishing_campaigns`, `publishing_targets`, lịch đăng |
| M5 | Backup có version, kiểm thử restore và nâng cấp nhiều phiên bản |

Migrations mới cần kiểm thử mở DB phiên bản trước và giữ nguyên dữ liệu trong phạm vi grant. [Smoke tests](../../../apps/desktop/src-tauri/src/smoke.rs)
