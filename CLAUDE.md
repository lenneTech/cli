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

### Local dev orchestration (`lt dev`) — key touchpoints

Run multiple lt projects in parallel without port collisions or cross-wiring.
**URL-first**: every project gets stable HTTPS URLs (`<slug>.localhost`,
`api.<slug>.localhost`) served by Caddy, which proxies to opaque internal
ports. Developers and Claude Code never see the internal ports.

| Concern | File | Notes |
|---|---|---|
| Identity (slug + subdomains) | `src/lib/dev-identity.ts` | `projectSlug` reads `package.json` "name" (scope stripped, slugified); `buildIdentity` enumerates `projects/api`/`projects/app` (monorepo) or detects `config.env.ts`/`nuxt.config.ts` (standalone). |
| ENV builder | `src/lib/dev-env.ts` | Single source of truth for `BASE_URL`, `APP_URL`, `NUXT_API_URL`, `NUXT_PUBLIC_*`, `NSC__MONGOOSE__URI`, `DATABASE_URL`. **Always URLs, never bare ports.** `NUXT_PUBLIC_API_PROXY=false` because Caddy + cookie-domain make vite-proxy obsolete. |
| Registry + session state | `src/lib/dev-state.ts` | Central registry `~/.lenneTech/projects.json` (override via `LT_DEV_REGISTRY_PATH`); per-project session at `<root>/.lt-dev/state.json`. Atomic writes; PID validation gate via `isValidPid` / `isPidAlive`. |
| Caddy integration | `src/lib/caddy.ts` | One block per project, marked with `# >>> lt-dev:<slug> >>>`/`# <<<`. `upsertProjectBlock` is idempotent; `removeProjectBlock` is a no-op when absent. Caddyfile path overridable via `LT_DEV_CADDYFILE`. The daemon is owned by `lt dev install` (see `dev-service.ts`) — **never** rely on `brew services caddy`: its plist hardcodes `--config /opt/homebrew/etc/Caddyfile` and crash-loops against our location, which is the bug that originally blocked the first real `lt dev install`. |
| Caddy service lifecycle | `src/lib/dev-service.ts` + `src/commands/dev/{install,uninstall}.ts` | Per-OS service runner. macOS: per-user LaunchAgent `~/Library/LaunchAgents/tech.lenne.lt-dev-caddy.plist` via `launchctl bootstrap gui/<uid>`. Linux: `~/.config/systemd/user/lt-dev-caddy.service` via `systemctl --user enable --now`. Render helpers (`renderLaunchAgentPlist`, `renderSystemdUnit`) are pure + unit-tested; side-effecting ops accept an injectable `ShellRunner`. **Critical:** plist sets `HOME=$userHome` env so caddy persists its CA under `~/Library/Application Support/Caddy/`, not the launchd-empty default. `userHome()` is `process.env.HOME || homedir()` because real `os.homedir()` on macOS goes through `getpwuid()` and ignores HOME — required so test files can redirect side-effects to a tmpdir. The `caddy trust` instructions surfaced to users **must** include `-E HOME="$HOME"` for the same reason in sudo context. |
| install↔init auto-chaining | `src/lib/dev-bootstrap.ts` (predicates) + `src/lib/dev-install-helper.ts` (`runInstall`) + `src/lib/dev-migrate-helper.ts` (`runMigrate`/`printMigrateResult`) + `src/commands/dev/{install,init}.ts` | `lt dev init` runs install first when `!isMachinePrepared()`; `lt dev install` runs init after when `isLtDevProject() && !isProjectInitialized()`. Non-recursive by construction: commands call the *helpers*, never each other. Opt-outs: `--skip-install` (init), `--skip-init` (install). `runInstall` must NOT call `process.exit`. |
| Process management | `src/lib/dev-process.ts` | `spawnDetached` keeps the Claude Code session unblocked (logs to `<root>/.lt-dev/{api,app}.log`). `killProcessGroup` uses negative-PID SIGTERM to reach the Nest watcher + Vite + Nuxt children. Single-call `listenSnapshot` for multi-port lsof. Foreground helpers: `runChildInherit` (synchronous-feel child with inherited stdio — build/test runners) and `waitForHttp` (curl-based readiness probe over HTTPS; treats any 1xx-5xx as up). |
| Test session (isolated parallel stack) | `src/lib/dev-test-session.ts` (+ `dev-identity.ts#buildTestIdentity`, `dev-state.ts#TEST_SESSION_FILE`) | `bringUpTestSession` boots a SECOND stack (own URLs `<slug>-test.localhost` / `api.<slug>-test.localhost`, own port band 4500+, own Caddy block `lt-dev:<slug>-test`, own DB `<…>-test`, own session file `state.test.json`, own env bridge `.env.test`, own log files `{api,app}.test.log`) PARALLEL to the dev session — Playwright never touches developer data, and the dev stack keeps running while tests run. API is run **compiled** (`node dist/src/main.js`) for ts-node stability across long suites; falls back to `pnpm start`. `tearDownTestSession` is idempotent + residue-free (registry entry, session file, env bridge, Caddy block all dropped). `lt dev down` also tears down any lingering test stack. The `-test` suffix on the DB matches the TestHelper guard pattern `(-local|-ci|-e2e|-test)$`. |
| Workspace/standalone detection | `src/lib/dev-project.ts` | Reuses `workspace-integration.ts` helpers; never duplicates detection logic. Also exports `apiNeedsPortPatch`/`appNeedsPortPatch`/`deriveDbName`/`deriveTestDbName` (test-DB name is `<…>-test`, distinct from `<…>-local` and the API unit-test DB). |
| Idempotent legacy port patches | `src/lib/dev-patches.ts` | Patches `config.env.ts` (port 3000), `nuxt.config.ts` (port 3001 + vite proxy target), `playwright.config.ts` (`baseURL`/`host`/`url`), and the CLAUDE.md URL block. All return a no-op `PatchResult` for missing files. |
| Detached-spawn binary override | `src/commands/dev/up.ts` | `process.env.LT_PNPM_BIN` overrides the hardcoded `pnpm` binary (corporate / pinned setups, or bun-based projects via wrapper script). |
| Project-local state | `<project>/.lt-dev/{state.json,api.log,app.log,.env}` | Auto-added to `.gitignore` by `lt dev init`. State JSON is schema-validated on load. The `.env` file is the **ENV bridge** (see below). |
| ENV bridge for external tools | `src/lib/dev-env-bridge.ts` | `lt dev up` writes `<root>/.lt-dev/.env`; `lt dev test` writes `<root>/.lt-dev/.env.test` (same shape, test URLs + `LT_DEV_DB_NAME=<…>-test`) so test runners pick up the isolated stack without disturbing the dev `.env`. Both contain all URLs + `NODE_EXTRA_CA_CERTS`. External test runners (Playwright, IDE extensions, custom scripts) load these files via the auto-injected bridge block in `playwright.config.ts` (see `dev-patches.ts#patchPlaywrightConfig`). `lt dev down` + test teardown remove their respective files. |
| One-shot isolated test wrapper | `src/commands/dev/test.ts` | `lt dev test` (App mode, default) brings up an isolated parallel stack via `dev-test-session.ts`, runs `pnpm run test:e2e` with `.env.test` loaded, then tears the stack down. `--keep` leaves the stack up for debugging (stop later with `lt dev test down`). `--debug` sets `PWDEBUG=1` + `HEADED=1`. `--api` skips the stack and runs `pnpm run test:e2e` in `projects/api` (already DB-isolated). Forwards args after `--`. Signal-safe: SIGINT/SIGTERM trigger teardown before exit. |

