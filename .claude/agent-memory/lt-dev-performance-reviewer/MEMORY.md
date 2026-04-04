# Performance Reviewer Memory

<!-- Index of all saved memories for this agent. Max 200 lines. -->

- [TypeScript 6 Build Time](ts6_build_time.md) — TS6 pure compile is ~3s; full `npm run build` is 62s due to test suite, not tsc itself
- [Gluegun filesystem is sync](gluegun_filesystem_sync.md) — filesystem.read/write/exists are synchronous (fs-jetpack wrappers); expected pattern in this CLI codebase
