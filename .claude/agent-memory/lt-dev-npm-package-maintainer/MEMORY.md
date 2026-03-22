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
- Config: `eslint.config.mjs`, `tsconfig.json`

### Known Blocked Updates (as of 2026-03-22)
- **eslint 9.x -> 10.x**: Blocked by `@lenne.tech/eslint-config-ts` using internal bundled `@typescript-eslint/utils` incompatible with ESLint 10 API (`Class extends value undefined` error). ESLint is pinned at **9.39.4** (latest 9.x). If `@lenne.tech/eslint-config-ts` releases a version >2.1.4 that supports ESLint 10, this can be unblocked.

### Maintenance Patterns
- `find-file-up` should NOT be a direct dependency (unused in source, only transitive via `@lenne.tech/cli-plugin-helper`)
- `@types/lodash` belongs in `devDependencies` (not `dependencies`) - lodash itself stays in dependencies
- `pretty-quick` and `path-exists-cli` are unused (not used in src, tests, extras, or husky hooks)
- `apisauce`, `ejs`, `cross-spawn` overrides were unnecessary - packages already provide correct versions
- `open` package is imported via dynamic `import('open')` - not detected by static grep; it IS used at runtime
- `ts-node` is a runtime dependency (required in `bin/lt` for dev mode) - keep in `dependencies`
- `typescript` is a runtime dependency (imported in `src/extensions/server.ts`) - keep in `dependencies`

### Remaining Overrides (still needed)
- `semver@*: 7.7.4` - force latest semver across all sub-deps (gluegun bundles 7.7.0 without override)
- `flatted@*: 3.4.2` - security fix for CVE in flatted <=3.4.1 (GHSA-rf6f-7fwh-wjgh, prototype pollution); 3.4.2 is the fixed version. Used by eslint -> file-entry-cache -> flat-cache.

### Pre-existing Test Failure (do NOT fix)
- `database-commands.test.ts` - qdrant stats test can be flaky when run with full suite (timing/port issue), passes in isolation. Not related to dependencies.

### Husky Hooks
- `.husky/pre-commit`: sync-version + lint
- `.husky/pre-push`: lint + test