**Lifecycle:**
1. **`lt dev install [--skip-init]`** — one-time per machine. Verifies Caddy is on PATH (suggests `brew install caddy`), creates `~/.lenneTech/Caddyfile` stub, writes + bootstraps the dedicated LaunchAgent / systemd-user unit, waits up to 8s for port 2019, validates the Caddyfile. Surfaces `sudo -E HOME="$HOME" caddy trust` for the CA install. **Auto-chains:** when run inside an lt-dev-capable project that isn't initialized yet, runs `lt dev init` afterwards (`--skip-init` opts out).
2. **`lt dev uninstall [--purge] [--noConfirm]`** — symmetric counterpart. Boots out the LaunchAgent / systemd unit, removes the unit file, optionally purges the Caddyfile + caddy logs.
3. **`lt dev init [--skip-install]`** (alias `migrate`, `m`) — once per project. Idempotent ENV-aware patches + CLAUDE.md URL block + registry entry + `.gitignore`. **Auto-chains:** when the machine isn't prepared yet, runs `lt dev install` first (`--skip-install` opts out).

**Mutual install↔init auto-chaining (no infinite regress):** the two commands prepare each other's precondition, but the chain is **one hop deep and structurally non-recursive** because each command calls the *helper* of the other (`runInstall` / `runMigrate` in `dev-install-helper.ts` / `dev-migrate-helper.ts`), never the other command. Pure predicates in `src/lib/dev-bootstrap.ts` (`isMachinePrepared`, `isProjectInitialized`, `isLtDevProject`) gate the decision and make re-runs no-ops. `runInstall` never calls `process.exit` (the command decides the exit code).
4. **`lt dev up`** — registers Caddy block, allocates internal ports (start 4000), spawns API+App detached.
5. **`lt dev down`** — SIGTERM the process group, removes Caddy block.
6. **`lt dev status [--all]`** — current project or all registered.
7. **`lt dev doctor`** — Caddy + CA + DNS + port diagnostics (checks our LaunchAgent, **not** `brew services caddy`).
8. **`lt dev test [--api] [--keep] [--debug] [-- args]`** / **`lt dev test down`** — App mode (default) brings up an ISOLATED parallel stack (`<slug>-test.localhost` / `api.<slug>-test.localhost`, DB `<…>-test`), runs Playwright against it, then tears it down. The dev `lt dev up` session is never touched. `--keep` leaves the test stack up for debugging; `lt dev test down` tears a leftover stack down. `--api` runs the API E2E suite in the api project instead (already DB-isolated, no stack needed). Forwards args after `--` to the test runner.
9. **`lt dev tunnel [--api]`** — Cloudflare Quick Tunnel: foreground `cloudflared tunnel --url https://<slug>.localhost --http-host-header <slug>.localhost --no-tls-verify`, prints the public `*.trycloudflare.com` URL. The host-header rewrite is mandatory — without it Caddy's vhost match fails for the random tunnel URL. Tunnels only expose ONE subdomain at a time; start a second `lt dev tunnel --api` in another shell for full external usage.

