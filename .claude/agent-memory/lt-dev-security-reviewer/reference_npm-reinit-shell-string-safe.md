---
name: npm-reinit-shell-string-safe
description: `lt npm reinit` builds a shell string for system.run; traced 2026-10-03 — only `dir` is variable and it is not repo-controlled, do not re-flag as injection
metadata:
  type: reference
---

`lt npm reinit` (`src/commands/npm/reinit.ts`, string built by `src/lib/reinit-command.ts#buildReinitCommand`) passes
`cd ${dir} && rimraf ${lockfile} && rimraf node_modules && ${install}` to gluegun `system.run` (a shell).

Traced 2026-10-03:
- `lockfile` / `install` come from `PackageManager.getLockfileName()` / `install()`, whose `switch` returns fixed literals
  for every input, including an unvalidated `defaults.packageManager` from a committed lt.config (default branch -> npm literal).
- `dir` = `dirname(path)` where `path` comes from `@lenne.tech/cli-plugin-helper` `npm.getPackageJson()` -> `find-file-up`,
  which walks UPWARD from cwd. The path is made of the developer's own cwd and its ancestors, never a repo-controlled subdirectory name.
  GitHub repo names cannot carry shell metacharacters either.
- So there is no attacker path under the "local CLI on own project" threat model. A path with spaces breaks the command
  (a robustness issue, not a security one), and the same unquoted `cd ${dirname(path)}` pattern also appears in the
  sibling `reinit` / `test` / `test:e2e` branches of the same file.

Related: [[spawndetached-sh-exec-safe]], [[cli-generated-file-injection]].
