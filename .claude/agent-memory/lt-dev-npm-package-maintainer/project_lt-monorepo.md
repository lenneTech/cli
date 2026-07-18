---
name: project-lt-monorepo
description: Maintenance facts for ~/code/lenneTech/lt-monorepo (template repo, pnpm 11 default 24h release-age gate, deferred c-a-t-v 13)
metadata:
  type: project
---

# lt-monorepo maintenance facts (as of 2026-07-18)

- Repo: `/Users/kaihaase/code/lenneTech/lt-monorepo`, pnpm, fullstack-monorepo TEMPLATE (no npm package). Only 2 devDeps: `commit-and-tag-version` (release scripts), `husky` (prepare + .husky/pre-commit `pnpm run lint`). Both in use; nothing to remove/recategorize.
- `pnpm-workspace.yaml` has NO overrides — only `packages: projects/*` + `allowBuilds` (+pnpm10 twin `onlyBuiltDependencies` comment). Its settings are INHERITED by every scaffold (`hoist-workspace-pnpm-config.ts`), so treat every setting change as shipping to all future projects.
- `pnpm run check` = `scripts/check.mjs` orchestrator; with empty `projects/` it falls back to root `check:raw` (install --frozen-lockfile, audit gate, check:workspace, check:pin, recursive check). `check:pin` enforces the packageManager pin contract (exact `pnpm@X.Y.Z+sha512.<hex>`, engines `^<major>.0.0`, CI derive-lines) — CI needs NO edits on pin bumps.
- packageManager pin method: same hex-sha512-of-tarball as [[project-nuxt-extensions]]. Bumped 11.13.1 -> 11.14.0 on 2026-07-18 (validated same day in nuxt-extensions).
- **pnpm 11 has a DEFAULT ~24h `minimumReleaseAge` supply-chain gate (no config needed).** `pnpm add` of a release younger than that AUTO-WRITES a `minimumReleaseAgeExclude` entry into pnpm-workspace.yaml. If you revert the add, the exclude entry stays behind as dead config — remove it manually. Applies to ALL pnpm-11 repos in the stack.
  **How to apply:** after any `pnpm add`, diff pnpm-workspace.yaml; in template repos never ship same-day releases via an exclude hole.
- **DEFERRED: commit-and-tag-version 12.7.3 -> 13.0.0** (published 2026-07-18, same-day major; pnpm gate flagged it). Breaking: pure ESM (CLI use unaffected — repo uses CLI only), node >=22 (repo already `>= 22`), conventional-changelog preset changes (`.versionrc.json` uses only standard `types`/`bumpFiles` — expected compatible). Re-attempt after a soak of a few days; verify via `pnpm exec commit-and-tag-version --dry-run` before keeping.
- Pre-existing `stash@{0}` (WIP on docs/lt-dev-init-rename) belongs to Kai — never touch.
- Lockfile note: an add/revert cycle re-resolves that subtree and floats in-range transitives (babel patches, semver, yargs) — harmless, keep them.
