# Skills và workflows

Developer skills nằm ở [catalog](../../../skills/catalog). [Script đồng bộ](../../../scripts/sync-skills.mjs) xác thực tên và frontmatter, ghi các bản sao vật lý vào `.agents/skills` và `.claude/skills`, ghi checksum về [lock](../../../skills/sync-lock.json). Sync sẽ báo xung đột nếu bản sao có chỉnh sửa cục bộ hoặc chưa có provenance. `pnpm skills:check` chỉ đọc.

Runtime workflow M3 dùng manifest riêng với version, input/output schema, permissions, audit và approval gates. Registry sẽ chỉ chấp nhận step types đã hỗ trợ. Các file Markdown developer skill phục vụ Codex/Claude. [Backlog M3-D](../TASK_BACKLOG.md)
