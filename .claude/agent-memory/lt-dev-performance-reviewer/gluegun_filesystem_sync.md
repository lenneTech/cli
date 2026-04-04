---
name: Gluegun filesystem methods are synchronous
description: filesystem.read/write/exists are synchronous fs-jetpack wrappers — this is intentional and consistent across the entire CLI codebase
type: project
---

Gluegun's `toolbox.filesystem` delegates to `fs-jetpack`, whose `read()`, `write()`, and `exists()` are synchronous operations (no Promise return type). This is the established, consistent pattern across all extensions in this codebase (server.ts, history.ts, tools.ts, plugin-utils.ts, etc.).

**Why:** CLI tools execute sequentially in a single user session; sync I/O is acceptable and avoids callback complexity for small config files.

**How to apply:** Do not flag `filesystem.read/write/exists` as sync-in-async anti-patterns in this codebase — they are intentional and consistent. Flag only raw Node.js `fs.*Sync` calls if they appear in hot paths or loops.
