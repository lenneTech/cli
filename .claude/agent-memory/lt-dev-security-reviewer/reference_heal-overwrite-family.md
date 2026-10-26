---
name: heal-overwrite-family
description: The `heal*` self-heal functions run by `lt fullstack update` overwrite files in the USER'S project with no confirm and no dry-run — their git guard fails OPEN for non-git and gitignored files
metadata:
  type: reference
---

`lt fullstack update` (`src/commands/fullstack/update.ts`) runs a family of
self-heal functions that **overwrite files in the user's project**, with **no
confirmation prompt and no `--dry-run`** (the command has neither). Members so
far: `healCheckWrapper`, `healVendorClaudeMd`, `healVendorMigrateStore`,
`addToGitignore`. Audit every new `heal*` addition against this checklist.

**The shared safety guard is `hasUncommittedChanges(root, relPath)` — duplicated
verbatim in `heal-check-wrapper.ts` and `heal-vendor-migrate-store.ts`:**

```ts
execFileSync('git', ['-C', root, 'status', '--porcelain', '--', relPath], …)
// non-empty output => skip the overwrite
```

The `execFileSync` itself is injection-SAFE (fixed argv array, no shell, `--`
before the pathspec, `relPath` is a hardcoded constant, `root` is consumed by
`-C` as exactly one argument). Do not re-flag it. The problem is the guard's
**coverage**, verified empirically on fixture repos:

| Target state | porcelain output | Guard verdict | Recoverable after overwrite? |
|---|---|---|---|
| tracked + modified | ` M path` | skip | — (correct) |
| untracked, not ignored | `?? path` | skip | — (correct, incidental) |
| tracked + clean | empty | **OVERWRITE** | yes, via git |
| **in `.gitignore`, untracked** | **empty** | **OVERWRITE** | **NO** |
| **not a git repo at all** | throws → `catch { return false }` | **OVERWRITE** | **NO** |
| `git` not on PATH | throws → false | **OVERWRITE** | **NO** |

The last three are the fail-open cases: the guard's own docstring justifies
itself with "a committed file is recoverable via git" — but empty porcelain
output does **not** mean committed. A tracked-ness probe
(`git ls-files --error-unmatch <path>`) is what actually establishes the
premise; `--porcelain` alone does not. None of these cases has a test.

**How to apply:** for any `heal*` that overwrites rather than appends, check
(1) is there a tracked-ness probe, not just a dirty probe; (2) is there a `.bak`
or temp+rename for the non-git path; (3) is the write atomic (`writeFileSync`
truncates in place — a crash leaves a truncated file); (4) does the DECISION to
overwrite come from a regex over the file's contents? If yes see
[[regex-lexing-decides-destruction]].

**Temp+rename is not symlink-safe when the temp name is fixed (found 2026-10-25, fixed the same day).**
`heal-vendor-migrate-store.ts#writeAtomic` used to write `${target}.lt-tmp` with a plain
`writeFileSync` (flag `w`), which FOLLOWS a symlink already sitting at that path; `rename`
then moved the link itself onto the target. A repo that committed
`migrations-utils/<file>.lt-tmp -> <any path>` (git checks symlinks out, also dangling ones)
made `lt fullstack update` truncate/create that outside file with the template content.
Reproduced for `healVendorTsCompiler` and `healVendorMigrateStore`; the
`isSymbolicLink(target)` check does not cover the temp path. Now: random suffix
(`.lt-tmp-<pid>-<12 hex>`) plus `{ flag: 'wx' }` (O_EXCL refuses live and dangling links with
EEXIST), and only a temp file the call created is unlinked on failure; regression tests in
both heal test files. `heal-check-wrapper.ts` still uses `.lt-tmp-${pid}` with `copyFileSync`
(predictable, follows a link) — re-check it if it is ever touched.

Related: [[cli-repo-review-scope]], [[yaml-loader-js-yaml5]]
