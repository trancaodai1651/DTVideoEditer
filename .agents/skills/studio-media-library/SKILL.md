---
name: studio-media-library
description: Modify DT_Edit folder grants, metadata indexing, thumbnails, SQLite asset records or local media playback.
---

# Studio media library

Open `docs/memory/modules/media-library.md` and the relevant section of `docs/memory/SECURITY.md` from the project root. Follow the Rust path from the native folder picker to the persisted grant. Webview inputs use IDs and must resolve through the grant before any file read.

For scanner changes, verify an ordinary file, a broken media file, an out-of-scope path and a repeat scan. Keep the original file unchanged. For preview changes, verify an ID resolved through SQLite, an HTTP byte range, and access after revocation. `pnpm test:native` uses temporary data. `pnpm test:media` exercises real FFprobe and FFmpeg when available.
