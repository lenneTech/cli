---
name: spawndetached-sh-exec-safe
description: spawnDetached wraps commands in `/bin/sh -c 'ulimit…; exec "$0" "$@"'` — this is injection-SAFE by argv-binding; do not re-flag it as command injection
metadata:
  type: reference
---

`src/lib/dev-process.ts#spawnDetached` runs the target via
`spawn('/bin/sh', ['-c', `${raiseFdLimit}; exec "$0" "$@"`, cmd, ...args], …)`
(the `sh -c` layer only exists to raise `ulimit -n` before exec, fixing chokidar
EMFILE on boot). A future review will see `sh -c` + a template string and may
reflexively flag command injection. **It is safe — reviewed 2026-07-20.** Reasoning:

- In `sh -c SCRIPT a0 a1 a2 …`, the args AFTER the script bind to positional
  params: `$0`=a0 (=`cmd`), `$1`=a1 (=`args[0]`), … `cmd`/`args` are passed as
  SEPARATE spawn-argv entries, **never interpolated into the SCRIPT string**.
- `exec "$0" "$@"` is double-quoted → no word-splitting, no glob, no re-parse of
  the values' contents. A `cmd`/arg containing `;`, `$(…)`, backticks, spaces is
  passed verbatim as one argv entry (exec fails ENOENT at worst — never executes).
  `"$@"` with zero positional params correctly expands to nothing (POSIX special-
  case), so empty `args` is fine too.
- The ONLY value interpolated into the SCRIPT string is `raiseFdLimit`, a
  hardcoded constant literal — no user/config data.
- `env` (opts.env) goes to the child env, not argv — Mongo URI etc. never hit a
  command line / `ps`. Non-interactive `/bin/sh` sources no startup files
  (bash-as-sh + dash), and quoted `"$0"`/`"$@"` defeat any malicious `IFS`.
- `exec` replaces the shell in place → recorded PID + `setsid` process group are
  the real process, so `killProcessGroup`/`terminateProcessGroup` still work.
- Provenance (defense-in-depth, not the safety basis): all callers pass `cmd` =
  literal `'node'` or a package-manager binary (`pm.bin`/`LT_PNPM_BIN`), `args` =
  an allowlisted compiled-entry path or `pm.runScript(...)` output.

Non-security nuance: a bad `cmd` no longer yields `pid===undefined` (the `sh`
spawn succeeds, then the inner exec exits 127) — the health classifier
(`classifyComponentHealth`) catches the dead/`crashed` PID, so it self-corrects.

Related: [[cli-repo-review-scope]], [[cli-generated-file-injection]]
