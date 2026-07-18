---
name: project-cli
description: "@lenne.tech/cli maintenance state: npm-based, blocked updates (eslint 10, TS 7, js-yaml 5, @types/jsdom 28.0.3, prettier 3.9.x), override history, test baseline"
metadata:
  type: project
---

# @lenne.tech/cli at /Users/kaihaase/code/lenneTech/cli

## Package Manager
- Uses **npm** (package-lock.json). The `pnpm` block that appeared in package.json 1.28.0–1.37.1 was DEAD config leaked from a generated target project in the huge `lt ticket` feature commit (8827a89); removed 2026-07-18. npm ignores `pnpm.overrides` entirely; nothing in src/tests reads the CLI's own pnpm block.

## Test Baseline (as of 2026-07-18)
- `npm test` = **673 passed, 0 skipped, 51 suites** (~35-50s). Jest `testMatch: ["<rootDir>/*.test.ts"]` excludes `*.manual.ts`.
- 4 tests in `__tests__/git-commands.test.ts` can time out when a 1Password SSH agent hangs (`ssh-add -l` shows "no identities") — environment issue, not a code problem. Did NOT occur on 2026-07-18.
- When editing package.json, touch ONLY deps/devDeps/overrides/`//overrides`. NEVER `scripts`, `jest`, `files`. npm install re-sorts package.json — re-Read before each Edit.
- `npm run check` = scripts/check.sh: audit gate (ANY finding aborts) → install → format → build (lint+test+compile+copy-templates) → CLI smoke test.

## Blocked Updates (verified 2026-07-18)
- **eslint 9.39.4 → 10.x**: `@lenne.tech/eslint-config-ts` still 2.1.4 (peer `eslint >=9.26.0`, but bundled estree breaks on ESLint 10 API). Unblock when >2.1.4 releases.
- **typescript 6.0.3 → 7.x**: DOUBLE blocker: (a) tsconfig relies on `moduleResolution: node10` + `ignoreDeprecations: "6.0"` — node10 removed in TS 7; (b) ts-jest 29.4.11 peer is `>=4.3 <7`. Architectural migration (node16/bundler resolution) required first.
- **js-yaml 4.3.0 → 5.x**: v5 rewrote API: `load('')` THROWS on empty input (CLI callsites expect undefined/null, e.g. `workspace-integration.ts:620` types `null | {...}` for empty pnpm-workspace.yaml), removed dumper options, Schema.extend→withTags. Needs audited migration of ~6 callsites + defensive empty-input handling. v5 ships own types (top-level `types` field, node10-compatible, dual CJS/ESM) — when migrating, drop `@types/js-yaml`.
- **@types/jsdom 28.0.1 → 28.0.3**: re-verified 2026-07-18 — still pulls parse5 ^8 whose d.ts uses `entities/decode` subpath → TS2307 under node10 resolution. Keep 28.0.1 until moduleResolution migration.
- **prettier 3.8.3 → 3.9.x**: 3.9.5 actively reformats 3 src files (frontend/nuxt.ts, fullstack/add-app.ts, fullstack/init.ts) that are compliant under 3.8.3. Since `npm run check` runs `format --write`, updating prettier without committing the reformat leaves a dirty tree. Do the prettier bump in a dedicated commit that includes the reformat.

## Overrides (state 2026-07-18)
- ONLY remaining override: `"semver@*": "7.8.5"` — freshness pin, gluegun@5.2.2 still pins semver 7.7.0 exactly. Forces ALL semver (incl. ^5/^6 consumers) to 7.8.x; test-validated. Remove once gluegun updates. Bump target when new 7.x releases.
- REMOVED 2026-07-18 (all upstream-fixed; verified via null-override resolve in scratchpad → `npm audit` = 0): `@babel/core` (natural 7.29.7), `brace-expansion@5.0.2 - 5.0.5` (natural 5.0.6/5.0.7), `form-data` (axios now pins 4.0.6), `js-yaml` (istanbul chain resolves patched 3.15.0), `undici` (jsdom ^7.25.0 → 7.28.0 naturally).
- Null-override method: copy package.json to scratchpad, delete overrides+postinstall, `npm i --package-lock-only --ignore-scripts`, `npm audit`, parse lockfile for resolved versions.

## Dependency Decisions
- `typescript` is a RUNTIME dep (src/extensions/server.ts imports it, ts.readConfigFile at runtime) — stays in dependencies.
- `ts-node` runtime dep (bin/lt dev mode).
- `ejs` devDep (6.0.1 since 2026-07-18) is ONLY for compiling/testing src/commands/completion.ts. At published-runtime, gluegun's exactly-pinned ejs@3.1.10 gets hoisted and serves `require('ejs')`. `@types/ejs` stays at 3.1.5 DELIBERATELY (types match the 3.x production runtime). gluegun's template tool always uses its own nested ejs.
- `@types/node` 26.x compiles+tests clean despite Node 24 runtime (established: types ahead of runtime).
- `open` is imported via dynamic `import('open')` — invisible to static grep for `from 'open'`; it IS used (5 files).
- All 18 runtime deps verified used in src/ (2026-07-18); all devDeps used (husky hooks, scripts, tsc). `shx` is used via `npx shx` in copy-templates without being a devDep — works, left as-is.
- `defuddle` 0.x bumps repeatedly safe (0.17→0.18→0.19.1, API `new Defuddle(doc, opts)` stable).

## ESLint Perfectionist (for new files)
- interfaces/types alphabetical, exported functions before non-exported, template literals required.

## TS6 Setup (since 2026-04-04)
- `tsconfig.json`: `moduleResolution: "node10"` + `ignoreDeprecations: "6.0"`, `rootDir: "src"`. `tsconfig.test.json` extends with `rootDir: "."`. Jest transform: ts-jest with tsconfig.test.json.

## Husky Hooks
- pre-commit: sync-version (extras/sync-version.mjs, needs `@lenne.tech/npm-package-helper` devDep) + lint; pre-push: lint + test.

## Historical Decisions (still valid)
- `find-file-up` must NOT be direct dep (only transitive via cli-plugin-helper). `pretty-quick`/`path-exists-cli` were removed as unused. `@types/lodash` is a devDep, lodash stays runtime.
- `@typescript-eslint/eslint-plugin`/`parser` + `eslint-config-prettier` removed 2026-05-10: bundled inside `@lenne.tech/eslint-config-ts`; eslint.config.mjs never imports them directly.
- Override history: `flatted@*` removed 2026-04-04, `follow-redirects@<1.16.0` removed 2026-04-17, `apisauce`/`ejs`/`cross-spawn` overrides removed earlier — all upstream-fixed. `brace-expansion@5.0.2 - 5.0.5: 5.0.6` added 2026-05-24, removed 2026-07-18 (upstream fixed).
