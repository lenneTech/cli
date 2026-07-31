# Performance Reviewer Memory

<!-- Index of all saved memories for this agent. Max 200 lines. -->

- [TypeScript 6 Build Time](ts6_build_time.md) — TS6 pure compile is ~3s; full `npm run build` is 62s due to test suite, not tsc itself
- [Gluegun filesystem is sync](gluegun_filesystem_sync.md) — filesystem.read/write/exists are synchronous (fs-jetpack wrappers); expected pattern in this CLI codebase
- [mongosh is a separate install from mongod](mongosh_not_installed.md) — mongosh-backed cleanup paths can silently no-op; mongod runs on Kai's box but mongosh is absent
- [CLI repo perf reviews are static-only](cli_repo_static_only.md) — reviewing the lt CLI itself = static diff analysis; no server/bundle/DB, k6 + Lighthouse N/A
- [CLI perf cost calibration](cli_perf_calibration.md) — measured: warm `lt` startup ~715ms, jsonc-parser require ~2.3ms; gluegun eager-requires all 110 commands; avoided writes are the lever, not CPU
- [Sibling build dirs need 3 matchers](sibling_build_dir_matchers.md) — a new `.nuxt-*`/`.output-*` dir must be added to gitignore, GENERATED_PATHS and watcherExclude; all three match exact segments
