---
name: npm-reinit-shell-string-safe
description: `lt npm reinit` shell sinks traced 2026-10-03 and re-reviewed 2026-10-19 after the dir left the string — no variable value reaches a shell; do not re-flag
metadata:
  type: reference
---

`lt npm reinit` (`src/commands/npm/reinit.ts`, string built by `src/lib/reinit-command.ts#buildReinitCommand`).

State since 2026-10-19 (after 1.51.1):
- `buildReinitCommand` returns `rimraf <lockfile> && rimraf node_modules && <install>`; the directory is passed
  as gluegun `system.run(cmd, { cwd })` (gluegun forwards every option except `trim` to `child_process.exec`).
- `ncu -u --packageFile <path>` runs via `spawnArgs` (cross-spawn), guarded by `hasCmdShimHazard(path)` on Windows.
- Every remaining `system.run` string is a literal from `src/extensions/package-manager.ts` switch tables
  (`globalInstall`, `install`, `getLockfileName`, `run`), default branch -> npm literal.
- `path` = `npm.getPackageJson()` -> `find-file-up`, absolute, walks UPWARD from cwd: the developer's own cwd and
  ancestors, never a repo-controlled subdirectory name. Under the "local CLI on own project" threat model there is
  no attacker path even before the fix.
- Nothing calls `npx ncu` (that would resolve the unrelated npm package `ncu`); `ncu` is the bin of the globally
  installed `npm-check-updates`. Binary resolution unchanged: cmd.exe and cross-spawn's which@2 both search cwd
  first on Windows; POSIX uses PATH in both forms.
- Known pre-existing, out-of-diff: `if (system.which('rimraf'))` installs rimraf when it is ALREADY present (inverted).

Related: [[shell-sink-facts]], [[spawndetached-sh-exec-safe]], [[cli-generated-file-injection]].
