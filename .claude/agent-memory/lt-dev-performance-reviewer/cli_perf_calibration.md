---
name: cli-perf-calibration
description: Measured cost constants for lt CLI file-patcher work (readFileSync ~30us, writeFileSync ~100us, 1KB regex-replace ~7us) — use to avoid manufacturing CPU findings
metadata:
  type: project
---

Measured on Kai's machine (macOS/APFS, Node in-repo) while reviewing `dev-patches.ts`. Use these to calibrate whether a CPU finding in this CLI is real:

| Operation | Cost |
|---|---|
| `readFileSync` of a ~5 KB config | ~30-48 us |
| `writeFileSync` of a ~5 KB config | ~97-103 us |
| Full-string `.replace(/\s+/g,' ')` over ~1.1 KB | ~3.6 us |
| Two-pass `normalise()` (quotes + whitespace + trim) over ~1.1 KB | ~7.3 us |
| One anchored regex pass over a whole ~5 KB file | ~0.4 us |
| Whole-file concat + string `!==` compare (~5 KB) | ~0.05 us |

**Why:** a `writeFileSync` costs ~14x a two-pass regex normalise of a 1 KB block, and ~250x a whole-file string compare. So in this codebase **the dominant lever is avoiding a file write, not shaving regex passes** — and an avoided write also removes a spurious mtime bump, which is what `git status`, file watchers, and `lt ticket stop`'s dirty-source guard ([[cli-repo-static-only]]) actually observe. String-level regex is cheap enough that adding several microseconds to a once-per-command patcher is not a finding.

## Startup budget (measured 2026-07-31, compiled `build/`, 110 command files)

| Thing | Cost |
|---|---|
| Total warm `lt --version --compiled-build` | **~715 ms** (median of 10) |
| `require` of one typical command module (internal imports only) | ~0.5 ms |
| `require` of `jsonc-parser` (87 KB UMD, zero deps) | ~2.3 ms |

**Gluegun eagerly `require`s EVERY command file at startup** — `loaders/command-loader.js#loadCommandFromFile` → `module-loader.js#loadModule` → `require(file)`. So any top-level third-party import in a command module (or in a `src/lib/` module it top-level-imports) is paid on *every* `lt` invocation, including `lt --version`.

**The repo's own convention is to lazy-require heavyweight third-party deps inside the function body** — `open`, `js-yaml`, `playwright-core`, `ts-morph` are all `await import(...)`/`require(...)`d at call time. Across all 110 command files the only third-party top-level imports are `gluegun` (78), `js-sha256` (2), `ejs` (1), `@aws-sdk/client-s3` (1). A new top-level third-party import is a convention deviation worth flagging even when the absolute cost is ~0.3% of startup, because the fix is one line.

**How to apply:** before flagging "extra regex allocation" or recommending hoisting a constant out of a patcher, check the call-site multiplicity first. The `lt dev` patchers (`autoPatch` → `patchApiConfig`/`patchNuxtConfig`/`patchPlaywrightConfig`) run **once per command**, over at most 3 config files; the only multiplier is `lt dev test --shard N` (N stacks, `autoShardCount()` caps auto-sizing at 8), which still means single-digit invocations against a run that boots N full stacks. Micro-optimising there is premature — say so plainly instead of inventing a finding.

## Scaffold-time key walks (measured 2026-08-24, reviewing `hoist-workspace-pnpm-config.ts`)

| Thing | Cost |
|---|---|
| `Object.entries()` walk + per-key `JSON.stringify(a)===JSON.stringify(b)` over 20 keys | ~6 us |
| same over 50 keys | ~11 us |
| same over 200 keys | ~41 us |

Realistic input for the workspace hoist is 2 sub-projects x a few dozen `overrides` entries, i.e. **~10 us total** inside a command that clones two git repos and runs `pnpm install`. **How to apply:** do not raise a complexity/allocation finding for per-key `JSON.stringify` at scaffold scale — grade it noise and spend the review on the *semantics* of the comparison instead (key order, `false` vs YAML-1.2 `no`, circular anchors).
