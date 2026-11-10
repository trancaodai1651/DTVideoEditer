---
name: studio-handoff
description: Hand off completed DT_Edit implementation work between Codex and Claude Code using the repository memory.
---

# Studio handoff

Start with `pnpm context:summary` from the project root. Route to the relevant file in `docs/memory/modules` and inspect the actual Git diff.

At the end, align `CURRENT_STATE.md`, `CHANGELOG.md` and `HANDOFF.md` to the same snapshot ID. Record executed checks separately from pending checks, link any migration, and identify the next task by its ID in `TASK_BACKLOG.md`. Record the actual Git revision if present. Run `pnpm context:check` and `pnpm skills:check`.
