---
name: project-cli
description: "@lenne.tech/cli maintenance state: npm-based, brace-expansion override architecture, blocked updates (eslint 10, TS 7, js-yaml 5, @types/jsdom 28.0.3, prettier 3.9.x, jsdom 30), test baseline"
metadata:
  type: project
---

# @lenne.tech/cli at /Users/kaihaase/code/lenneTech/cli

## Package Manager
- Uses **npm** (package-lock.json). The `pnpm` block that appeared in package.json 1.28.0–1.37.1 was DEAD config leaked from a generated target project; removed 2026-07-18. npm ignores `pnpm.overrides` entirely.

## Test Baseline (as of 2026-07-31)
- `npx jest --testTimeout=60000` = **864 passed, 0 skipped, 58 suites** (~37s). Was 673/51 on 2026-07-18; grew with the vscode/heal-vendor feature work.
- Jest `testMatch: ["<rootDir>/*.test.ts"]` excludes `*.manual.ts`.
- When editing package.json, touch ONLY deps/devDeps/overrides/`//overrides`. NEVER `scripts`, `jest`, `files`. npm install re-sorts package.json — re-Read before each Edit.
- `npm run check` = scripts/check.sh: audit gate (ANY finding aborts) → install → format → build (lint+test+compile+copy-templates) → CLI smoke test. `npm run check --force` bypasses only the gate.
- **`npm run check` runs `prettier --write` on `src/**`** — so a prettier bump inside a package-only task WILL dirty source files. Do prettier bumps in a dedicated commit that includes the reformat.

## npm overrides: hard-won mechanics (2026-07-31)
- **A stale `node_modules` silently defeats new overrides.** npm builds the ideal tree starting from the ACTUAL installed tree. Editing `overrides` + `npm install`, or even `rm package-lock.json && npm install --package-lock-only`, leaves most nested versions untouched. Deleting `node_modules/.package-lock.json` is NOT enough either. **Only `rm -rf node_modules package-lock.json && npm install` truly re-resolves.** Cost me several wrong "the override doesn't work" conclusions — always confirm an override's effect in a clean scratch dir (copy package.json to a temp dir with no node_modules, `npm i --package-lock-only --ignore-scripts`) before concluding it is unsupported.
- Nested **per-parent** overrides DO support version-selector keys: `"eslint": { "minimatch@<10": "10.2.6" }` works. (An earlier "npm ignores nested selectors" conclusion was an artifact of the stale-node_modules trap above.) Prefer the bounded form — it can only RAISE a vulnerable install, never cap a patched one.
- Doc/override key parity check (all keys, incl. nested `parent > child`) is worth running before finishing:
  `node -e "..."` flattening `overrides` and diffing against `//overrides` keys.

## brace-expansion GHSA-mh99-v99m-4gvg — the current architecture
- Advisory range is **`<=5.0.7` across ALL majors**; upstream patched **only 5.0.8+**. 1.x tops out at 1.1.18, 2.x at 2.1.4 — both permanently vulnerable, no backport will come.
- **Never force brace-expansion 5.x globally**: 5.x is ESM/tshy exporting an OBJECT `{ expand, ... }`; 1.x/2.x export the function itself. minimatch 3.x/5.x do `expand(...)` → `TypeError: expand is not a function`. And brace-expansion is production-reachable (glob, gluegun→fs-jetpack, gluegun→ejs→jake→filelist, ts-morph).
- **The working lever is raising the CONSUMERS off minimatch 3.x/5.x/9.x.** minimatch 10.2.6 → brace-expansion ^5.0.8 (patched).
- minimatch export shapes: **3.x is a callable function; 9.x and 10.x export an OBJECT** (`{ minimatch, Minimatch, match, filter, ... }`) with `__esModule: true` and **no `default` key**. That single fact decides every consumer:
  - `require('minimatch').Minimatch` / `{ Minimatch }` / `minimatch.match(...)` / named `minimatch(...)` → **safe on 10.x**.
  - `_interopDefaultLegacy(...)['default']` → safe (no `default` key ⇒ wraps to the module object).
  - `_interopRequireDefault(...)['default'](...)` → **BREAKS** (`__esModule:true` ⇒ returns module ⇒ `.default` is undefined).
- Result 2026-07-31: **39 findings → 4** (one node). Overrides added: `minimatch@>=4 <10 → 10.2.6` (global bounded, covers filelist/typescript-estree/jest) plus per-parent `minimatch@<10 → 10.2.6` for `eslint`, `@eslint/eslintrc`, `@eslint/config-array`, `fs-jetpack`, plus `babel-plugin-istanbul > test-exclude@<8 → 8.0.0`.
- **The `minimatch@>=4 <10` key must stay floored at >=4** so the 3.x line is not swept in — eslint-plugin-import needs a callable default.

## ACCEPTED RESIDUAL (audit gate stays red without --force)
- `eslint-plugin-import@2.32.0` (bundled by `@lenne.tech/eslint-config-ts@2.1.4`) → minimatch 3.1.5 → brace-expansion 1.1.18. **4 audit findings, all one node.**
- Unfixable in this repo: 2.32.0 is the newest release, still requests minimatch ^3.1.2, and its rules call the default export (breaks on 10.x). No minimatch release is both callable AND on patched brace-expansion.
- **DEV-ONLY** (lint time) — no production chain reaches it. All production chains resolve to brace-expansion 5.0.9.
- **Upstream fix belongs in `@lenne.tech/eslint-config-ts`**: move to `eslint-plugin-import-x`. That single change ALSO unblocks eslint 10.

