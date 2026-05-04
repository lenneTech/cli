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
| Vendor E-Mail templates | `src/extensions/server.ts#convertCloneToVendored` (copy mapping) | Upstream `src/templates/` is placed at `<project>/src/templates/` — deliberately **outside** `src/core/` — because the runtime resolver in `src/core/modules/better-auth/core-better-auth-email-verification.service.ts` uses `__dirname + '../../../templates'` and must match the relative layout of npm mode. Also keeps project-specific E-Mail customization outside the vendored framework tree. Never move these under `src/core/templates/`. |
| Vendor markdown helper | `src/lib/markdown-table.ts` | `formatMarkdownTable(headers, rows)` produces oxfmt-compatible padded-column Markdown tables for VENDOR.md. Remember: no trailing newline in `.md` files (oxfmt strips it), so omit the final `''` before `.join('\n')`. |
| Template imports | `src/templates/nest-server-{module,object,tests}/*.ejs` | All use `<%= props.frameworkImport %>` placeholder — the generator computes the correct relative path per file |
| Generators | `src/commands/server/{module,object,test,add-property}.ts` | Inject `frameworkImport` via `importFor(target)` helper; `add-property` looks up existing imports by both specifier forms |
| Permissions scanner | `src/commands/server/permissions.ts` | `loadScanner()` falls back to `dist/src/core/modules/permissions/` in vendor mode |
| Update command | `src/commands/fullstack/update.ts` | Detects mode and prints the correct `/lt-dev:backend:…` agent entry point |
| Status command | `src/commands/status.ts` | Reports `Framework: npm (...)` or `Framework: vendor (src/core/, VENDOR.md)` |
| Integration test | `scripts/test-vendor-init.sh` | 4 scenarios (1 npm + 3 vendor), ~120 assertions total incl. dry-run pre-check; vendor scenarios additionally assert Modification Policy content + template path (`src/templates/` present, `src/core/templates/` absent) |

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

### Incremental fullstack & workspace gate — key touchpoints

The fullstack workflow ships three "create" entry points that share
shape but target different starting states. The 4th column lists the
flag every command exposes for AI agents.

| Command | Use when | Output | Common flags |
|---|---|---|---|
| `lt fullstack init` | Fresh dir, want a new monorepo | `lt-monorepo` clone with `projects/api/` + `projects/app/` (auto-delegates to `add-api`/`add-app` if cwd is already a workspace with one half present) | `--name --frontend --api-mode --framework-mode --frontend-framework-mode --next --dry-run --noConfirm` |
| `lt fullstack add-api` | Workspace with `projects/app/` only | Adds `projects/api/` | `--api-mode --framework-mode --framework-upstream-branch --api-branch --api-copy --api-link --next --dry-run --skip-install --noConfirm` |
| `lt fullstack add-app` | Workspace with `projects/api/` only | Adds `projects/app/` | `--frontend --frontend-framework-mode --frontend-branch --frontend-copy --frontend-link --next --dry-run --skip-install --noConfirm` |

The standalone scaffolders are workspace-aware: when run inside a
fullstack workspace they refuse non-interactive callers (KI/CI
default — fail loud) and steer them at the matching `add-*` command.

| Standalone command | In-workspace replacement | Refusal trigger |
|---|---|---|
| `lt server create` | `lt fullstack add-api` | non-interactive (TTY off OR `--noConfirm`) without `--force` |
| `lt frontend nuxt` | `lt fullstack add-app --frontend nuxt` | same |
| `lt frontend angular` | `lt fullstack add-app --frontend angular` | same |

| Concern | File | Notes |
|---|---|---|
| Workspace marker detection | `src/lib/workspace-integration.ts#hasWorkspaceMarker` | Recognises `pnpm-workspace.yaml`, `package.json#workspaces` (npm/yarn/bun, both array and `{packages:[]}` shape), and `projects/` directory |
| Layout inspection | `src/lib/workspace-integration.ts#detectWorkspaceLayout` | Reports `{ hasWorkspace, hasApi, hasApp }`. Used by `init` for auto-delegation and by the gate for the "already exists" hint |
| Upward search | `src/lib/workspace-integration.ts#findWorkspaceRoot` | Walks parent dirs (max 6 levels) looking for any marker — used by sub-project detection |
| Sub-project detection | `src/lib/workspace-integration.ts#detectSubProjectContext` | Returns `{ kind: 'api'\|'app', workspaceRoot, subProjectDir }` when cwd is inside `projects/api/` or `projects/app/` |
| Non-interactive heuristic | `src/lib/workspace-integration.ts#isNonInteractive` | True when `--noConfirm` OR stdin is not a TTY — catches AI agents that don't pass `--noConfirm` |
| Gate decision | `src/lib/workspace-integration.ts#shouldProceedAsStandalone` | Pure function — input: `{ force, nonInteractive, projectKind, suggestion, userConfirmed? }`, output: `{ proceed, reason? }` |
| Gate runner | `src/lib/workspace-integration.ts#runStandaloneWorkspaceGate` | Side-effecting wrapper: prints, prompts, errors, calls `process.exit(1)` on refusal. Used identically by all three standalone commands |
| `lt status` | `src/commands/status.ts` | Reports the workspace layout (`Workspace: yes`, `projects/api`, `projects/app`) so users can quickly see what's missing |
| API/app bridges | `src/lib/workspace-integration.ts#writeApiConfig`, `runExperimentalNestBaseRename` | Glue between `extensions/server.ts` primitives and `lt.config.json` / `bun run rename` post-processing in `add-api` |

**Override mechanism for power users:** every standalone command
accepts `--force` to bypass the workspace gate. Combine with
`--noConfirm` (`--noConfirm --force`) to silently produce a
side-by-side standalone clone inside an existing workspace. AI agents
should not pass `--force` unless the user explicitly asked for a
side-by-side standalone tree.

### Vendor Modification Policy (for CLI-generated content)

The vendored core (`projects/api/src/core/` or `projects/app/app/core/`)
exists as a **comprehension aid** for Claude Code, not as a fork. Any
code the CLI generates or scaffolds into a user project must respect
this separation:

- **Never** generate project-specific code (modules, objects, tests)
  into `src/core/` or `app/core/`. Those trees mirror upstream and
  should only change for generally-useful reasons (bugfixes, security
  fixes, broad enhancements) — which flow back upstream via
  `/lt-dev:backend:contribute-nest-server-core` or
  `/lt-dev:frontend:contribute-nuxt-extensions-core`.
- Generators (`server module`, `server object`, `server test`,
  `server add-property`) always emit into project code outside of
  `src/core/` and import from the framework (specifier resolved via
  `getFrameworkImportSpecifier`).
- When adding new commands that touch vendored trees, keep the mental
  model: **project code extends, inherits from, or overrides core —
  it never patches core in place for project-specific needs.**

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
~120 invariants. Runs in ~15-20 minutes on a decent machine. Also run
`pnpm run test:frontend-vendor-init` to cover the frontend-vendor and
fullstack-both-vendor paths.

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
