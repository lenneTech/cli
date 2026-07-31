---
name: heal-tests-depend-on-gitignore
description: The heal-* lib functions have a git dirty-file guard, so their tests only pass because __tests__/temp-* is gitignored — a hidden, load-bearing coupling
metadata:
  type: project
---

Every `heal*` helper in `src/lib/` (`heal-check-wrapper.ts`, `heal-vendor-migrate-store.ts`)
guards its overwrite with a private `hasUncommittedChanges(projectRoot, relPath)` that shells out
to `git -C <root> status --porcelain -- <path>` and treats ANY output as "dirty → skip, do not
overwrite". `git status --porcelain` reports untracked files as `??`.

Their tests build the fake project INSIDE the repo (`filesystem.path('__tests__', 'temp-heal-…')`),
so the fixture files are untracked files of the lt CLI's own git repo. They only read as *clean*
because `.gitignore` line 32 (`__tests__/temp-*`) hides them — ignored files are not listed by
`git status --porcelain` without `--ignored`.

**Why:** verified empirically — the same fixture outside that ignore rule returns
`?? migrations-utils/migrate.js`, `hasUncommittedChanges` flips to true, and the heal is skipped,
so the happy-path assertions (`expect(changed).toHaveLength(1)`) fail. Renaming the fixture prefix
away from `temp-` silently breaks every heal happy-path test, with a failure message that points at
the heal logic rather than at the fixture location.

**How to apply:** when adding or renaming a `heal*` test fixture, either keep the `__tests__/temp-*`
prefix or move to `mkdtempSync(join(tmpdir(), …))` — os tmpdir is outside any git repo, so
`execFileSync` throws, the catch returns false, and the result no longer depends on `.gitignore` at
all. That tmpdir pattern is what the other 24 test files already use. Separately: the dirty-file
skip path is the data-loss guard and is covered by NO test in either heal file — testing it needs a
real `git init` + commit + modify fixture, which only works outside the ignore rule.
