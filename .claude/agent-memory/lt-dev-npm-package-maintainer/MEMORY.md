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

### Known Blocked Updates (as of 2026-03-09)
- **eslint 9.x -> 10.x**: Blocked by `@lenne.tech/eslint-config-ts` using internal bundled `@typescript-eslint/utils` incompatible with ESLint 10 API (`Class extends value undefined` error)

### Maintenance Patterns
- `find-file-up` should NOT be a direct dependency (unused in source, only transitive via `@lenne.tech/cli-plugin-helper`)
- `@types/lodash` belongs in `devDependencies` (not `dependencies`) - lodash itself stays in dependencies
- `pretty-quick` and `path-exists-cli` are unused (not used in src, tests, extras, or husky hooks)
- `apisauce`, `ejs`, `cross-spawn` overrides were unnecessary - packages already provide correct versions

### Remaining Overrides (still needed)
- `semver@*: 7.7.4` - force latest semver across all sub-deps

### Pre-existing Test Failure (do NOT fix)
- `database-commands.test.ts` - qdrant stats test fails (pre-existing, not related to dependencies)

### Husky Hooks
- `.husky/pre-commit`: sync-version + lint
- `.husky/pre-push`: lint + test
