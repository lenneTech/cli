---
name: shell-sink-facts
description: Verified facts for judging shell-injection fixes in this CLI — git ref names carry shell metacharacters, safeRef is only an option guard, cross-spawn double-escapes only node_modules\.bin shims
metadata:
  type: reference
---

Verified 2026-10-19 (git `check-ref-format --branch`, cross-spawn 7.0.6 source):

- **Git accepts `;`, `|`, `&`, `$(…)` and backticks in branch AND tag names.** A cloned repository
  ships tags, so a value from `lt.config` (e.g. `defaults.baseBranch`) can pass any "does this ref
  exist?" check (`git rev-parse --verify`) and still carry shell syntax.
- **`safeRef` / `isSafeRef` (src/lib/exec-args.ts) only stop option injection** (leading `-`,
  whitespace, control chars). They accept every name above, so they are safe ONLY together with
  `execArgs`. A `safeRef`'d value that still reaches a `system.run` string is not protected.
- **cross-spawn (`spawnCmd`/`spawnCmdSync`) on Windows double-escapes only for shims matching
  `node_modules\.bin\*.cmd`.** `npx.cmd`, `pnpm.cmd` and global `%APPDATA%\npm\*.cmd` shims get
  single escaping and re-parse `%*`, so a value containing `"` plus a cmd operator still runs.
  The repo's own `platform.ts` doc says "never untrusted free text" — check callers against it.

**How to apply:** when a diff claims to have removed shell injection, AST-scan for `run(`/`exec(`
with a non-literal first argument (template literal or `+` concatenation, multi-line included),
then trace each interpolated value to a flag, `lt.config`, or git output. See [[cli-repo-review-scope]].
