---
description: NPM Package Maintainer memory for lenne.tech CLI project
---

# NPM Package Maintainer Memory - lenne.tech CLI

## Project: @lenne.tech/cli at /Users/kaihaase/code/lenneTech/cli

### Package Manager
- Uses **npm** (package-lock.json present)

### Key Architecture
- TypeScript CLI built with Gluegun
- Source: `src/` with commands, extensions, interfaces, templates
- Tests: `__tests__/` (Jest)
- Extras: `extras/` (sync scripts)
- Config: `eslint.config.mjs`, `tsconfig.json`, `tsconfig.test.json`

### TypeScript 6 Migration (completed 2026-04-04)
- Updated to TypeScript 6.0.3 (from 6.0.2 on 2026-04-17)
- `tsconfig.json`: `moduleResolution: "node10"` + `"ignoreDeprecations": "6.0"`, `"rootDir": "src"`
- `tsconfig.test.json` extends tsconfig.json with `rootDir: "."` to cover both `src/` and `__tests__/`
- Jest config: explicit `transform: { "^.+\\.tsx?$": ["ts-jest", {"tsconfig": "tsconfig.test.json"}] }` + `testTimeout: 60000`

### Known Blocked Updates (as of 2026-05-24)
- **eslint 9.x -> 10.x**: Still blocked by `@lenne.tech/eslint-config-ts@2.1.4` using internal bundled `@typescript-eslint/utils` incompatible with ESLint 10 API (`Class extends value undefined` error). ESLint is pinned at **9.39.4** (latest 9.x). `@lenne.tech/eslint-config-ts` is STILL at 2.1.4 (peer dep `eslint: >=9.26.0` but bundled estree breaks on 10). If a version >2.1.4 supporting ESLint 10 releases, this can be unblocked.
- **@types/jsdom 28.0.1 -> 28.0.3**: BLOCKED (2026-05-24). The 28.0.2+ patches bump `parse5` dep from `^7.0.0` to `^8.0.0`. parse5@8.x type decls use `entities/decode` subpath exports that fail under the project's `moduleResolution: node10` (TS2307 "Cannot find module 'entities/decode'"). Keep @types/jsdom pinned at **28.0.1** (parse5@7.3.0) until tsconfig moves to node16/nodenext/bundler resolution. Note: runtime `jsdom@29.1.1` itself pulls parse5@8.0.1 but that's fine — tsc only resolves the @types/jsdom declaration path.

### Maintenance Patterns
- `find-file-up` should NOT be a direct dependency (unused in source, only transitive via `@lenne.tech/cli-plugin-helper`)
- `@types/lodash` belongs in `devDependencies` (not `dependencies`) - lodash itself stays in dependencies
- `pretty-quick` and `path-exists-cli` are unused (not used in src, tests, extras, or husky hooks)
- `apisauce`, `ejs`, `cross-spawn` overrides were unnecessary - packages already provide correct versions
- `open` package is imported via dynamic `import('open')` - not detected by static grep; it IS used at runtime
- `ts-node` is a runtime dependency (required in `bin/lt` for dev mode) - keep in `dependencies`
- `typescript` IS a runtime dependency (imported as `import * as ts from 'typescript'` in `src/extensions/server.ts` line 6, used at runtime for `ts.readConfigFile()`, `ts.sys.readFile`) - MUST stay in `dependencies`, NOT `devDependencies`
- `axios` IS used directly in `src/lib/nuxt-base-components.ts` - must be a direct `dependencies` entry (not just transitive)
- `ejs` IS used directly in `src/commands/completion.ts` - moved to `devDependencies` with `@types/ejs` (gluegun provides ejs at runtime when CLI is installed via npm)
- `@typescript-eslint/eslint-plugin`, `@typescript-eslint/parser`, `eslint-config-prettier` REMOVED from devDependencies on 2026-05-10: they are bundled as direct deps inside `@lenne.tech/eslint-config-ts@2.1.4` (versions 8.46.1 and 10.1.8 respectively). The eslint config (`eslint.config.mjs`) only does `import typescript from '@lenne.tech/eslint-config-ts'`; it never imports these packages directly. Adding them at the top level was dead weight that npm hoisted parallel to the bundled versions. Re-add ONLY if `eslint.config.mjs` ever needs to reference them directly.
- `@lenne.tech/npm-package-helper` is used by `extras/sync-version.mjs` which is invoked from `.husky/pre-commit` - keep as devDep
- `defuddle` 0.x bumps (e.g. 0.17.0 → 0.18.1) appear safe; the public API (`new Defuddle(doc, opts)` from `src/lib/crawler.ts`) remained stable through 0.18.1 with all 271 tests green

### Remaining Overrides (still needed)
- `semver@*: 7.8.1` - force latest semver 7.x across all sub-deps (gluegun@5.2.2 pins semver 7.7.0 exactly, which is stale). Bumped 7.7.4 -> 7.8.1 on 2026-05-24 (7.8.0 added `truncate` fn, 7.8.1 bug fixes; no breaking changes).
- `brace-expansion@5.0.2 - 5.0.5: 5.0.6` - ADDED 2026-05-24. Security fix GHSA-jxxr-4gwj-5jf2 (DoS via large numeric range defeating `max` protection). Three nested 5.0.5 instances remained under minimatch within glob, @ts-morph/common, @typescript-eslint/typescript-estree. `npm audit fix` alone did NOT clear them (deep transitives). Range-on-LEFT + fixed-target-RIGHT override resolves to 0 vulnerabilities. Remove once those parents resolve minimatch to brace-expansion >=5.0.6 naturally.

### Overrides Removed
- `flatted@*: 3.4.2` - REMOVED (2026-04-04): flatted 3.4.2 is now the latest stable version AND what npm naturally resolves for `^3.2.9`; the override was redundant.
- `follow-redirects@<1.16.0: 1.16.0` - REMOVED (2026-04-17): follow-redirects@1.16.0 is the latest version AND axios@1.15.0 requires `^1.15.11` which npm naturally resolves to 1.16.0. Override was redundant.

### Pre-existing Test Failure (do NOT fix)
- None currently (all 368 tests in 35 suites passing as of 2026-05-24)

### Test Baseline & Protected package.json (as of 2026-05-24)
- `npm test` baseline = **368 passed, 0 skipped, 35 suites**. Jest config now has `testMatch: ["<rootDir>/*.test.ts"]` so `*.manual.ts` files are EXCLUDED from `npm test`.
- Service/OS-dependent tests were renamed `*.test.ts` -> `*.manual.ts` and run via `npm run test:manual` / `npm run test:e2e:service`. These are NOT part of the npm test baseline.
- When editing package.json, touch ONLY `dependencies`/`devDependencies`/`overrides`/`//overrides`. NEVER touch `scripts` (esp. `test:manual`, `test:e2e:service`), `jest` (esp. `testMatch`), or `files`.
- npm install rewrites/re-sorts package.json on every `npm install -E ...` — re-Read the overrides region before each Edit.

### No pnpm/resolutions block in CLI repo
- The CLI repo's own package.json has NO `pnpm` block and NO `resolutions` block (only npm `overrides`). The `pnpm` block discussed in skill docs concerns GENERATED target projects, not this repo.

### Husky Hooks
- `.husky/pre-commit`: sync-version + lint
- `.husky/pre-push`: lint + test

### ESLint Perfectionist Rules (relevant for new files)
- `hoist-workspace-pnpm-config.ts` lint pattern: interfaces/types must be in alphabetical order, exported functions before non-exported, template literals required (no string concatenation)
