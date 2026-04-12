# lenne.tech CLI

## WHAT: Project Overview

A TypeScript CLI built with [Gluegun](https://infinitered.github.io/gluegun/) for fullstack development with NestJS backends and Nuxt frontends.

```
src/
├── commands/          # CLI commands (organized by category)
├── extensions/        # Toolbox extensions (config.ts, git.ts, etc.)
├── interfaces/        # TypeScript interfaces
└── templates/         # EJS templates for code generation

schemas/               # JSON Schema for IDE support
docs/                  # Command and configuration docs
__tests__/             # Jest tests
```

## WHY: Purpose

Automates repetitive fullstack development tasks: project scaffolding, module generation, git workflows, deployment setup.

## HOW: Development Workflow

### Before Making Changes
1. Read 2-3 similar commands in `src/commands/` first
2. Check @src/interfaces/lt-config.interface.ts for config structure
3. Run `npm test` after changes

### Common Commands
```bash
npm test                    # Run all tests
npm test -- -t "pattern"    # Run specific tests
npm run lint                # Check code style
npm run build               # Compile TypeScript
```

---

## Critical Rules

**IMPORTANT: Follow these rules exactly.**

### Command Structure
- Description: MAX 30 chars, no parameter hints, start with verb
- Alias: Single letter preferred
- Return: ALWAYS return descriptive string for tests
- Exit: Use `process.exit()` only if NOT from menu

```typescript
const Command: GluegunCommand = {
  alias: ['x'],
  description: 'Short action description',  // MAX 30 chars!
  name: 'command-name',
  run: async (toolbox: ExtendedGluegunToolbox) => {
    // Implementation...

    if (!toolbox.parameters.options.fromGluegunMenu) {
      process.exit();
    }
    return `completed action for ${name}`;  // REQUIRED for tests
  },
};
```

### Config Priority (highest to lowest)
1. CLI parameters (`parameters.options.xxx`)
2. Command config (`ltConfig?.commands?.category?.command?.option`)
3. Global defaults (`config.getGlobalDefault(ltConfig, 'option')`)
4. Interactive input or hardcoded defaults

### Adding Config Options
Update ALL of these files:
1. `src/interfaces/lt-config.interface.ts`
2. `schemas/lt.config.schema.json`
3. `src/commands/config/validate.ts` KNOWN_KEYS
4. `docs/lt.config.md`

### noConfirm Pattern
```typescript
const noConfirm = config.getValue({
  cliValue: parameters.options.noConfirm,
  configValue: ltConfig?.commands?.git?.create?.noConfirm,
  defaultValue: false,
  globalValue: config.getGlobalDefault(ltConfig, 'noConfirm'),
});

if (!noConfirm && !(await confirm('Proceed?'))) return;
```

### Templates
**IMPORTANT: Use EJS templates for multi-line output**, not string arrays.
- Templates location: `src/templates/`
- See @src/templates/completion/ for examples
- `src/templates/vendor-scripts/` ships three scripts
  (`check-vendor-freshness.mjs`, `sync-from-upstream.ts`,
  `propose-upstream-pr.ts`) that are copied verbatim into vendor-mode
  projects during `convertCloneToVendored`. They are **NOT** linted by
  the CLI's own ESLint (see `eslint.config.mjs` ignores).

### Vendor vs npm mode — key touchpoints

Backend api projects created by the CLI run in one of two framework
consumption modes. Every code path that generates or reads framework
source code must be mode-aware:

| Concern | File | Notes |
|---|---|---|
| Detection | `src/lib/framework-detection.ts` | `isVendoredProject()`, `detectFrameworkMode()`, `getFrameworkImportSpecifier()`, `getFrameworkRootPath()`, `findProjectDir()` |
| Init (fullstack) | `src/commands/fullstack/init.ts` | `--framework-mode npm\|vendor`, `--framework-upstream-branch`, `--dry-run`; resolves mode and plumbs to `setupServerForFullstack` |
| Init (standalone) | `src/commands/server/create.ts` | Same flags; plumbs to `setupServer` |
| Vendor transform | `src/extensions/server.ts#convertCloneToVendored` | Clones upstream nest-server, flatten-fixes core, rewrites consumer imports (ts-morph), merges deps dynamically, writes VENDOR.md, copies vendor scripts, hooks check:vendor-freshness |
| Vendor core essentials | `src/extensions/server.ts#restoreVendorCoreEssentials` | Restores graphql-* deps after processApiMode REST strips them |
| Runtime-helper config | `src/config/vendor-runtime-deps.json` | Upstream devDeps that must be promoted to dependencies (e.g. `find-file-up`) |
| Template imports | `src/templates/nest-server-{module,object,tests}/*.ejs` | All use `<%= props.frameworkImport %>` placeholder — the generator computes the correct relative path per file |
| Generators | `src/commands/server/{module,object,test,add-property}.ts` | Inject `frameworkImport` via `importFor(target)` helper; `add-property` looks up existing imports by both specifier forms |
| Permissions scanner | `src/commands/server/permissions.ts` | `loadScanner()` falls back to `dist/src/core/modules/permissions/` in vendor mode |
| Update command | `src/commands/fullstack/update.ts` | Detects mode and prints the correct `/lt-dev:backend:…` agent entry point |
| Status command | `src/commands/status.ts` | Reports `Framework: npm (...)` or `Framework: vendor (src/core/, VENDOR.md)` |
| Integration test | `scripts/test-vendor-init.sh` | 4 scenarios × ~27 assertions each + dry-run pre-check = 108 total |

### Vendor vs npm mode — frontend key touchpoints

Frontend (Nuxt) projects can also run in npm or vendor mode for
`@lenne.tech/nuxt-extensions`. The vendor location is `app/core/`
instead of `src/core/`. No flatten-fix is needed.

| Concern | File | Notes |
|---|---|---|
| Detection | `src/lib/frontend-framework-detection.ts` | `isVendoredAppProject()`, `detectFrontendFrameworkMode()`, `getFrontendFrameworkRootPath()`, `findAppDir()` |
| Init (fullstack) | `src/commands/fullstack/init.ts` | `--frontend-framework-mode npm\|vendor`; calls `convertAppCloneToVendored` after frontend setup |
| Vendor transform | `src/extensions/frontend-helper.ts#convertAppCloneToVendored` | Clones upstream nuxt-extensions, copies module.ts + runtime/, rewrites nuxt.config.ts + consumer imports (regex), merges deps, writes VENDOR.md |
| Reverse transform | `src/extensions/frontend-helper.ts#convertAppToNpmMode` | Restores npm dep, rewrites imports back, deletes app/core/ |
| Convert command | `src/commands/frontend/convert-mode.ts` | `lt frontend convert-mode --to vendor\|npm` |
| Update command | `src/commands/fullstack/update.ts` | Detects frontend mode, prints mode-specific instructions |
| Status command | `src/commands/status.ts` | Reports frontend framework mode |
| Runtime-helper config | `src/config/vendor-frontend-runtime-deps.json` | Currently empty (nuxt-extensions has minimal deps) |

**Golden rule:** Never hard-code `'@lenne.tech/nest-server'` as a
specifier in generated code or `node_modules/@lenne.tech/nest-server/`
as a path in command logic. Always derive the specifier via
`getFrameworkImportSpecifier(projectDir, sourceFilePath)` and the root
path via `getFrameworkRootPath(projectDir)`.

**When adding a new `lt server` subcommand:** read existing generators
(`module.ts`, `object.ts`, `test.ts`) first — they already do the
mode detection + import-specifier computation correctly. Copy the
`importFor = (target: string) => getFrameworkImportSpecifier(path, target)`
pattern and inject `frameworkImport` into every `template.generate`
props block.

**Regression safety:** before releasing a new CLI version, run
`pnpm run test:vendor-init` to verify all 4 init scenarios still pass.
The script creates fresh projects in `/tmp/lt-it/*`, runs the full
init → generate → tsc → build → migrate:list pipeline, and asserts
108 invariants. Runs in ~15-20 minutes on a decent machine.

---

## Gotchas & Learnings

### TypeScript Strict Mode
Unused variables cause build failures. Only destructure what you use:
```typescript
// BAD: const { config, filesystem } = toolbox;
// GOOD: const { filesystem } = toolbox;
```

### ESLint Perfectionist Rules
Functions and types must be alphabetically sorted. Build fails otherwise.

### Alias Conflicts
Conflicts only occur at the **same hierarchical level**:
```
OK - different parents:
  cli/rename.ts    ['r']  → lt cli r
  npm/reinit.ts    ['r']  → lt npm r

CONFLICT - same level:
  cli/cli.ts       ['c']  → lt c
  claude/claude.ts ['c']  → lt c
```
**Rule**: Only change aliases if conflict at same level.

### Config File Priority
`lt.config.json` > `lt.config.yaml` > `lt.config`

### Test Warnings
Use `suppressWarnings: true` when creating Config instances in tests.

### Running lt CLI Commands (AI Agent Usage)
When executing `lt` commands, prefer explicit parameters over interactive prompts where possible. The CLI will show a hint in non-interactive mode, but you can avoid it by providing the required flags:
```bash
# GOOD - explicit parameters
lt fullstack init --name my-project --frontend nuxt --api-mode Rest --noConfirm
lt server create --name my-server --api-mode GraphQL --noConfirm
lt server module --name MyModule --controller auto --noConfirm

# BAD - will enter interactive mode
lt fullstack init
lt server create
lt server module
```
Key flags: `--noConfirm` skips all confirmations, `--name` sets the project/module name. See `docs/commands.md` for all available parameters per command.

---

## Quick Checklist

### New Command
- [ ] Read similar commands first
- [ ] Description max 30 chars
- [ ] Implement config priority
- [ ] Support noConfirm if has confirmations
- [ ] Return descriptive string
- [ ] Handle process.exit correctly
- [ ] Update docs/commands.md
- [ ] Run `npm test`

### New Config Option
- [ ] Update lt-config.interface.ts
- [ ] Update lt.config.schema.json
- [ ] Update validate.ts KNOWN_KEYS
- [ ] Update docs/lt.config.md

---

## Self-Maintenance

Add new learnings to "Gotchas & Learnings" when discovering patterns or fixing bugs.
Use format: `### Title <!-- Added: YYYY-MM-DD -->`
