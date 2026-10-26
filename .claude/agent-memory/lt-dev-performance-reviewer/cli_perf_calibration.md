---
name: cli-perf-calibration
description: Measured cost constants for lt CLI (file I/O, regex, startup incl. eager axios ~100ms, bounded log tail, CLAUDE.md rescue) — use to avoid manufacturing CPU findings
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

**The repo's own convention is to lazy-require heavyweight third-party deps inside the function body** — `open`, `playwright-core` are `await import(...)`/`require(...)`d at call time. A new top-level third-party import is a convention deviation, but under a Critical/High reporting bar it only counts when it measurably moves startup.

**Correction (measured 2026-10-26):** `ts-morph` is NOT lazy. `commands/server/add-property.ts` has imported it at top level since before 1.51.5 (a MULTI-LINE `import {\n …\n} from 'ts-morph'`, which a single-line `grep "^import .* from 'ts-morph'"` misses). So `lt --version` already pays it. It costs ~103 ms ON TOP of `typescript` (~85 ms), because `@ts-morph/common/dist/typescript.js` is its own bundled 9 MB TypeScript copy, not the `typescript` package. `js-yaml` is top-level in `extensions/config.ts` too. Verify "already loaded" with a `Module._load` trace (`node -r trace.js bin/lt --version --compiled-build`), not with grep. A/B against HEAD: `git archive HEAD | tar -x -C <scratch>/head`, symlink node_modules, `npx tsc -p tsconfig.json --outDir <scratch>/head/build` (emits despite type errors), time both `--version` 12x. `semver` became an every-run import with the convert-esm change set (2026-10-26, via `extensions/server.ts` → `align-framework-pins`/`vendor-upstream-ref`): ~9 ms warm, not measurable in the A/B. See [[tsmorph-two-programs-convert-esm]].

**How to apply:** before flagging "extra regex allocation" or recommending hoisting a constant out of a patcher, check the call-site multiplicity first. The `lt dev` patchers (`autoPatch` → `patchApiConfig`/`patchNuxtConfig`/`patchPlaywrightConfig`) run **once per command**, over at most 3 config files; the only multiplier is `lt dev test --shard N` (N stacks, `autoShardCount()` caps auto-sizing at 8), which still means single-digit invocations against a run that boots N full stacks. Micro-optimising there is premature — say so plainly instead of inventing a finding.

**Transitive exception (measured 2026-10-03):** `axios` IS paid on every run. It is top-level-imported by `src/lib/crawler.ts` and `src/lib/nuxt-base-components.ts`, which `tools/crawl`, `blocks/add` and `components/add` import at top level. Warm `require('axios')` costs ~80-150 ms (median ~95-140 ms over 10 runs, very noisy), i.e. a large slice of the ~715 ms startup. Pre-existing; 1.19.0 -> 1.20.0 left it unchanged (same deps, same timings). Only a finding when a diff ADDS such an import path, not on a version bump.

## Bounded log tail + CLAUDE.md rescue (measured 2026-10-03)

| Thing | Cost |
|---|---|
| `diagnoseLog` (64 KB tail via openSync/readSync) on a 1.13 GB log | ~0.15 ms, +0.3-2 MB RSS, fd count flat over 20k calls |
| Old whole-file `readFileSync(utf8)` of the same log | throws `ERR_STRING_TOO_LONG` |
| `patchClaudeMd` + `rescueForeignContent` on an 8 MB / 32 MB marker span | ~280 ms / ~840 ms (linear) |

Measure against the compiled `build/lib/*.js` directly if it already contains the new code (grep for the new function name first). This avoids a ts-node setup.

## Scaffold-time key walks (measured 2026-08-24, reviewing `hoist-workspace-pnpm-config.ts`)

| Thing | Cost |
|---|---|
| `Object.entries()` walk + per-key `JSON.stringify(a)===JSON.stringify(b)` over 20 keys | ~6 us |
| same over 50 keys | ~11 us |
| same over 200 keys | ~41 us |

Realistic input for the workspace hoist is 2 sub-projects x a few dozen `overrides` entries, i.e. **~10 us total** inside a command that clones two git repos and runs `pnpm install`. **How to apply:** do not raise a complexity/allocation finding for per-key `JSON.stringify` at scaffold scale — grade it noise and spend the review on the *semantics* of the comparison instead (key order, `false` vs YAML-1.2 `no`, circular anchors).

## Real `lt-dev:bridge` spans + `normaliseBridgeBlock` regex worst case (measured 2026-10-06)

