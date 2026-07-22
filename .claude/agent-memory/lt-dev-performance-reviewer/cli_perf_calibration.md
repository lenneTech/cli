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

**How to apply:** before flagging "extra regex allocation" or recommending hoisting a constant out of a patcher, check the call-site multiplicity first. The `lt dev` patchers (`autoPatch` → `patchApiConfig`/`patchNuxtConfig`/`patchPlaywrightConfig`) run **once per command**, over at most 3 config files; the only multiplier is `lt dev test --shard N` (N stacks, `autoShardCount()` caps auto-sizing at 8), which still means single-digit invocations against a run that boots N full stacks. Micro-optimising there is premature — say so plainly instead of inventing a finding.