## Blocked Updates (verified 2026-07-31)
- **eslint 9.39.4 → 10.8.0**: eslint 10 REMOVED the `FlatESLint`/`LegacyESLint` exports; `@typescript-eslint/utils@8.46.1` does `class FlatESLint extends ESLint_1.FlatESLint` → `TypeError: Class extends value undefined`. @typescript-eslint 8.65.0 declares `eslint ^10` support, BUT `eslint-plugin-import@2.32.0` (newest) has peer `^2||…||^9` with **no eslint-10-compatible release at all** — nothing to override to. Both live inside `@lenne.tech/eslint-config-ts@2.1.4`. Unblock via an eslint-config-ts release on @typescript-eslint 8.65+ and eslint-plugin-import-x.
- **typescript 6.0.3 → 7.x**: DOUBLE blocker: (a) tsconfig uses `moduleResolution: node10` + `ignoreDeprecations: "6.0"` — node10 removed in TS 7; (b) `ts-jest@29.4.12` peer is `typescript >=4.3 <7`. Architectural migration (node16/bundler) required first.
- **js-yaml 4.3.0 → 5.x**: v5 `load('')` THROWS on empty input (callsites expect undefined/null, e.g. `workspace-integration.ts` types `null | {...}` for an empty pnpm-workspace.yaml); removed dumper options; `Schema.extend`→`withTags`. ~5 src files. v5 ships own types — drop `@types/js-yaml` when migrating.
- **@types/jsdom 28.0.1 → 28.0.3**: re-verified 2026-07-31 — pulls parse5 ^8 whose d.ts imports the `entities/decode` SUBPATH → TS2307 under node10 resolution. Keep 28.0.1 until the moduleResolution migration.
- **prettier 3.8.3 → 3.9.6**: reformats exactly 3 src files (`commands/frontend/nuxt.ts`, `commands/fullstack/add-app.ts`, `commands/fullstack/init.ts`). Needs a dedicated commit including the reformat.
- **jsdom 29.1.1 → 30.0.1**: engines `^22.22.2 || ^24.15.0 || >=26.0.0`; local Node is 24.12.0 → does NOT satisfy. Blocked until Node ≥24.15.

## Other Overrides
- `semver@*: 7.8.5` — freshness pin, gluegun@5.2.2 still pins semver 7.7.0 exactly. Remove once gluegun updates. Bump target when new 7.x releases.
- Removed 2026-07-18 (all upstream-fixed): `@babel/core`, `form-data`, `js-yaml`, `undici`.

## Dependency Decisions
- `typescript` is a RUNTIME dep (src/extensions/server.ts, `ts.readConfigFile` at runtime) — stays in dependencies. `ts-node` runtime dep (bin/lt dev mode).
- `minimatch` is a **devDep** (10.2.6) — used only by `__tests__/vscode-settings.test.ts` via `import { minimatch } from 'minimatch'`; NOT used in src/. Keeping it at 10.x also makes the hoisted root minimatch patched.
- `js-sha256` 1.0.0 (bumped 2026-07-31 from 0.11.1): major restructured to a conditional `exports` map, but under `moduleResolution: node10` TS ignores `exports` and uses `main`; compiles + runs clean. Used in `commands/tools/{crypt,sha256}.ts`.
- The six `@types/*` devDeps look "unused" to a grep (no explicit import) — they are consumed implicitly via `node_modules/@types` auto-inclusion. Do NOT remove; `tsc` passing is the proof they're needed. `@types/ejs` stays at 3.1.5 DELIBERATELY (matches gluegun's ejs 3.x production runtime).
- `ejs` devDep (6.0.1) is ONLY for compiling/testing src/commands/completion.ts; at published runtime gluegun's pinned ejs@3.1.10 serves `require('ejs')`.
- `open` is imported via dynamic `import('open')` — invisible to a static `from 'open'` grep; it IS used (5 files).
- `@types/node` 26.x compiles+tests clean despite Node 24 runtime.
- `defuddle` 0.x bumps repeatedly safe (API `new Defuddle(doc, opts)` stable).
- `find-file-up` must NOT be a direct dep (only transitive via cli-plugin-helper). `@typescript-eslint/*` + `eslint-config-prettier` removed 2026-05-10: bundled inside `@lenne.tech/eslint-config-ts`.

## ESLint Perfectionist (for new files)
- interfaces/types alphabetical, exported functions before non-exported, template literals required.
- Verify rules still FIRE after any eslint-stack change via stdin (no temp files):
  `printf 'export interface Z { b: string; a: string }\n' | npx eslint --stdin --stdin-filename src/__probe.ts`
  → must report `perfectionist/sort-interfaces`.

## Husky Hooks
- pre-commit: sync-version (extras/sync-version.mjs, needs `@lenne.tech/npm-package-helper` devDep) + lint; pre-push: lint + test.