Over 23 real consumer `playwright.config.ts` files under `~/code` carrying the bridge marker: largest file **12.1 KB**, largest marker span **1.16 KB**, longest intra-line whitespace run inside a span **1 char** (lines are trimmed, and the consumer's formatter collapses runs inside a line).

`/\s+([)\]}])/g` (added 2026-10-06, uncommitted at the time) is **quadratic in the length of ONE contiguous whitespace run that is not followed by a closer**: 8 K → 41 ms, 16 K → 177 ms, 32 K → 667 ms, 64 K → 6.9 s, 256 K → 99.5 s. Many short runs that add up to 1 MB stay linear (2-25 ms). `/,\s*closer/` and `/opener\s+/` are linear: under 20 ms on 1 MB in every shape, because each attempt is anchored on a literal punctuation char.

**How to apply:** a regex shaped `\s+X` is quadratic only when a single long run has no X after it. Check the longest run real input can contain, not the total input length. For the bridge span that run is 1 char, and even a 12 KB file made entirely of whitespace costs about 100 ms, so this is not a finding unless the input source changes.

## `lt claude plugins` permission sync (measured 2026-10-18, reviewing `plugin-permissions.ts`)

Real input on Kai's machine: 8 plugins across 2 marketplaces, largest `permissions.json` = lt-dev with 165 rules, `~/.claude/settings.json` allow list = 257 rules.

| Thing | Cost |
|---|---|
| `planPermissionSync` (Set-based), allow 500 / others 1000 | ~0.15 ms; 10x input → ~1.45 ms (linear) |
| Full `setupPermissions` x 10 plugins x 200 rules, steady state (no writes) | ~8-9 ms total |
| same, first run (settings + ledger writes) | ~40-55 ms total |
| `getClaudeConfigDir()` | ~1 us; module-level use in `claude-cli.ts` is free |
| own load of a small `src/lib` module with internal imports only | ~0.5 ms |

Each plugin also spawns `claude plugin install` + `claude plugin update` (seconds), so file I/O in the sync is noise. **How to apply:** for this command, check idempotence (no settings/ledger rewrite on a steady run) instead of CPU; measure by compiling with `npx tsc --outDir <scratchpad>/build` and running with `NODE_PATH=<repo>/node_modules`.

## Shell strings → `execArgs` + Caddyfile `ensureLoopbackBind` (measured 2026-10-19)

- gluegun 5.2.2 `system.run` is `child_process.exec(cmd, opts)` with NO `maxBuffer`, i.e. Node's default 1 MiB per stream (same as `execFile`; verified on Node 24, both throw `ERR_CHILD_PROCESS_STDIO_MAXBUFFER` past 1 MiB). So `execArgs` (`execFile`, `maxBuffer: 1 MiB`) is buffer-neutral, and splitting an `a && b && c` chain gives each step its OWN buffer, which is strictly safer. Only a removed shell string that redirected/piped output away (`> /dev/null`, `| head`) would make the new form buffer more; grep the `-` lines for that.
- Own load of `exec-args` + `safe-paths` + `unknown-options` + `plugin-permissions` together: ~2.4 ms (builtins + internal only).
- `ensureLoopbackBind` on a 500-project, 132 KB Caddyfile: 0.16 ms (global block present) / 0.47 ms (inserting) / 1.6 ms (unbalanced braces, worst case). Idempotent across upsert/remove/legacy-heal sequences; `reloadCaddy()` after upsert is unconditional anyway (pre-existing).
- Measure Caddy code against a scratch file via `LT_DEV_CADDYFILE=<scratch>/Caddyfile` (read at module load), never the live `~/.lenneTech/Caddyfile`.

## `lt dev doctor` loaded-config check (measured 2026-10-20, reviewing `caddy.ts#compareLoadedConfig`)

| Thing | Cost |
|---|---|
| `GET 127.0.0.1:2019/config/` (5.2 KB, 9 projects) | ~12 ms |
| `compareLoadedConfig` incl. `caddy adapt` spawn + deep key-sorted compare | ~120 ms |
| Process exit after a keep-alive `http.get` resolves (Node 24 globalAgent) | 0 ms: free sockets are unref'd, no loop hold |

Hang matrix for a `{ timeout }` `http.get` with `on('timeout') → destroy`: no response → null at 2.0 s; 200 + stalled body → null at 2.0 s (the socket timeout also covers the body); socket reset mid-body → null; non-200 → null. Only a trickle faster than the timeout never settles, which a local Caddy does not do.

**How to test such a helper without touching port 2019:** TS compiles `import { get as httpGet } from 'http'` to `(0, http_1.get)(…)`, so replace `require('http').get` (plain `require`, not `import *`, whose namespace is getter-only) before requiring the module, and point it at a scratch server.
