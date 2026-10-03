---
name: project-cli
description: "@lenne.tech/cli maintenance state: npm-based, brace-expansion/minimatch overrides now DEDUPE not security, blocked updates (TS 7, js-yaml 5, @types/jsdom >28.0.1, jsdom 30), flaky gate suites, test baseline"
metadata:
  type: project
---

# @lenne.tech/cli at /Users/kaihaase/code/lenneTech/cli

## Package Manager
- Uses **npm** (package-lock.json). Never pnpm here (`pnpm run check` dies on ERR_PNPM_IGNORED_BUILDS and leaves a stray pnpm-lock.yaml + pnpm-workspace.yaml). The `pnpm` block that appeared in package.json 1.28.0–1.37.1 was DEAD config; removed 2026-07-18.
- **npm 11.6 adds `"peer": true` flags to ~18 lockfile entries on every install**; releases ship without them. Strip after the LAST install (and again after every `npm run check`, which runs `npm install`):
  `node -e 'const fs=require("fs");const f="package-lock.json";const j=JSON.parse(fs.readFileSync(f,"utf8"));for(const p of Object.values(j.packages)){if(p.peer===true)delete p.peer}fs.writeFileSync(f,JSON.stringify(j,null,2)+"\n")'`
- CI (`.github/workflows/build.yml`) runs `npm ci` on Node 20 = npm 10, the strict generation. The `@emnapi/core` + `@emnapi/runtime` devDeps exist ONLY for that (see `//devDependencies`); pinned exact 1.11.3 on 2026-10-03 (peer is `^1.7.1 || ^2.0.0-alpha.4`).

## Test Baseline (as of 2026-10-03)
- **83 suites / 1256 tests, 0 skipped** under `npm run check`.
- When editing package.json, touch ONLY deps/devDeps/overrides/`//overrides`/`//devDependencies`. NEVER `scripts`, `jest`, `files`.
- `npm run check` = scripts/check.sh: audit gate (ANY finding aborts) → install → `prettier --write src/**` → build (lint+test+clean-build+compile+copy-templates) → CLI smoke test.
- **Flaky under the full gate, green in isolation — rerun before blaming a dependency:**
  - `directus-commands.test.ts` › "handles invalid URL/token gracefully" shells out to `directus-sdk-typegen` via the package manager (network/registry) — hit the 60s timeout once (suite 318s) on 2026-10-03.
  - Jest worker `SIGSEGV` ("terminated by another process") — the crash `//jest.workerIdleMemoryLimit` describes. Recurred 2026-10-03 in `module-specifiers.test.ts`; that note asks for the suite name when it recurs.
  - Rerun just those: `npx jest module-specifiers directus-commands --testTimeout=60000`.
- **Jest passing does NOT prove compile passes** — ts-jest is lenient on lib d.ts; `tsc -p .` (the compile step) is what catches TS2307 from @types bumps. Run `npx tsc -p . --noEmit` right after any @types change, before the 6+ minute gate.

## npm overrides: hard-won mechanics
- **A stale `node_modules` silently defeats new overrides.** Confirm an override's effect in a clean scratch dir (copy package.json, drop `scripts.postinstall`, `npm i --package-lock-only --ignore-scripts`, then `npm audit` there). Three such dirs in parallel (A = as-is, B/C = one entry removed each) take ~20s and give the non-circular "is this override load-bearing" answer.
- Nested per-parent overrides support version-selector keys (`"fs-jetpack": { "minimatch@<10": "10.2.6" }`).
- `npm ls` shows `minimatch@10.2.6 deduped invalid: "^10.2.2" from node_modules/glob, "10.2.6" from node_modules/fs-jetpack` — PRE-EXISTING display quirk of the scoped fs-jetpack override, not a broken tree.

## brace-expansion / minimatch — state as of 2026-10-03
- **The "1.x/2.x are end of line" premise is GONE.** Upstream backported everything on 2026-09-14: GHSA-mh99 now reads `<1.1.17` / `>=2.0.0 <2.1.3`; 1.1.21 and 2.1.7 patch all five advisories (also GHSA-3jxr, -6j4f, -qhr7, -q2hr). 3.x patched at 3.0.9; 4.x has no fix (→ 5.0.12).
- Raised the latent keys to `brace-expansion@<1.1.21 → 1.1.21` and `@>=2.0.0 <2.1.7 → 2.1.7` (only 5.0.12 is in the tree).
- Fresh resolves proved: dropping `minimatch@>=4 <10` + `fs-jetpack > minimatch@<10` keeps audit clean and adds 7 pkgs (minimatch 3.1.5/5.1.9, brace-expansion 1.1.21/2.1.7); dropping `babel-plugin-istanbul > test-exclude@<8` keeps audit clean and adds 23 pkgs (glob 10.5.0 subtree). All three are now DEDUPE overrides, documented as such in `//overrides`. Kept for package minimisation.
- `minimatch@>=4 <10` now only raises `filelist` (gluegun > ejs 3.1.10 > jake). typescript-estree 8.65 requests ^10.2.2; jest 30.5 packages no longer depend on minimatch. babel-plugin-istanbul 8.0.0 (jest 30.5) requests test-exclude ^7.0.1; 8.0.0 still works (`new _testExclude.default(opts)`).
- Never force brace-expansion 5.x globally (5.x exports an object; 1.x/2.x the function → `expand is not a function`).
- minimatch export shapes: 3.x callable; 9.x/10.x object with `__esModule` and no `default`.
- Prod transitive: gluegun > fs-jetpack 4.3.1 > rimraf 2 > glob 7.2.3 > `inflight` (deprecated, leaks) — no advisory, unfixable until gluegun moves.

