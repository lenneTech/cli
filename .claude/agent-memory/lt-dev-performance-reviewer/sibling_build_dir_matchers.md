---
name: sibling-build-dir-matchers
description: Any new sibling build dir (.nuxt-test, .output-test, .nuxt-check) must be registered in three independent exact-segment matchers, or it becomes uncleaned residue that blocks `lt ticket stop`
metadata:
  type: project
---

When a change introduces a **sibling-suffixed** build directory (`.nuxt-test`, `.output-test`, `.nuxt-check`, …), check **three independent matchers**. All three match a *whole path segment*, so `.nuxt` never covers `.nuxt-test`:

1. **The consumer project's `.gitignore`** — `nuxt-base-template/.gitignore` has the `.nuxt-*` / `.output-*` globs, but projects scaffolded before that update only have literal `.nuxt` / `.output`, and no lt command ever adds the new names (`addToGitignore` is only ever called with `.lt-dev/`).
2. **`GENERATED_PATHS` in `src/lib/dev-ticket.ts`** — `/(^|\/)(\.nuxtrc|\.nuxt|\.nitro|\.output|dist|…)(\/|$)/`. Anything not matched counts as `realDirty`, so untracked build output makes `lt ticket stop` **refuse to remove the worktree**, claiming uncommitted work the developer never wrote.
3. **`MEMORY_PROFILE['files.watcherExclude'] / ['search.exclude']` in `src/lib/vscode-settings.ts`** — `**/.nuxt/**` does not match `.nuxt-test/`, so VS Code keeps watching and indexing the new tree (verified with minimatch).

Also check that `tearDownTestSession` actually deletes it — it tears down processes, Caddy block, session file, env bridge and registry entry, but **no build directory**. Measured real sizes on Kai's machine: `.nuxt` 1.4–4.6 MB, `.output` **37–294 MB** (median ~48 MB) per project.

**Why:** `.nuxt-check` (DEV-2708) already slipped through all three unnoticed; DEV-2715/DEV-2724 then added two more. The failure is silent — residue accumulates and the `lt ticket stop` refusal reads as a git problem, not a build-dir problem.

**How to apply:** on any diff that adds or renames a build/output directory, grep for the three matchers above before judging the change complete. Related: [[cli-perf-calibration]], [[cli-repo-static-only]].
