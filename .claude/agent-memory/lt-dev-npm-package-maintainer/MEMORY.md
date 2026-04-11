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
- Updated to TypeScript 6.0.2 (from 5.9.3)
- `tsconfig.json`: Changed `moduleResolution: "node"` → `"node10"` + added `"ignoreDeprecations": "6.0"`, added explicit `"rootDir": "src"`
- Created `tsconfig.test.json` (extends tsconfig.json) with `rootDir: "."` to cover both `src/` and `__tests__/`
- Jest config changed from `preset: "ts-jest"` to explicit `transform: { "^.+\\.tsx?$": ["ts-jest", {"tsconfig": "tsconfig.test.json"}] }` to avoid deprecation warning

### Known Blocked Updates (as of 2026-04-04)
- **eslint 9.x -> 10.x**: Still blocked by `@lenne.tech/eslint-config-ts@2.1.4` using internal bundled `@typescript-eslint/utils` incompatible with ESLint 10 API (`Class extends value undefined` error). ESLint is pinned at **9.39.4** (latest 9.x). If `@lenne.tech/eslint-config-ts` releases a version >2.1.4 that supports ESLint 10, this can be unblocked.

### Maintenance Patterns
- `find-file-up` should NOT be a direct dependency (unused in source, only transitive via `@lenne.tech/cli-plugin-helper`)
- `@types/lodash` belongs in `devDependencies` (not `dependencies`) - lodash itself stays in dependencies
- `pretty-quick` and `path-exists-cli` are unused (not used in src, tests, extras, or husky hooks)
- `apisauce`, `ejs`, `cross-spawn` overrides were unnecessary - packages already provide correct versions
- `open` package is imported via dynamic `import('open')` - not detected by static grep; it IS used at runtime
- `ts-node` is a runtime dependency (required in `bin/lt` for dev mode) - keep in `dependencies`
- `typescript` is a runtime dependency (imported in `src/extensions/server.ts`) - keep in `dependencies`
- `axios` IS used directly in `src/lib/nuxt-base-components.ts` - must be a direct `dependencies` entry (not just transitive)
- `ejs` IS used directly in `src/commands/completion.ts` - must be a direct `dependencies` entry (not just transitive via gluegun)

### Remaining Overrides (still needed)
- `semver@*: 7.7.4` - force latest semver across all sub-deps (gluegun@5.2.2 bundles semver 7.7.0 without override)

### Overrides Removed
- `flatted@*: 3.4.2` - REMOVED (2026-04-04): flatted 3.4.2 is now the latest stable version AND what npm naturally resolves for `^3.2.9`; the override was redundant.

### Pre-existing Test Failure (do NOT fix)
- None currently (all 137 tests passing as of 2026-04-11)

### Husky Hooks
- `.husky/pre-commit`: sync-version + lint
- `.husky/pre-push`: lint + test