**Cross-wiring protection:** API gets `APP_URL` so Better-Auth `trustedOrigins` only includes its own App; App gets `BASE_URL` so it only talks to its own API; localStorage is namespaced via `NUXT_PUBLIC_STORAGE_PREFIX=<slug>`; Mongo URI is namespaced via `NSC__MONGOOSE__URI=mongodb://127.0.0.1/<dbName>`. The isolated `lt dev test` stack reuses the same protections under a `-test` suffix (slug `<…>-test`, DB `<…>-test`, prefix `<…>-test`, port band 4500+) so it can run literally side-by-side with the dev session.

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

### Manual (service/OS-dependent) tests: `*.manual.ts` <!-- Added: 2026-05-24 -->
`npm test` must report **zero skipped tests**. Tests that need a real
external service or OS integration (a live Qdrant/MongoDB, real
`launchctl` + `caddy`, etc.) must NOT use `test.skip` inside a normal
`*.test.ts` — a conditional skip still shows up as "skipped" and can be
unsafe (e.g. `dev-service-e2e` would `launchctl bootout` the user's live
`lt dev` daemon via the shared label). Instead:
- Name the file `*.manual.ts`. Jest's `testMatch`
  (`<rootDir>/*.test.ts`, set in `package.json#jest`) only matches
  top-level `*.test.ts`, so `*.manual.ts` is **excluded, not skipped**.
  (That `testMatch` is also why a stray `__tests__/temp-*/…/*.test.ts`
  left by an aborted run is never collected.)
- Run them on demand: `npm run test:manual` (all `*.manual.ts`) or a
  specific script like `npm run test:e2e:service`.
- Keep an in-file guard (platform/service/real-daemon checks) so the
  manual run self-skips safely instead of damaging a live setup.

### gluegun `patching.update` parses `.json` files <!-- Added: 2026-05-24 -->
`patching.update(path, cb)` hands `cb` a **parsed object** for any path
ending in `.json`, and a **string** otherwise (see
`node_modules/gluegun/build/toolbox/patching-tools.js#readFile`). A
String-based callback on a `.json` file (`(c: string) => c.replace(...)`)
throws `c.replace is not a function` at runtime — and TypeScript does NOT
catch it (the gluegun signature is `any`). For `.json`, mutate the object
(`(cfg) => { cfg.x = y; return cfg; }`) or, for a reusable rename, use
`src/lib/package-name.ts#setPackageName` (reads/writes via `filesystem`,
fully unit-tested).

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