## Blocked / deferred updates (verified 2026-10-03)
- **typescript 6.0.3 → 7.x**: TS 7's package exports only `./lib/version.cjs` + `unstable/*` — the classic compiler API that src uses AT RUNTIME (`ts.createSourceFile`, `ts.forEachChild`, `ts.readConfigFile` in module-specifiers, spinner-lifetime, heal-vendor-migrate-store, server.ts) is gone. Plus ts-jest 29.4.14 peer `<7`, @typescript-eslint 8.65 peer `<6.1.0`, ts-node needs the JS API, tsconfig `moduleResolution: node10`. 6.0.3 is the newest 6.x.
- **js-yaml 4.3.2 → 5.x**: differential v4 vs v5 over 20 real stack `pnpm-workspace.yaml` files = identical load + dump. But edge inputs differ: empty / whitespace / comment-only input THROWS ("expected a document") where v4 returned undefined/null; merge keys `<<` NOT resolved by default (literal `'<<'` key); `2026-10-03` stays a string; dump quotes `1_000`. Six load sites (config.ts ×2, validate.ts ×2, workspace-integration.ts, hoist-workspace-pnpm-config.ts, adopt-upstream-build-allowlist.ts). The allowBuilds deny logic depends on `no`/`off` staying STRINGS — so YAML11_SCHEMA is not a migration shortcut. Needs a deliberate migration with a shared load wrapper. 4.3.2 is patched for both current js-yaml advisories. v5 ships own types → drop `@types/js-yaml` then.
- **@types/jsdom 28.0.1 → 28.0.2+ / 30.0.0**: every version after 28.0.1 depends on parse5 ^8, whose d.ts imports the `entities/decode` subpath → TS2307 under `moduleResolution: node10`. Re-reproduced 2026-10-03 (jest green, `tsc -p .` red). Blocked until the moduleResolution migration.
- **jsdom 29.1.1 → 30.x**: engines `^22.22.2 || ^24.15.0 || >=26.0.0` (local Node 24.12.0 fails; CI build.yml runs Node 20) and undici 8 needs Node >=22.19. `npm outdated` does not even list it.

## Done (no longer blocked)
- eslint 10 (10.12.0 on 2026-10-03; `@lenne.tech/eslint-config-ts` 2.3.0 moved to import-x — the old eslint-plugin-import residual is gone, audit 0).
- prettier 3.9.9 (2026-10-03): collapses short union types onto one line; reformatted `commands/frontend/nuxt.ts`, `commands/fullstack/add-app.ts`, `commands/fullstack/init.ts`, `lib/dev-api-launch.ts`. Check `npx prettier --check` with a new prettier BEFORE the gate writes.

## Dependency Decisions
- **`ejs` moved devDependencies → dependencies on 2026-10-03.** `src/commands/completion.ts` imports it at top level and gluegun loads EVERY command on EVERY `lt` run, so the published CLI depended on gluegun's ejs 3.1.10 being hoisted (phantom dependency, tests ran ejs 6). ejs 6.0.1 has zero deps and a CJS `require` export. gluegun keeps its own nested ejs 3.1.10. `@types/ejs` 3.1.5 stays (ejs 6 ships no types).
- `typescript` + `ts-node` are RUNTIME deps (see above).
- `minimatch` devDep (10.2.6) — only `__tests__/vscode-settings.test.ts`.
- `@types/*` devDeps look unused to a grep — consumed via `node_modules/@types` auto-inclusion; `tsc` is the proof.
- `open` is imported via dynamic `import('open')` (invisible to a `from 'open'` grep).
- `rimraf` used via `npx rimraf` in scripts; `husky` via `.husky/` hooks; `@lenne.tech/npm-package-helper` via `extras/sync-version.mjs` (pre-commit).
- `defuddle` 0.x patch bumps repeatedly safe.
- `semver@*: 7.8.5` override = freshness pin (gluegun 5.2.2 pins 7.7.0); 7.8.5 is still the newest 7.x.

## ESLint Perfectionist probe (after any eslint-stack change)
`printf 'export interface Z { b: string; a: string }\n' | npx eslint --stdin --stdin-filename src/__probe.ts` → must report `perfectionist/sort-interfaces` (still does on eslint 10.12.0).
