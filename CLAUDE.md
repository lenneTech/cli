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
- `src/templates/vendor-scripts/` ships `migrate-store.js`, which
  `convertCloneToVendored` writes into a vendored project's
  `migrations-utils/migrate.js` at conversion time (probes for the compiled
  migration helper, else registers ts-node, then resolves the Mongo URI via the
  starter's `migrations-utils/mongo-uri.js`) — and which
  `healVendorMigrateStore` (`src/lib/heal-vendor-migrate-store.ts`, run from
  `lt fullstack update`) re-writes for older projects still carrying an
  unguarded top-level ts-node require. It is **NOT** linted by the CLI's own
  ESLint (the whole `src/templates/**` tree is ignored — see
  `eslint.config.mjs`). The former three maintenance scripts
  (`check-vendor-freshness.mjs`, `sync-from-upstream.ts`,
  `propose-upstream-pr.ts`) were removed: the freshness check is now an
  inline `check:vendor-freshness` one-liner in the generated `package.json`,
  and the sync / contribute flows are handled by the
  `nest-server-core-updater` / `nest-server-core-contributor` agents.
- `src/templates/check/` ships the report-driven check runner
  (`check.mjs` + the modules it imports, currently `build-test-gate.mjs`
  and `lib/{ansi,audit-report,workspace-packages}.mjs`).
  `lt fullstack init` delivers it via the `lt-monorepo` clone;
  `lt fullstack update` installs/refreshes it through
  `healCheckWrapper` (`src/lib/heal-check-wrapper.ts`), and
  `lt dev doctor` reports drift over the same set. Byte-identical to
  `lt-monorepo/scripts/` — **fix both repos or they silently diverge**.
  They did: until 2026-09-14 the copy here lagged two lt-monorepo releases
  behind, and because heal treats the CLI copy as canonical, every
  `lt fullstack update` put the OLDER wrapper into a freshly created project.
  `lt-monorepo` is the upstream. **Never edit the copy here**: change
  lt-monorepo, then `npm run sync:check-template -- --ref <tag|sha>`
  (`--from <local clone>` for an unpushed commit). It copies `check.mjs` plus
  its import closure and writes `lt-monorepo-pin.json` (commit, marker
  version, sha256 per file); `__tests__/check-template-sync.test.ts` fails on
  any byte that differs from that pin, without network. Two guards, two jobs:
  the pin stops drift here, the `// @lt-check-wrapper <version>` marker (line 2,
  same regex as lt-monorepo's `check-wrapper-version.cjs#MARKER_RE`) stops damage
  in projects. It names the lt-monorepo RELEASE, never a project's version. Heal
  replaces a project wrapper only when the bundled release is NEWER or the
  project wrapper is unmarked (markers start at the pinned commit, so every
  unmarked wrapper predates the pin). A newer release, an unrecognised marker,
  or the SAME release with different content is kept — the marker only moves on
  a release, so lt-monorepo main after v3.12.0 still reads 3.12.0, and
  overwriting on a tie would turn later fixes back. Doctor reports those cases
  as INFO via the same `keptWrapperReason`, never as "run lt fullstack update".
  Like the rest of `src/templates/**` it is ESLint-exempt, so its `.mjs`
  files get no lint/tsc coverage at all; the guards that do cover them
  are `__tests__/check-template.test.ts` and
  `__tests__/build-test-gate.test.ts`, which load them in a real Node
  ESM child (`__tests__/check-template-esm.ts`) because Jest's transform
  turns `import()` into `require()` and cannot load an `.mjs` at all.
  Mode-agnostic — it neither reads nor generates framework source, so it
  needs no row in the vendor/npm tables below.

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
| Workspace-root normalisation | `src/lib/workspace-integration.ts#finalizeWorkspaceRoot` | Called by all three scaffolders. Hoists pnpm config + the `packageManager` pin, drops nested lockfiles, guarantees a root `.dockerignore`. Returns `{ conflicts }` — disagreements it refuses to resolve silently — which callers MUST surface via `reportWorkspaceConflicts` (twice: the first printout is buried by the install output) |

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
| ENV builder | `src/lib/dev-env.ts` | Single source of truth for `BASE_URL`, `APP_URL`, `NUXT_API_URL`, `NUXT_PUBLIC_*`, `NUXT_SESSION_PASSWORD`, `NSC__MONGOOSE__URI`, `DATABASE_URL`. **Always URLs, never bare ports.** `NUXT_PUBLIC_API_PROXY=false` because Caddy + cookie-domain make vite-proxy obsolete. `NUXT_SESSION_PASSWORD` resolves shell export → the app's own `.env` (via the optional `appDir` input) → a fallback derived as `HMAC-SHA256(machine salt, 'lt-dev:session:<slug>')`, 32 hex chars; the salt lives at `~/.lenneTech/dev-session-salt` (0600, override `LT_DEV_SESSION_SALT_PATH`). |
| Registry + session state | `src/lib/dev-state.ts` | Central registry `~/.lenneTech/projects.json` (override via `LT_DEV_REGISTRY_PATH`); per-project session at `<root>/.lt-dev/state.json`. Atomic writes; PID validation gate via `isValidPid` / `isPidAlive`. |
| Caddy integration | `src/lib/caddy.ts` | One block per project, marked with `# >>> lt-dev:<slug> >>>`/`# <<<`. `upsertProjectBlock` is idempotent; `removeProjectBlock` is a no-op when absent. Caddyfile path overridable via `LT_DEV_CADDYFILE`. The daemon is owned by `lt dev install` (see `dev-service.ts`) — **never** rely on `brew services caddy`: its plist hardcodes `--config /opt/homebrew/etc/Caddyfile` and crash-loops against our location, which is the bug that originally blocked the first real `lt dev install`. |
| VS Code memory profile | `src/commands/dev/vscode.ts` + `src/lib/vscode-settings.ts` | `lt dev vscode` (alias `vsc`) tunes the USER `settings.json` of VS Code / Insiders / Cursor / VSCodium. Machine-level, not project-level — no registry or Caddy involvement. JSONC-aware via `jsonc-parser` (lazy-required, since gluegun loads every command on every `lt` run) so comments survive; refuses an unparseable file or a symlink; keeps the FIRST `settings.json.bak`. Object-valued exclude maps are MERGED on apply (user entries win) and SUBTRACTED on `--revert`, so an undo never removes a hand-maintained exclusion. `MEMORY_PROFILE` targets the per-root SEMANTIC TS servers and excludes `**/.nuxt*/**` / `**/.output*/**` (segment globs — the bare names miss `.nuxt-test`); `EXCLUDED_FROM_PROFILE` records three commonly recommended keys that were ruled out, surfaced by `--explain`. `--dry-run` uses presence-as-intent (`isPreventingFlagSet`), not `=== true`, because it PREVENTS a write; `--noConfirm` must be an explicit CLI flag — a repo-local `lt.config.json` must not silence a prompt guarding a machine-global write. |
| Caddy service lifecycle | `src/lib/dev-service.ts` + `src/commands/dev/{install,uninstall}.ts` | Per-OS service runner. macOS: per-user LaunchAgent `~/Library/LaunchAgents/tech.lenne.lt-dev-caddy.plist` via `launchctl bootstrap gui/<uid>`. Linux: `~/.config/systemd/user/lt-dev-caddy.service` via `systemctl --user enable --now`. Render helpers (`renderLaunchAgentPlist`, `renderSystemdUnit`) are pure + unit-tested; side-effecting ops accept an injectable `ShellRunner`. **Critical:** plist sets `HOME=$userHome` env so caddy persists its CA under `~/Library/Application Support/Caddy/`, not the launchd-empty default. `userHome()` is `process.env.HOME || homedir()` because real `os.homedir()` on macOS goes through `getpwuid()` and ignores HOME — required so test files can redirect side-effects to a tmpdir. The `caddy trust` instructions surfaced to users **must** include `-E HOME="$HOME"` for the same reason in sudo context. |
| install↔init auto-chaining | `src/lib/dev-bootstrap.ts` (predicates) + `src/lib/dev-install-helper.ts` (`runInstall`) + `src/lib/dev-migrate-helper.ts` (`runMigrate`/`printMigrateResult`) + `src/commands/dev/{install,init}.ts` | `lt dev init` runs install first when `!isMachinePrepared()`; `lt dev install` runs init after when `isLtDevProject() && !isProjectInitialized()`. Non-recursive by construction: commands call the *helpers*, never each other. Opt-outs: `--skip-install` (init), `--skip-init` (install). `runInstall` must NOT call `process.exit`. |
| Process management | `src/lib/dev-process.ts` | `spawnDetached` keeps the Claude Code session unblocked (logs to `<root>/.lt-dev/{api,app}.log`); it wraps the command in `/bin/sh -c 'ulimit -n …; exec "$0" "$@"'` to raise `RLIMIT_NOFILE` before exec (fixes EMFILE chokidar-watcher crashes on boot) — `exec` keeps the recorded PID/process-group identical, and `"$0" "$@"` passes cmd+args verbatim (injection-safe). `killProcessGroup` uses negative-PID SIGTERM to reach the Nest watcher + Vite + Nuxt children. Single-call `listenSnapshot` for multi-port lsof. Foreground helpers: `runChildInherit` (synchronous-feel child with inherited stdio — build/test runners) and `waitForHttp` (curl-based readiness probe over HTTPS; treats any 1xx-5xx as up). |
| Test session (isolated parallel stack) | `src/lib/dev-test-session.ts` (+ `dev-identity.ts#buildTestIdentity`, `dev-state.ts#TEST_SESSION_FILE`) | `bringUpTestSession` boots a SECOND stack (own URLs `<slug>-test.localhost` / `api.<slug>-test.localhost`, own port band 4500+, own Caddy block `lt-dev:<slug>-test`, own DB `<…>-test`, own session file `state.test.json`, own env bridge `.env.test`, own log files `{api,app}.test.log`, own Nuxt build dir `.nuxt-test` + Nitro output dir `.output-test` via `buildTestAppEnv` — DEV-2715/DEV-2724, both project-forwarded and NOT framework-native, with `testAppEntryCandidates()` looking in the isolated dir FIRST and falling back to `.output/`; `.gitignore` is healed with `.nuxt-*`/`.output-*` and the suffixed dirs are removed on teardown) PARALLEL to the dev session — Playwright never touches developer data, and the dev stack keeps running while tests run. API is run **compiled** (`node dist/src/main.js`) for ts-node stability across long suites; falls back to `pnpm start`. `tearDownTestSession` is idempotent + residue-free (registry entry, session file, env bridge, Caddy block all dropped). `lt dev down` also tears down any lingering test stack. The `-test` suffix on the DB matches the TestHelper guard pattern `(-local|-ci|-e2e|-test)$`. Sharded runs (`runShardedTestSession` → `buildShardPlaywrightInvocation`) deliberately pass NO `--reporter` so a project's release-gate reporters (e.g. a no-skips gate) survive under `--shard` (DEV-2676); the HTML reporter is isolated per shard via `shardReportDir()` + `PLAYWRIGHT_HTML_OUTPUT_DIR`/`PLAYWRIGHT_HTML_OPEN=never`. |
| Workspace/standalone detection | `src/lib/dev-project.ts` | Reuses `workspace-integration.ts` helpers; never duplicates detection logic. Also exports `apiNeedsPortPatch`/`appNeedsPortPatch`/`deriveDbName`/`deriveTestDbName` (test-DB name is `<…>-test`, distinct from `<…>-local` and the API unit-test DB). |
| Idempotent legacy port patches | `src/lib/dev-patches.ts` | Patches `config.env.ts` (port 3000), `nuxt.config.ts` (port 3001 + vite proxy target), `playwright.config.ts` (`baseURL`/`host`/`url` + the marker-bracketed `lt-dev:bridge vN` block), and the CLAUDE.md URL block. All return a no-op `PatchResult` for missing files. The bridge block is re-injected on a **version** bump (`BRIDGE_VERSION`) or a **semantic** code change — never for the consumer formatter's restyling, which owns that file. `canonicaliseBridgeSpan` exports that comparison for `dev-ticket.ts`. |
| Detached-spawn binary override | `src/commands/dev/up.ts` | `process.env.LT_PNPM_BIN` overrides the hardcoded `pnpm` binary (corporate / pinned setups, or bun-based projects via wrapper script). |
| Compiled API launch (opt-in) | `src/lib/dev-api-launch.ts` | `--api-compiled` on `lt dev up` runs the API compiled (`node dist/src/main.js`) instead of ts-node, for stability under browser load (DEV-2525) — same reason `lt dev test` runs compiled. `startCompiledApi` = build → `migrate:up` (parity with the default `migrate:up && start:local`; a failed migration ABORTS the start rather than booting a half-migrated DB) → `spawnDetached('node', [entry], { NODE_ENV: 'local' })`; auto-falls-back to the ts-node `start` on build failure / missing dist entry. `findCompiledEntry` (the compiled-entry allowlist `dist/src/main.js` → `dist/main.js`) is single-sourced here and reused by `dev-test-session.ts`. Flag parsed by `isApiCompiledRequested` (honours `--api-compiled` and `--api-compiled=true`, per the yargs-parser gotcha). Only (re)starts a component that is NOT healthy — a running API is kept (`lt dev down` first to switch it). |
| Project-local state | `<project>/.lt-dev/{state.json,api.log,app.log,.env}` | Auto-added to `.gitignore` by `lt dev init`. State JSON is schema-validated on load. The `.env` file is the **ENV bridge** (see below). |
| ENV bridge for external tools | `src/lib/dev-env-bridge.ts` | `lt dev up` writes `<root>/.lt-dev/.env`; `lt dev test` writes `<root>/.lt-dev/.env.test` (same shape, test URLs + `LT_DEV_DB_NAME=<…>-test`) so test runners pick up the isolated stack without disturbing the dev `.env`. Both contain all URLs + `NODE_EXTRA_CA_CERTS`. External test runners (Playwright, IDE extensions, custom scripts) load these files via the auto-injected bridge block in `playwright.config.ts` (see `dev-patches.ts#patchPlaywrightConfig`). `lt dev down` + test teardown remove their respective files. |
| One-shot isolated test wrapper | `src/commands/dev/test.ts` | `lt dev test` (App mode, default) brings up an isolated parallel stack via `dev-test-session.ts`, runs `pnpm run test:e2e` with `.env.test` loaded, then tears the stack down. `--keep` leaves the stack up for debugging (stop later with `lt dev test down`). `--debug` sets `PWDEBUG=1` + `HEADED=1`. `--api` skips the stack and runs `pnpm run test:e2e` in `projects/api` (already DB-isolated). Forwards args after `--`. Signal-safe: SIGINT/SIGTERM trigger teardown before exit. |

**Lifecycle:**
1. **`lt dev install [--skip-init]`** — one-time per machine. Verifies Caddy is on PATH (suggests `brew install caddy`), creates `~/.lenneTech/Caddyfile` stub, writes + bootstraps the dedicated LaunchAgent / systemd-user unit, waits up to 8s for port 2019, validates the Caddyfile. Surfaces `sudo -E HOME="$HOME" caddy trust` for the CA install. **Auto-chains:** when run inside an lt-dev-capable project that isn't initialized yet, runs `lt dev init` afterwards (`--skip-init` opts out).
2. **`lt dev uninstall [--purge] [--noConfirm]`** — symmetric counterpart. Boots out the LaunchAgent / systemd unit, removes the unit file, optionally purges the Caddyfile + caddy logs.
3. **`lt dev init [--skip-install]`** (alias `migrate`, `m`) — once per project. Idempotent ENV-aware patches + CLAUDE.md URL block + registry entry + `.gitignore`. **Auto-chains:** when the machine isn't prepared yet, runs `lt dev install` first (`--skip-install` opts out).

**Mutual install↔init auto-chaining (no infinite regress):** the two commands prepare each other's precondition, but the chain is **one hop deep and structurally non-recursive** because each command calls the *helper* of the other (`runInstall` / `runMigrate` in `dev-install-helper.ts` / `dev-migrate-helper.ts`), never the other command. Pure predicates in `src/lib/dev-bootstrap.ts` (`isMachinePrepared`, `isProjectInitialized`, `isLtDevProject`) gate the decision and make re-runs no-ops. `runInstall` never calls `process.exit` (the command decides the exit code).
4. **`lt dev up`** — registers Caddy block, allocates internal ports (start 4000), spawns API+App detached. **Self-healing prerequisites:** it no longer just *warns* about legacy hardcoded ports — it runs the same `autoPatch` as `lt dev init` over `config.env.ts`/`nuxt.config.ts`/`playwright.config.ts` so an unmigrated project becomes env-aware (honours the injected `PORT`/URLs) in one command; idempotent (no-op on already-env-aware configs). `autoPatch` only ever touches those configs — never CLAUDE.md — so it is safe in a ticket worktree (ticket URLs reach Claude via the lt-dev plugin hook + `.lt-dev/ticket` marker, not the committed CLAUDE.md; the base project still gets its CLAUDE.md URL block). **Health-aware & idempotent:** re-running probes the actual ports (not just the recorded supervisor PID) and only (re)starts components that are NOT truly serving — a CRASHED one (supervisor/nodemon alive but ts-node dead → port free) or a DEAD one — while leaving a healthy component running untouched (its PID is preserved). Before respawning it terminates the crashed supervisor's whole group (so the idle nodemon doesn't leak and stack) and reclaims any orphaned listener squatting the reused port. All-healthy → no-op (exit 0, "already running"). By default ts-node is kept (NOT `node dist`) so edits hot-reload immediately; the explicit opt-in `--api-compiled` (parsed via `isApiCompiledRequested`, launched by `startCompiledApi` in `dev-api-launch.ts`) deliberately runs the API compiled for stability under browser load (DEV-2525), knowingly trading hot reload.
5. **`lt dev down`** — SIGTERM the process group, removes Caddy block.
6. **`lt dev status [--all]`** — current project or all registered. **Honest liveness:** a component is "running" only when its supervisor PID is alive AND its internal port is actually bound; supervisor-alive-but-port-free reads as `starting` while within the 60s startup grace window (booting — a cyan `◐`, never listed as "down") and as `crashed` once it elapses (not the old misleading "running"), and a mixed up/down project shows `degraded` in `--all`. Both point at `lt dev up` to restart just the down half (a `starting` component is left booting, not restarted).
7. **`lt dev doctor`** — Caddy + CA + DNS + port diagnostics (checks our LaunchAgent, **not** `brew services caddy`).
8. **`lt dev test [--api] [--keep] [--debug] [-- args]`** / **`lt dev test down`** — App mode (default) brings up an ISOLATED parallel stack (`<slug>-test.localhost` / `api.<slug>-test.localhost`, DB `<…>-test`), runs Playwright against it, then tears it down. The dev `lt dev up` session is never touched. `--keep` leaves the test stack up for debugging; `lt dev test down` tears a leftover stack down. `--api` runs the API E2E suite in the api project instead (already DB-isolated, no stack needed). Forwards args after `--` to the test runner.
9. **`lt dev tunnel [--api]`** — Cloudflare Quick Tunnel: foreground `cloudflared tunnel --url https://<slug>.localhost --http-host-header <slug>.localhost --no-tls-verify`, prints the public `*.trycloudflare.com` URL. The host-header rewrite is mandatory — without it Caddy's vhost match fails for the random tunnel URL. Tunnels only expose ONE subdomain at a time; start a second `lt dev tunnel --api` in another shell for full external usage.

**Cross-wiring protection:** API gets `APP_URL` so Better-Auth `trustedOrigins` only includes its own App; App gets `BASE_URL` so it only talks to its own API; localStorage is namespaced via `NUXT_PUBLIC_STORAGE_PREFIX=<slug>`; Mongo URI is namespaced via `NSC__MONGOOSE__URI=mongodb://127.0.0.1/<dbName>`; h3 session cookies are namespaced via `NUXT_SESSION_PASSWORD`, keyed per slug so a cookie sealed by one stack cannot be unsealed by another (dev, `-test` and every `-test-N` shard stack differ). The isolated `lt dev test` stack reuses the same protections under a `-test` suffix (slug `<…>-test`, DB `<…>-test`, prefix `<…>-test`, port band 4500+) so it can run literally side-by-side with the dev session.

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
`npm run test:vendor-init` to verify all 4 init scenarios still pass.
The script creates fresh projects in `/tmp/lt-it/*`, runs the full
init → generate → tsc → build → migrate:list pipeline, and asserts
~120 invariants. Runs in ~15-20 minutes on a decent machine. Also run
`npm run test:frontend-vendor-init` to cover the frontend-vendor and
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

### `lt dev` liveness: supervisor PID alive ≠ component serving <!-- Added: 2026-06-08 -->
`lt dev up` spawns each component as a detached `pnpm start` / `pnpm dev` and
records THAT wrapper's PID in `state.json`. But the wrapper is the top of a chain
(`pnpm start` → `sh -c "migrate:up && start:local"` → `pnpm` → `nodemon` →
`ts-node src/main.ts`). When the inner ts-node crashes (a known ts-node-under-load
instability — e.g. during `pnpm run check`), **nodemon survives** ("waiting for
file changes"), so the recorded wrapper PID stays alive while NOTHING listens on
the internal port. Any liveness check based on `isPidAlive(pids.api)` alone is
therefore a lie ("api: running" while `curl :PORT` → connection refused).
**Rule:** treat a component as `running` only when the supervisor PID is alive AND
its internal port is bound — use
`classifyComponentHealth({ pid, portBound, startedAt })` (`src/lib/dev-state.ts`)
with a `listenSnapshot([...ports])` (`src/lib/dev-process.ts`) probe. The classifier
is a **4-state** model:
- `running` — wrapper PID alive AND port bound.
- `starting` — wrapper PID alive, port NOT bound yet, but within `STARTUP_GRACE_MS`
  (60s) of `startedAt`. The slow API boot (swc compile + Mongo + Better Auth +
  migrations) can take 15-30s+ to bind its port; during that window "port free"
  means BOOTING, not crashed — reporting it as `crashed` was a false-positive that
  made users restart a healthy, still-booting stack. Passing `startedAt` is what
  unlocks this state; without it a booting component still reads as `crashed`
  (backward compatible). Guarded against clock skew / unparseable timestamps
  (`Number.isFinite(ageMs) && ageMs >= 0`).
- `crashed` — wrapper PID alive, port free, AND the grace window has elapsed.
- `dead` — no live wrapper PID.

Consumed by `lt dev status` (honest labels + a cyan `starting` glyph; the pure
`summarizeStackHealth` / `partitionComponentStates` helpers drive the `--all` glyph
and the down-half hint, and a `starting` component is NEVER listed as "down") and
`lt dev up` (selective restart: a `running` OR still-booting `starting` component is
KEPT — re-running `up` during a boot must NOT kill+restart the still-booting
component; only `crashed`/`dead` are (re)started, terminating the crashed
supervisor's group first via `terminateProcessGroup` so the idle nodemon doesn't
leak/stack). `up` resets the session `startedAt` only when something was actually
(re)started, so a freshly restarted component's grace window is measured from its
real start, not an inherited stale time. The *automatic* crash-heal must never
silently switch to compiled `node dist` to "stabilise" — that breaks hot-reload;
restart-on-crash (`lt dev up`) is the intended remedy. The user-driven
`--api-compiled` opt-in is the sanctioned exception: it trades hot reload
*knowingly*, on explicit request (see `dev-api-launch.ts#startCompiledApi`).

### `spawnDetached` raises the FD limit via an exec-in-place `sh` wrapper <!-- Added: 2026-07-20 -->
`spawnDetached` (`src/lib/dev-process.ts`) launches each `lt dev` component as
`spawn('/bin/sh', ['-c', 'ulimit -n 65536 …|| ulimit -n 10240 …|| true; exec "$0" "$@"', cmd, ...args])`
instead of `spawn(cmd, args)` directly. Reason: macOS's default soft `RLIMIT_NOFILE`
is **256** (launchd/system default, inherited by the terminal that runs `lt dev up`
and thus by its detached children — NOT a consequence of the lt-dev LaunchAgent,
which runs only Caddy). The dev file-watcher (nest/nuxt → chokidar) exhausts a
soft-256 limit on a monorepo → intermittent `EMFILE: too many open files, watch`
crashes on boot that forced a manual `lt dev up`.
**Two invariants a future edit must NOT break** (both unit-tested in
`__tests__/dev-process.test.ts`):
- **`exec` stays** — it replaces the shell image IN PLACE, so `child.pid` and the
  detached process group are still the REAL process. PID tracking + the negative-PID
  group-kill in `terminateProcessGroup` / `killProcessGroup` depend on this. (Test:
  the child echoes its own `process.pid`; it must equal the recorded pid.)
- **`"$0" "$@"` stays** — cmd/args arrive as separate, double-quoted positional
  parameters, never interpolated into the `-c` script text, so shell metacharacters
  in a path/arg cannot inject. (Test: args with `;`, `|`, `$(…)`, backticks arrive
  verbatim.)
The ulimit cascade tries a high limit first and falls back on machines with a lower
`kern.maxfilesperproc`; `2>/dev/null … || true` keeps it best-effort so it can never
fail the spawn. `/bin/sh` is hardcoded — fine, the whole `lt dev` module is already
Unix-only (process groups, LaunchAgent/systemd). Side effect: a bogus `cmd` no longer
returns `pid === undefined` (the outer `sh` spawns fine; the inner `exec` exits 127 a
few ms later), but `classifyComponentHealth` reaps that as `dead`/`crashed` on the
next status/up, so callers self-correct.

### `projectSlug` ignores unmodified template names + is worktree-aware <!-- Added: 2026-06-16 -->
`dev-identity.ts#projectSlug` is the single source of truth for the `lt dev` slug
(`<slug>.localhost`, DB name, registry key, `lt ticket` URLs). Older projects
scaffolded before rename-on-init still carry the template's `name: "lt-monorepo"`
in their root `package.json` — so a project living in `imo/` would slug to
`lt-monorepo` and `lt ticket start DEV-2314` would build `lt-monorepo-2314`
instead of `imo-2314`. `lt fullstack init` rewrites the name (`setPackageName`)
and `lt dev init` heals it after the fact (`renameUnmodifiedTemplatePackage`), but
**`lt ticket start` / `lt dev up` never run either** — they read the slug live.
**Rule:** `projectSlug` treats an `isUnmodifiedTemplateName` value (e.g.
`lt-monorepo`) as non-identifying and falls back to the PROJECT DIRECTORY name.
The fallback resolves the basename via the **main git worktree**
(`git rev-parse --git-common-dir` → parent), NOT the current dir: a linked
`lt ticket` worktree `imo-2314/` must inherit base slug `imo` (so
`buildTicketIdentity` yields `imo-2314`), otherwise it would double-suffix to
`imo-2314-2314`. `isUnmodifiedTemplateName` + `UNMODIFIED_TEMPLATE_NAMES` live in
`dev-identity.ts` (re-exported from `package-name.ts` for back-compat) to avoid an
import cycle.

### `lt dev up` self-heals legacy ports; teardown auto-discards pristine patches <!-- Added: 2026-06-16 -->
`lt dev` / `lt ticket` commands establish their own prerequisites — the user never
has to run `lt dev init` first. `lt dev up` now runs the same `autoPatch`
(`dev-patches.ts`) as `lt dev init` over `config.env.ts`/`nuxt.config.ts`/
`playwright.config.ts` (was: warn-only). Without it an unmigrated project hardcodes
`port: 3000`/`3001`, ignores the injected `PORT` (`buildDevEnv` sets it per
component), binds the framework defaults and misses Caddy → the (ticket) URLs don't
route and collide with parallel stacks. `autoPatch` never touches CLAUDE.md, so it
is **ticket-safe** (the committed CLAUDE.md must not carry per-ticket URLs; those
reach Claude via the lt-dev plugin hook + `.lt-dev/ticket` marker — see
[up.ts](src/commands/dev/up.ts)). `lt dev test`'s isolated stack
(`dev-test-session.ts#bringUpTestSession`) self-heals the same way — but **before
its `pnpm run build`**, because the test API runs COMPILED (`node dist/...`): an
unpatched `config.env.ts` would bake `port: 3000` into the bundle and miss Caddy.
**Teardown consequence + fix:** in a worktree these are *uncommitted* tracked
patches, which would make `lt ticket stop` refuse (its `worktreeSafetyReport`
dirty-source guard). So `dev-ticket.ts` classifies a dirty config as
**auto-discardable** when it is a *pristine* lt-dev patch — verified precisely by
re-deriving `autoPatch(HEAD blob)` and comparing to the working tree (`git show
HEAD:<path>`); any extra developer edit on top makes them differ → treated as real
work, never discarded. `worktreeDirtyOnlyAutoDiscardable` (generated OR pristine
lt-dev) drives `lt ticket stop`'s auto-force.
**Porcelain trap (fixed here):** the generic `git()` helper `.trim()`s its output,
which eats the leading space of a tracked-modified porcelain line (` M path`) and
shifts `porcelainPath`'s `slice(3)` by one (`projects/…` → `rojects/…`). Old tests
missed it because they only used untracked (`??`, no leading space) files. Always
read porcelain via `gitStatusPorcelain` (no per-line trim), never the trimming
`git()`.

### Angular bakes deploy URLs into the bundle; Nuxt reads them at runtime <!-- Added: 2026-07-10 -->
`lt deployment create` writes `.turboops.json` and — for **Angular** apps only —
rewrites `projects/app/src/environments/environment.{prod,develop,test}.ts`
(`src/environments/…` for standalone). Reason: a Nuxt app gets its API URL from
the TurboOps stage env at runtime (`NUXT_PUBLIC_API_URL`), but
`ng build --configuration production` BAKES `environment.prod.ts` into the
bundle — an unpatched deploy ships `apiUrl: 'http://127.0.0.1:3000/graphql'` and
calls the end user's own machine. The command therefore also prints a
stack-specific checklist (no `NUXT_*` vars for Angular; "commit the patched
environment.*.ts" instead).
**Stage mapping** (TurboOps has exactly two stages): `environment.prod.ts` →
`production` (`<domain>` + `api.<domain>`); `environment.develop.ts` AND
`environment.test.ts` → `dev` (`dev.<domain>` + `api.dev.<domain>`) — the two are
byte-identical in ng-base-starter and there is no TurboOps "test" stage.
`environment.ts` (local) is never touched.
**Patch shape** (`src/lib/angular-environments.ts`): replace only the URL
**origin** (scheme + host + port) per property (`apiUrl`, `restUrl`, `wsUrl`,
`appUrl`), keeping the path — so `/v2/graphql` survives, `logoPath` is untouched,
the patch is idempotent, AND a re-run with a NEW domain actually updates the
files. The old implementation replaced the literal `http://127.0.0.1:3000`, which
silently did **nothing** on a second run and left the previous domain baked in.

### A flag that PREVENTS destruction must fail closed — `=== true` fails open <!-- Added: 2026-07-14 -->
gluegun parses argv with **`yargs-parser` and declares no booleans**
(`node_modules/gluegun/build/toolbox/parameter-tools.js` → `yargsParse(commandArray)`), so a
flag does NOT arrive as `true` in most spellings people actually type:

| argv | `parameters.options['keep-db']` |
|---|---|
| `--keep-db` | `true` (boolean) |
| `--keep-db=true` / `--keep-db true` | `'true'` (**STRING**) |
| `--keep-db=1` | `1` (**NUMBER**) |
| `--keep-db 2200` | `2200` — **and the positional is GONE** (`parameters.first` is `undefined`) |

The idiom `options.x === true` is therefore only safe for flags that **ENABLE** something
(`--force`, `--dry-run`): a parse quirk means "don't force" → fail-CLOSED → safe. It is
exactly backwards for a flag that **PREVENTS** something. `lt ticket stop --keep-db=true`
evaluated `'true' === true` → `false` → and **dropped the database the user explicitly asked
to keep**. Irreversibly.

**Rules:**
- A guard on a destructive action reads the flag's **presence** as intent; only an explicit
  negation (`--no-x`, `--x=false`) proceeds. See `dev-ticket.ts#keepDbFlag`.
- A value-less flag can swallow the next positional. Surface it (`strayValue`) and recover
  it — never let it silently fall through to a marker/default and act on a *different*
  target than the user named.
- Extract the decision into a **pure predicate** in `src/lib/` and test it against gluegun's
  own `parseParams` (see the contract suite in `__tests__/dev-ticket.test.ts`). A guard
  buried in the gluegun `run()` closure is untestable, and this one was destroying data.
- The rest of the repo already writes `=== true || === 'true'` in 15+ places. Follow it.

### Derived names for destructive targets need a post-condition <!-- Added: 2026-07-14 -->
`lt ticket stop` drops the ticket's databases by default (the env — worktree AND registry
entry — is gone afterwards, so they are orphans nothing references, lists, or reuses; keeping
them was how machines accumulated hundreds of dead DBs). But the name it drops is **derived**,
never observed — and two derivations round-trip onto the *wrong* database:

- **Reserved ids.** `deriveTicketDbName` and `deriveTestDbName` both strip a trailing
  `-(local|dev)` before appending their suffix. So project DB `imo-local` + ticket id `local`
  derives back to **`imo-local`** (the developer's main dev DB) and its test DB to
  **`imo-test`** (the project's E2E DB). Same for ids `dev` and `test`.
- **Slug-keyed global registry.** `~/.lenneTech/projects.json` is keyed by slug alone, so
  `<slug>-<id>` can be a genuinely different project (`imo` + ticket `admin` collides with a
  real sibling project `imo-admin`). Its `dbName` is *that* project's.

**Rule:** never let a derivation aim an irreversible action. Validate the *result* against the
target's expected shape and refuse anything else (`isTicketScopedDb`, `planTicketDbDrop`), and
reject the inputs that create the collision (`isReservedTicketId`, enforced in `ticket start`).
Also: run the **fallible** step before the **irreversible** one — `git worktree remove` can
fail, `dropDatabase` cannot be undone, so the worktree goes first. And keep `dropDatabase`'s
shape: the DB name travels percent-encoded in the URI **path** and `--eval` is a **constant**,
which is what makes an arbitrary name un-injectable — do not batch the drops into a built eval
to save a spawn.

### A patcher that owns a block inside a formatted file must compare it semantically — and version it <!-- Added: 2026-07-22 -->
`patchPlaywrightConfig` (`src/lib/dev-patches.ts`) injects a marker-bracketed
`// >>> lt-dev:bridge vN >>>` block into the CONSUMER project's
`playwright.config.ts` — a file that project's own formatter owns and restyles on
every `format` / pre-commit run. The block used to be compared **byte-for-byte**
against the freshly generated one, so any cosmetic reformatting read as
"outdated", got rewritten, and the formatter flipped it straight back: every
`lt dev up` / `lt dev test` left `playwright.config.ts` permanently dirty in the
working tree. Confirmed in the wild — `document-analyzer` carried a quote-flipped
block and was rewritten on every single lt-dev command.

**This was the SECOND fix for the same class.** 1.32.1 (`69cdabb`) tried to solve
it by making the EMITTED block match one formatter's output (`"utf8"` → `'utf8'`,
expanded braces). That only holds for projects on that exact formatter + config.
Never chase a formatter's style; be indifferent to it.

**Three rules, all load-bearing:**

1. **Compare semantically — but drop comment lines, do NOT collapse newlines.**
   A `//` comment is terminated by a newline, so a `\s+ → ' '` collapse makes a
   fully commented-out (inert) loader normalise *identically* to a live one: the
   patcher would accept it as up to date and the bridge would silently never load
   `.lt-dev/.env` again, with Playwright falling back to `localhost:3001` —
   possibly a parallel project's stack. `normaliseBridgeBlock` therefore drops
   comment lines entirely (so rewording a comment is free) and only then
   normalises quotes + intra-line whitespace. Measured against a 15-case matrix:
   comment-dropping 14/15, whitespace-collapsing 11/15.
2. **Version the marker; bump `BRIDGE_VERSION` on EVERY block change — including
   a formatting-only one.** Since the content comparison ignores quote style and
   whitespace, a cosmetic fix would otherwise never reach already-patched
   projects. Exactly what 1.32.1's fix would have hit. The version lives in the
   marker, so it survives any reformatting; an unversioned v1 marker parses as 0
   and upgrades cleanly.
3. **Keep the two notions of "already patched" in sync.**
   `dev-ticket.ts#isPristineLtDevPatch` re-derives `autoPatch(HEAD blob)` and
   compares to the working tree to decide whether `lt ticket stop` may discard a
   dirty config. When the patcher started tolerating formatter drift, that check
   still compared byte-for-byte — so a merely reformatted config read as *real
   developer work* and the worktree removal was refused. It now routes both sides
   through `canonicaliseBridgeSpan`, which canonicalises **only** the marker span
   and leaves every other byte exact — being lenient outside the markers could
   silently discard genuine work.

**Do not state a formatter's default in a comment without checking it.** A
docs-review verified oxfmt 0.59.0 (as shipped by nuxt-base-starter, no config)
normalises to SINGLE quotes, while a real vendored project showed a
double-quoted block — i.e. the direction is project-specific. The original
comment asserted the opposite of the verified behaviour, which is the same
misconception that produced the 1.32.1 approach. Say "project-specific", not a
vendor name.

### The base branch is not called `dev` everywhere — never hard-code it <!-- Added: 2026-07-13 -->
`lt ticket start` created its worktree from a hard-coded `origin/dev`, so it died with
`fatal: invalid reference: origin/dev` in every repo that names its integration branch
differently — `nest-server` uses `develop`, GitHub defaults to `main`.
**Rule:** resolve the base ref, never assume it. `dev-ticket.ts#resolveBaseRef` probes
`origin/dev` → `origin/develop` → the remote's HEAD (`git symbolic-ref refs/remotes/origin/HEAD`)
→ `origin/main` → `origin/master` → the same names as LOCAL branches (repo without a remote),
and returns `ref: null` when none exists instead of guessing. An explicit `--base` always
wins and is reported as *missing* when it doesn't resolve — it must never silently fall back
to a guessed branch. On `ref: null` the command ASKS (select from `listBaseRefChoices`, plus a
free-text escape hatch, re-asked until `gitRefExists`); non-interactive callers
(`isNonInteractive` — CI / AI agents) get a hard error pointing at `--base`. `git fetch` is
best-effort (warn + continue on failure) so an offline repo still resolves against local refs,
and base-ref resolution is skipped entirely when the branch already exists (`worktreeAdd` then
just checks it out).

### A `pnpm-workspace.yaml` is NOT a workspace marker by itself <!-- Added: 2026-07-10 -->
Since pnpm 10/11, `pnpm-workspace.yaml` is also the canonical home for
workspace-scoped **settings** (`overrides`, `allowBuilds`,
`onlyBuiltDependencies`, `minimumReleaseAge*`) — pnpm 11 silently ignores those
keys in `package.json#pnpm`. Both `nest-server-starter` and the
`nuxt-base-template` therefore ship a **settings-only** `pnpm-workspace.yaml`
(no `packages:`) while being plain single-package projects.
`workspace-integration.ts#hasWorkspaceMarker` treated the file's mere existence
as a workspace marker, so `dev-project.ts#resolveLayout` classified every
standalone starter as a monorepo, looked for `projects/api` + `projects/app`,
found neither, and `lt dev up` / `lt dev init` aborted with *"No API or App
project detected at this path"* — standalone App-only **and** API-only projects
could not be started at all.
**Rules:**
- Only a `pnpm-workspace.yaml` with a non-empty `packages:` list counts
  (`pnpmWorkspaceDeclaresPackages`, parsed via `js-yaml`; unparseable YAML → not
  a marker, let the other markers decide). Mirrors the existing non-empty check
  on `package.json#workspaces`.
- A workspace marker alone never wins: `resolveLayout` selects the monorepo
  layout only when `projects/api` or `projects/app` actually exists, else it
  falls through to the standalone probe. This also covers npm workspaces using
  `packages/*` and a bare `projects/` dir (a fresh lt-monorepo clone ships only
  `projects/.gitkeep`).
- `dev-identity.ts#detectStandaloneKind` is the single source of truth for
  "is this an API / an App?", shared by `buildIdentity` (URLs) and
  `resolveLayout` (which processes to spawn) so identity and layout can never
  disagree. All three shapes are valid: api+app, api-only, app-only.
- `lt dev up` prints the `db:` line only when an API is present — an App-only
  project has no Mongo database.

### `npm run check` has a vulnerability gate; vulns are pinned via `overrides` <!-- Added: 2026-06-16 -->
`npm run check` is `bash scripts/check.sh` (was a bare `npm install && … && build`
chain that ran **no** audit). The script's **first** step is a vulnerability gate:
`npm audit --audit-level=low` — ANY finding aborts the pipeline before building on
vulnerable deps. Bypass explicitly with `npm run check --force` (npm sets
`npm_config_force=true`, read by the script) or `npm run check -- --force`
(forwarded arg); `npm run check:audit` runs only the gate (`--audit-only`).
`check.sh` is a single orchestrator (not an `&&` chain) precisely so `--force`
reaches it reliably — args appended to an `&&` chain only hit the LAST command.
**Fixing vulns:** transitive CVEs are pinned in the npm `overrides` block (mirror a
human-readable reason into the sibling `//overrides` doc object), e.g. `form-data`
4.0.6 (GHSA-hmw2-7cc7-3qxx), `@babel/core` 7.29.7 (GHSA-4x5r-pxfx-6jf8).

`js-yaml` is at **4.3.2** (GHSA-5p4m-2wfm-xmqj, quadratic CPU in `!!omap`, fixed 4.3.1 /
3.15.1; GHSA-2883-xcg3-v3hh, `maxTotalMergeKeys` does not limit CPU for empty merge
sources, fixed 4.3.2 / 3.15.2). It is a direct production dependency of this CLI
(`src/extensions/config.ts`, `src/lib/hoist-workspace-pnpm-config.ts`).

The dev-only 3.x path (ts-jest > @jest/transform > babel-plugin-istanbul >
@istanbuljs/load-nyc-config, which requests `^3.13.1`) now resolves to **3.15.2 on its
own** — no override. Until 2026-09-14 a consumer-scoped override forced it onto 4.x,
because the `!!omap` advisory originally said the fix was not backported to 3.x. js-yaml
later published 3.15.1 and 3.15.2, so the forced cross-major jump was removed: fewer
forced majors, and the consumer gets the line it asked for. The price is a second
js-yaml copy in the dev tree. If a future js-yaml advisory is again fixed only in 4.x,
the old remedy still applies: a top-level `js-yaml@<x` selector does **not** reach that
nested path in npm, only a consumer-scoped `"@istanbuljs/load-nyc-config": { "js-yaml": … }`
does, and it needs the export-shape check (`index.js:80` calls `.load`, which 4.x has;
4.x `load` behaves like 3.x `safeLoad`).

### `lt fullstack init` used to exit 0 on EVERY error path <!-- Added: 2026-08-23 -->
A gluegun command that `return`s leaves the process at exit code 0. Until 1.43.0 every
failure in `fullstack/init.ts` — clone failed, `pnpm install` aborted, invalid flag
value, target dir exists — printed red and reported SUCCESS to `$?`. A CI job or agent
checking the exit code saw a half-built workspace as a good scaffold.
**Rule:** every early `return` on an error path calls `failRun(toolbox)` first
(`src/lib/fail-run.ts`), which sets `process.exitCode = 1` guarded by
`!parameters.options.fromGluegunMenu` — the same guard the other exit-code call sites
use (`dev test`, `dev tunnel`, `tools ocr`, `workspace-integration`).
`process.exitCode`, never `process.exit()`: the latter can truncate the spinner's own
failure message. **`add-api.ts` and `add-app.ts` are covered too, and that is not
optional** — `init` DELEGATES to them inside an existing workspace, so covering only
`init.ts` made the exit code depend on which directory the user was standing in.
`__tests__/fullstack-init-exit-code.test.ts` enforces it from both sides: a structural
walk over every bare `return;` in all three files, plus one real `spawnSync` that
asserts exit 1 for an existing target directory.

### Vendoring makes the framework's `allowBuilds` the PROJECT's problem <!-- Added: 2026-08-23 -->
The vendor conversion resolves the core's import closure into direct dependencies, so
packages only nest-server knew about (`bullmq` → `msgpackr` → `msgpackr-extract`)
become the generated project's own. pnpm 11 does not treat an unlisted build script as
"deny" — it ABORTS with `ERR_PNPM_IGNORED_BUILDS`, i.e. a project that cannot be
installed at all. nest-server's `pnpm-workspace.yaml` is not in its npm tarball, so the
clone during conversion is the only moment it can be read;
`adoptUpstreamBuildAllowlist` snapshots it there. **Additive only** — and "already
decided" is judged on the RAW key, never on a boolean-narrowed copy: js-yaml 4 uses the
YAML 1.2 core schema, so `esbuild: no` / `off` are STRINGS, and narrowing first turned
a maintainer's deny into "no opinion" and adopted upstream's `true`.

### A `nuxt/schema` augmentation is harmless in node_modules and fatal as project source <!-- Added: 2026-08-23 -->
nuxt-extensions' `runtime/types/module.ts` augments `PublicRuntimeConfig` under BOTH
`nuxt/schema` and `@nuxt/schema`; the former re-exports the latter, so it is ONE
interface decorated twice. In npm mode the file never enters the consumer's program.
Vendoring copies it to `app/core/`, the project's `include` picks it up, and it closes a
cycle with Nuxt's generated `interface PublicRuntimeConfig extends UserPublicRuntimeConfig`
→ TS2310, which `skipLibCheck: true` HIDES. Visible symptom: every `config.public.*`
infers as `unknown` in every vendor-mode project (the default for `lt fullstack init`).
Diagnose with `npx vue-tsc --noEmit -p .nuxt/tsconfig.json --skipLibCheck false | grep TS2310`.
`stripVendorSchemaAugmentation` removes it during conversion and leaves a note in its
place; a block it cannot parse is WARNED about rather than silently retained, because
silence there means the bug ships and the conversion still reported success.
Measured 2026-08-22. General rule: a transform that turns package typings into project
source owns what that change of status implies.

### A command's `help` export must ride on `module.exports =`, not a bare `export const` <!-- Added: 2026-07-19 -->
Gluegun command modules export the command via `module.exports = XCommand`, which
**reassigns** `module.exports` and clobbers any `exports.help` a sibling
`export const help: CommandHelp` set earlier (the classic CJS/ESM interop trap: after
the reassignment the `exports` alias is detached from `module.exports`).
`loadCommandHelp` (`src/lib/command-help.ts`) reads `mod.help || mod.default.help` off
the REQUIRED module — i.e. off `module.exports` — so a bare `export const help` is
invisible and `--help-json` stays `richHelp: false`. **Rule:** attach `help` to the
exported object: `module.exports = Object.assign(XCommand, { help })` (keep the
`export const help: CommandHelp` too, for the type + importers). The first help export
in the repo lives in [src/commands/dev/up.ts](src/commands/dev/up.ts); verify the
wiring with `lt dev up --help-json` → `richHelp: true` listing the command's own options.

### A CLI `--reporter` REPLACES playwright.config.ts's reporter list — never inject it into a sharded/test run <!-- Added: 2026-07-24 -->
Playwright applies a CLI `--reporter` as an OVERRIDE, not an append —
`Runner._parseConfig` does `result.reporter = [...configOverrides.reporter]`
(`playwright/lib/runner/index.js`, verified against playwright 1.61.1) — so passing
it drops EVERY reporter a project wired into `playwright.config.ts`. `lt dev test
--shard` used to hand each shard `--reporter=line`, silently clobbering a project's
release-gate reporter (SVL's DEV-2098 `no-skips.reporter.ts`, which turns a run RED
when a spec is skipped) → a skipped spec passed with exit 0 under `--shard`
(DEV-2676). Fix: `buildShardPlaywrightInvocation` ([src/lib/dev-test-session.ts](src/lib/dev-test-session.ts))
passes NO `--reporter` and lets the project config own the list — Playwright
auto-prepends a compact `line` (local) / `dot` (CI) reporter when none of the
configured ones `printsToStdio()` (`runner/index.js`: `reporters.unshift(!process.env.CI
? new line_default() : new dot_default())`), so the captured per-shard log stays
readable — and isolates the one shard-hostile reporter (HTML) per shard via
`shardReportDir()` + `PLAYWRIGHT_HTML_OUTPUT_DIR` + `PLAYWRIGHT_HTML_OPEN=never`
(both env vars inert without an HTML reporter, so the fix stays generic). **Rule:**
never inject a config-REPLACING CLI flag (`--reporter`) into a run that must honour a
project's release-gate reporters; isolate a shard-hostile reporter through its own
env vars instead. The pure `shardReportDir(root, index)` + `buildShardPlaywrightInvocation`
helpers are unit-tested in `__tests__/dev-test-session.test.ts` so the reporter
contract can never silently regress.

### Nuxt's lock is on the BUILD DIR — a shared `.nuxt` aborts the second command, it doesn't race it <!-- Added: 2026-07-31 -->
`@nuxt/cli` takes its lock ON the build directory (`acquireLock(nuxt.options.buildDir)`).
So a `lt dev test` build next to a parked `lt dev up` did not interleave writes into
`.nuxt` — it **aborted** with `Another Nuxt dev is already running (PID N)`. The test
app never came up and every spec then failed on a missing selector, i.e. the symptom
reads as *broken specs* while the cause is pure infrastructure. That mis-signal is
what made it expensive (DEV-2715). `bringUpTestSession` therefore pins
`NUXT_BUILD_DIR=.nuxt-test` and, on a SECOND independent axis,
`NITRO_OUTPUT_DIR=.output-test` (DEV-2724) — `buildDir` and Nitro's `output.dir` are
unrelated knobs, so isolating the first left `.output/` shared, and this stack serves
the production bundle and rebuilds every run, overwriting the tree a local
`pnpm run build` was serving.

**Neither variable is framework-native.** Verified against `@nuxt/schema` 4.4.8,
`nitropack` 2.13.4 and `c12`: none of them reads either name. Only the project's
`nuxt.config.ts` opens the lever (`buildDir: process.env.NUXT_BUILD_DIR || '.nuxt'`,
`nitro.output.dir: process.env.NITRO_OUTPUT_DIR || '.output'`) — `nuxt-base-starter`
≥ 2.16.0 ships both. Never write "unlike NUXT_BUILD_DIR, …": that asymmetric contrast
silently promotes one of them to a framework feature and makes readers forward only
the other. A project that forwards neither still works, it just loses the isolation,
which is why `testAppEntryCandidates()` keeps `.output/server/index.mjs` as a
fallback — with the isolated dir FIRST, because `.find()` takes the first hit and a
stale `.output/` from an earlier local build is the normal case.

**A new build dir is a new name three other matchers must learn.** All three match
whole path SEGMENTS, so `.nuxt` never covers `.nuxt-test`:
`dev-ticket.ts#GENERATED_PATHS` (else `lt ticket stop` sees a 300 MB build tree as
uncommitted work and REFUSES to remove the worktree), the project's `.gitignore`
(`addToGitignore(appDir, '.nuxt-*' / '.output-*')` in `bringUpTestSession`, for
projects predating the starter's globs), and `vscode-settings.ts#MEMORY_PROFILE`
(`**/.nuxt*/**`, else the memory profile watches and indexes the very trees it exists
to exclude). `tearDownTestSession` removes the suffixed dirs — never the bare ones,
which belong to the developer's own build.

### An out-of-sync lockfile is invisible to `npm install` — and only an npm you no longer run can write it <!-- Added: 2026-09-02 -->

`npm ci` on this repo failed with `Missing: @emnapi/core@1.11.3 from lock file` while every
pipeline stayed green, because nothing here ran `npm ci` — `scripts/check.sh` and both GitHub
workflows used `npm install`, which happily installs around a lockfile that disagrees with
`package.json`. The drift entered at 1.42.0 and survived two more releases.

**The trap is that the naive fix is a silent no-op.** `@napi-rs/wasm-runtime` 1.x moved
`@emnapi/core` / `@emnapi/runtime` from `dependencies` to `peerDependencies`, and the only path
to them here is both dev-only and optional (`eslint-plugin-import-x` / `jest-resolve` →
`unrs-resolver` → `@unrs/resolver-binding-wasm32-wasi`, `cpu: wasm32` → `@napi-rs/wasm-runtime`).
npm **>= 11.5.0** (arborist 9.1.3) deliberately prunes nodes that are both peer and optional from
the ideal tree, so it never writes them; npm **<= 11.4** still demands them and fails. So
`npm install`, `npm install --package-lock-only`, `--force` and `--cpu=wasm32` all changed
nothing on npm 11.6 — the modern npm cannot repair the file, and regenerating it with an old npm
makes it oscillate by ten lines on every `check`.

**Rules:**

- **Declare the peer explicitly** (here: both `@emnapi/*` as devDependencies). That is the remedy
  arborist's own source comment names — an optional peer stops being optional once a root
  dependency requires it — and it is the only one both npm generations agree on. Verified across
  npm 10 → 11.6, and `npm install` no longer strips it.
- **Document it next to the entry.** `//devDependencies` in `package.json` mirrors the existing
  `//overrides` convention and carries the removal condition, so an unused-looking dependency is
  not deleted by the next maintenance pass.
- **A fix nothing enforces comes back.** `.github/workflows/build.yml` now runs `npm ci`, so a
  lockfile that drifts again fails CI instead of shipping. Node 20 there means npm 10 — the strict
  generation, which is what makes the guard meaningful.
- **When a lockfile claim disagrees with your machine, check the npm version before the file.**
  This one reproduced on npm <= 11.4 and passed on 11.5+; "works for me" was a version, not a
  mistake by the reporter.

### The built Nitro server reads no `.env` — what `nuxt dev` got for free is missing under `lt dev test` <!-- Added: 2026-09-02 -->

`lt dev up` runs the App via `nuxt dev`, which loads the project's `.env`. `lt dev test` serves
the **built** Nitro server (`node .output*/server/index.mjs`), which reads only `process.env`. So
every key a project keeps in `.env` and never exports silently vanishes in the test stack. Nitro
*does* apply `NUXT_*` runtime-config overrides from `process.env` at runtime, which is why the fix
is always "inject it into the spawn", never "bake it into the build".

Worked example: Nuxt/h3 sessions need a password of at least 32 characters — an **absent** one
throws `H3Error: Empty password`, a **short** one `Password string too short (min 32 characters
required)`. Two distinct errors from `iron-webcrypto` (`minPasswordlength: 32`), reached via h3's
`seal`/`unseal`; quoting the first while describing the second sends a debugger hunting for a
string that is never printed. Without a password every login answered 500 and **42 of 92 Playwright
specs failed on assertions unrelated to their subject** — the same expensive mis-signal as the
`.nuxt` build-dir lock above: it reads as a broken suite while being pure infrastructure.

**Rules for adding such a key to `buildDevEnv`:**

- **Let the project win, and mean it.** Precedence is shell export → the app's own `.env` (read via
  the optional `appDir` input) → the derived fallback. Consulting only `baseEnv` is not enough: a
  project keeps this kind of value in `.env`, and dotenv-style loaders do not override an
  already-set `process.env` key — so an injected value silently beats the project's own file, in
  `nuxt dev` too. Forwarding the `.env` value explicitly is also what fixes the built server for
  exactly those projects.
- **Derive it, never randomise it.** A fresh value per run logs everybody out on every restart.
- **Key it on the slug, and do not claim shards agree — they deliberately do not.** `testStackNames`
  suffixes `-test-N`, so the dev stack, the test stack and each shard stack get DIFFERENT values.
  That is the point: it makes the key a cross-wiring guard, so one stack's cookies can never
  validate against another's.
- **Salt anything that seals or signs.** The slug is public — the app publishes it as
  `NUXT_PUBLIC_STORAGE_PREFIX` in every SSR payload, and `lt dev tunnel` can put that app on a
  public URL. `sha256('lt-dev:session:<slug>')` therefore handed any visitor the key sealing its
  sessions. The salt (`~/.lenneTech/dev-session-salt`, 0600, created with `wx` so parallel shards
  cannot race to two different salts) keeps determinism and removes the guessability. Deriving a
  credential from a public identifier is zero entropy however good the hash is.
- **A new key is a new name SIX enumerations must learn:** the `dev-env.ts` file-header
  "Cross-wiring protection" list, the `ENV builder` row of the touchpoint table above, the
  "Cross-wiring protection" paragraph below it, `dev-env-bridge.ts#writeEnvBridge` (external
  runners), `dev-patches.ts#patchClaudeMd` (consumer projects' Claude sessions), and both env-var
  tables in `docs/commands.md`.
- **Say who consumes it.** `NUXT_SESSION_PASSWORD` is inert for the standard lt stack —
  nuxt-base-starter and nuxt-extensions authenticate via Better Auth, not h3 sessions. It helps
  only projects that added h3 `useSession` / `nuxt-auth-utils` on top. A key listed in the
  injected-CLAUDE.md block next to `BASE_URL` reads as load-bearing everywhere unless you say so.
- **The bridge file is now credential-bearing.** `.lt-dev/.env` carries the sealing key, so it is
  written 0600 (and chmod'ed on rewrite, since `mode` only applies on create). Its header used to
  promise "no secrets" — a promise a later reviewer would have relied on.
- **A build dir built with that env carries it too.** `.output-test/` freezes the value as a Nitro
  runtime-config default, so the root `.dockerignore` needs `**/.output-*` and `**/.nuxt-*` —
  `**/.output` matches a path component exactly and covers neither.

### `oxlint.json` is not an oxlint config — and loading the real one is not neutral <!-- Added: 2026-09-14 -->
oxlint only auto-discovers `.oxlintrc.json` (`-c` default `./.oxlintrc.json`). nuxt-base-template
and nuxt-extensions shipped `oxlint.json`, so the project rules never applied. Verified with oxlint
1.67.0: a `no-console: error` rule in `oxlint.json` reports nothing, the same file as
`.oxlintrc.json` reports the call. `lt fullstack update` renames it via
`healOxlintrcFilename` (`src/lib/heal-oxlintrc.ts`): `git mv` for a tracked file, refuses a dirty
or symlinked one, never merges when both exist, and follows `-c`/`--config oxlint.json` references
in the app's package.json. `lt dev doctor` warns while only `oxlint.json` exists.
**The trap is the gate.** Loading the config enables rules like `no-console`, and oxlint's
suggestion for it is "Delete this console statement". Any auto-fix that still passes
`--fix-suggestions` would apply it. Checking only the root `scripts/check.mjs` is not enough: the
root wrapper runs each project's `lint:fix` script, and apps from the old template carry
`oxlint --fix --fix-suggestions` there and in their own `scripts/check.mjs`. So `lt fullstack
update` runs three steps in order: `healCheckWrapper` (root wrapper) →
`healDangerousOxlintFixFlags` (removes `--fix-suggestions` and `--fix-dangerously` as plain
arguments from root/app `package.json` incl. inline lint-staged, lint-staged configs and the app's
`scripts/check.mjs`; tracked-and-clean files only, never through a symlink, textual so formatting
survives) → `healOxlintrcFilename`, whose gate re-checks all of those files plus the root wrapper
and refuses while any still USES a flag. `lt dev doctor` warns on the same finding.
**Match a use, not a mention:** the current templates carry the comment "Never
`--fix-suggestions`". A plain `includes` check counted that and blocked the rename in apps that
were already fixed; `DANGEROUS_FIX_FLAG_USE` requires whitespace or a quote before the flag.

### A destructive self-heal must prove the hazard, not fail to recognise a guard <!-- Added: 2026-07-31 -->
Anything the CLI writes ONCE into a generated project has no update path — the core
updater only touches `src/core/`. `migrations-utils/migrate.js` is the example:
projects converted before the template stopped requiring `ts-node` unconditionally
kept a store that dies with `Cannot find module 'ts-node'` in the pruned production
image, silently, because `docker-entrypoint.sh` degrades a migration failure to a
warning on purpose. Hence `healVendorMigrateStore` in `lt fullstack update`, next to
`healCheckWrapper` / `healVendorClaudeMd`.

**The trap is the detection direction.** The first version asked "can I SEE a guard?"
and treated "no" as proof that none exists — it knew exactly two shapes
(`require.resolve` probe, `try {`), so a production-safe
`if (!fs.existsSync(compiled)) require('./ts-compiler')` read as broken and was
replaced. And the replacement is NOT behaviour-neutral: the bundled template
hardcodes the collection name and takes its URI from `./mongo-uri`, so the project's
ledger came back EMPTY and the next `migrate:up` re-ran every historical migration
against the live database.

**Rules for any heal that overwrites project code:**
- Prove the hazard positively (`hasTopLevelTsCompilerRequire`: the require must be a
  TOP-LEVEL, unconditional statement). Everything conditional is the project's own
  solution. "Unrecognised" ≠ "absent".
- Decide on the **AST**, not on regex-stripped text. A regex has no
  string/template/regex-literal state, so a `/*` or `//` inside a literal erases the
  guard from the analysed text and triggers the overwrite. (`lib/strip-comments.ts`
  already solves the comment half with the TS scanner — reuse it or go one better.)
- Establish recoverability directly: empty `git status --porcelain` does NOT mean
  "committed", it also means ignored / untracked / not a repo — precisely the cases
  where nothing can be recovered. Use `git ls-files --error-unmatch`, write a `.bak`
  when git has no copy, skip a tracked-but-dirty file, and write via temp+rename.
- Never write through a symlink.

### An asset installed into a project must ship its whole import closure — and move atomically <!-- Added: 2026-08-23 -->
`healCheckWrapper` copied exactly one file, `scripts/check.mjs`. When the wrapper grew
a relative import (`./build-test-gate.mjs`), every project migrated by
`lt fullstack update` got a `check` whose FIRST import resolves to nothing:
`ERR_MODULE_NOT_FOUND` before step one — and the CLI reported success, because it had
copied the file it was asked to copy.
**Rule 1 — derive the set from the asset's own imports** (`resolveCopySet`, transitive,
matching BOTH quote styles: these templates are formatted by the *consuming* project,
so their quote style is not ours to assume; resolved against the IMPORTING file and
including subdirectories like `./lib/…`, but never outside the asset dir). Deriving from "every `.mjs` in the
directory" is the tempting shortcut and is wrong in the other direction — it turns the
template dir into a live namespace over the project's `scripts/`, so any file a future
contributor drops there lands in every user project.
**Rule 2 — the set moves ALL-OR-NOTHING.** This is the subtle one, and it bit here:
the per-file guard *created* the very drift the change existed to prevent. The guard
skips a file with uncommitted changes, and `git status --porcelain` reports an
untracked file as `??` — but the FIRST heal's own output is an untracked sibling. On
the next update `check.mjs` (tracked, clean) moved forward while its sibling was
"protected", leaving the two on different versions. Reproduce: heal, commit nothing,
heal again with a newer bundle.
**Rule 3 — untracked ≠ precious.** Establish recoverability positively
(`git ls-files --error-unmatch`): a tracked-and-dirty file is real work and must be
refused; anything git does not track is unrecoverable, so it gets a `.bak` and is then
replaced. Refusing there instead permanently blocks the update, because the CLI's own
prior output is untracked. And never write through a symlink (`lstatSync` before
`copyFileSync` — the link blob reads as clean, so the git guard cannot see it), and
write via temp+rename.
**Rule 4 — every diagnostic that knows the old asset must learn the new set.**
`lt dev doctor` compared only `check.mjs` and printed a green "matches the canonical
CLI version" for a project whose `check` could not start at all — and doctor is exactly
what people run at that moment.

### Hoisting a settings-only `pnpm-workspace.yaml` DELETES it — so every field must be hoisted <!-- Added: 2026-07-31 -->
`hoistFromSubWorkspaceYaml` removes a sub-project's settings-only
`pnpm-workspace.yaml` after hoisting. A field missing from
`WORKSPACE_SCOPED_PNPM_FIELDS` (`src/lib/hoist-workspace-pnpm-config.ts`) is
therefore not merely *ignored*, it is **destroyed**. `auditConfig` was missing, so the
starter's assessed-advisory allowlist (`ignoreGhsas` / `ignoreCves`) vanished and a
generated project's first CI run went red on an advisory already justified upstream —
with the deploy-blocking audit gate as the messenger. It also needs a level DEEPER
merge than the flat object fields (`NESTED_ARRAY_FIELDS`): a plain key-by-key merge
lets the sub-project's object replace the root's and drops every advisory the root
justified; the inner arrays must be unioned. **When adding a pnpm workspace setting
anywhere in the stack, add it here too and pick the right merge class** — flat object,
array-union, or nested-array-union — **and decide whether it joins `OBJECT_FIELDS`,
which is what makes it eligible for conflict detection.** Those are two separate
decisions: only the flat-object class can produce a silent loser (the union classes
keep both sides), so a new object-valued field that skips `OBJECT_FIELDS` merges
last-writer-wins with no warning. Note `auditConfig` SUPPRESSES vulnerability
findings, so hoisting widens its blast radius from one package to the whole
workspace; `annotateAuditConfig` writes that fact into the YAML as a comment so a
reviewer sees it in the diff.

### Hoisting is destructive, so conflict detection only sees ONE run <!-- Added: 2026-08-24 -->
`hoistWorkspacePnpmConfig` returns `{ conflicts }` when two sources set the same key
of an object-valued field (`overrides`, `allowBuilds`) to different values — the merge
is last-writer-wins by iteration order, so without this the generated workspace carries
one value with no record that the other existed. `better-auth` is the worked example:
one protocol with two ends, so a version split there is a client and a server
disagreeing about their own wire format.

**The catch is that `hoistFields` DELETES each field from its source once it reaches the
root, and the provenance map lives only inside one call.** So in the incremental flow the
`add-*` commands exist for — `lt fullstack add-api`, later `lt fullstack add-app` — the
api's `pnpm.overrides` is already at the root and gone from `projects/api/package.json`
by the time app arrives. The app's differing value then reads as ordinary root-vs-sub
precedence (which is *intended* and must stay silent), and the sub-vs-sub check never
sees two values. Measured before the fix: api `better-auth@1.7.1` then app `1.7.2` →
`conflicts: []`, root silently on `1.7.2`.

The signal that distinguishes the two cases needs no persisted state: **a sub-project
that is present but contributed nothing** was hoisted by an earlier run. `init` on a
fresh directory has both halves contributing, so its root-seed overrides stay silent;
`add-app` has a dormant `projects/api`, so its overrides are reported —
`reportRootOverridesFromDormantSiblings`. The message says "if", names the sibling and
asks, because a hand-edited root or the lt-monorepo template's own seed produce the same
shape.

Three related rules in the same file, each with a test:
- **`sourceLabel` names the FILE, not the sub-project** (`projects/api/package.json#pnpm`
  vs `projects/api/pnpm-workspace.yaml`). A shared label made the guard
  `previous.source !== sourceLabel` swallow a repo contradicting *itself* across its own
  two config sources — the yaml won, and a stale leftover silently downgraded a pin.
- **`allowBuilds` corrects the merge, not just the report** (`applyDenyWins`): it decides
  which packages may run a postinstall script, so last-writer-wins would resolve a
  disagreement in favour of EXECUTING code another sub-project refused. `overrides` has no
  safe direction (a higher version is not a safer one), so there the warning is the whole
  answer. **Correcting the merge means the message has to be corrected with it**
  (`resolveKeptValue`): the first version announced the incoming value as the winner for
  every field, so on `allowBuilds` it stated the opposite of the file it had just written
  and sent the reader hunting for an allowed build script that was in fact denied. Only the
  end-to-end run against the compiled `build/` surfaced that — the unit tests asserted the
  merge result and the message separately, and each was right on its own.
- **Compare what the field's own normalisation will use** (`canonicaliseForCompare`):
  js-yaml 4 parses `esbuild: no` as the STRING `'no'` while `package.json#pnpm` carries
  the BOOLEAN `false`, and `syncBuildAllowlists` narrows both to `false` — reporting them
  sends someone through two repositories over two spellings of "deny".

Guards on the other side of the stack are complementary, not duplicates: lt-monorepo
3.10.0 checks the ASSEMBLED workspace (do api and app resolve the same version, do the
frameworks promise the same range, does anyone pin at all). This one runs earlier, at
the moment the two manifests are merged.

### `perfectionist/sort-modules --fix` moves a function WITHOUT its JSDoc <!-- Added: 2026-08-24 -->
`npx eslint --fix` reordering a module can detach a leading JSDoc block from the function
it documents and leave it stacked above whichever function lands in that slot. Observed in
`src/lib/workspace-integration.ts`: adding `reportWorkspaceConflicts` made the fixer move
`finalizeWorkspaceRoot` up the file, its 16-line JSDoc stayed behind, and the result was
one undocumented function plus two JSDoc blocks over the new one — both tsc and eslint
clean, so nothing failed. **After any `--fix` that reorders declarations, read the diff
rather than only the exit code**, and reattach by hand.

### A bare Docker service name is a Swarm alias — never use it as a DB host <!-- Added: 2026-07-31 -->
`lt deployment create`'s checklist spells the Mongo host out per stage
(`mongodb://<user>:<pass>@<project>-<stage>_mongo:27017/<db>?authSource=admin`)
instead of leaving it abstract. Reason: every other variable in that checklist carries
a concrete value, so a bare name forces the reader to invent one — and the only
reference in sight is the project's own `docker-compose.yml`, where the service is
called `mongo`. `mongodb://mongo:27017/…` is the natural guess and the wrong one:
TurboOps puts every stack on a shared overlay network, where the short name is an
alias that EVERY stack's `mongo` answers to. The connection lands on a foreign
project's database, and on a different one per connection. The symptoms never look
like configuration: writes split across two databases, sessions that vanish after a
reconnect, files whose bytes are "sometimes" missing — while the application's own DB
sits empty and the code is fully correct (DEV-2140). TurboOps rejects bare DB hosts
since v1.72.0, but only for stacks deployed after it.
**The prefix fixes WHICH database you reach, not WHO may reach it** — the overlay
network stays shared, so DB credentials are the actual boundary. Generalise: any host
in generated instructions that resolves through a shared container network must be
spelled out fully, with auth. A short name is not a name, it is a race.

### `git-commands.test.ts` runs in a throwaway clone — never against this checkout <!-- Added: 2026-07-31, rewritten: 2026-09-15 -->
The suite used to shell out to `lt git update` / `git create` / `git reset` inside THIS
working copy, against its GitHub remote. Two consequences:
- **Network:** a real `git fetch` per test; SSH connect timeout and Jest's
  `--testTimeout` are both 60 s, so offline, VPN or an SSH agent waiting for approval
  showed up as unrelated test timeouts.
- **Destruction:** `lt git update` without `--dry-run` is a real `git pull --rebase`.
  On a branch that diverged from its upstream — exactly the state after a local rebase,
  before the force-push — a plain `npm test` started an actual interactive rebase onto
  the old remote head and left it stuck in a conflict; the rest of the suite then ran
  against the half-rebased tree (29 suites red, 2026-09-15). Run from a `pre-push`
  hook, it would rebase the branch in the middle of the push.

**Now:** `createFixture()` builds a bare `origin.git` plus two clones in the OS tmpdir
(`main` and a tracked `feature/demo`), and every `lt git …` call runs with `cwd` set to
that clone and the hook git variables (`GIT_DIR`, `GIT_INDEX_FILE`, …) stripped. No
network, and the assertions are deterministic instead of branching on whatever state
the developer's checkout happens to be in (detached HEAD, dirty tree, no upstream are
now explicit test cases). **Rule:** a test that runs a mutating git command gets its own
repository. Never let it inherit the checkout it was started from.

### `filesystem.find` returns RELATIVE, separator-dependent paths <!-- Added: 2026-09-16 -->
gluegun's `filesystem.find` is fs-jetpack's, which returns `pathUtil.relative(cwd, path)`
(`lib/find.js:45`) — so `../../src/config.env.ts` on macOS and `..\..\src\config.env.ts`
on Windows. `api-mode.ts` picked the config file out of that list with
`file.endsWith('/config.env.ts')`. On Windows that matched nothing, so the
`// #region graphql` block carrying `graphQl: { … }` was stripped like any other region
and its `graphQl: false,` replacement was never written. `CoreModule.forRoot` reads a
missing `graphQl` as ENABLED, so the generated REST project built a GraphQL schema on
boot and died with `Cannot determine a GraphQL output type for the "arguments"` — at
START time, with nothing pointing back at the generator (measured on a Windows laptop,
2026-09-16, lt 1.47.0). **Rules:** never compare a `find` result with a `/`-prefixed
suffix; match the basename separator-agnostically (`isConfigEnvFile`, split on
`[\\/]`), which is also the only form a test on a POSIX host can prove. And do not let
a conversion rely on "some earlier step must have replaced it": `processApiMode('Rest')`
now ends in `assertGraphQlDisabled`, which inserts the switch into every environment
block that lacks it (ts-morph, CRLF preserved) and throws a named error when one still
does — a project that cannot boot must not leave the generator.
The same assumption was checked everywhere else it appears. Two carried real damage and
were fixed with it: `dev-package-manager.ts#inferNameFromBin` (an `LT_PM_BIN` pointing at
`…\pnpm.cmd` resolved to `unknown`, so the CLI drove the wrong manager — it now reads the
file name and strips `.cmd/.exe/.bat/.ps1`) and `workspace-integration.ts#isWithinDir`
(`startsWith(`${dir}/`)` made a command run inside `projects\api` look like it was outside
the workspace, so the standalone gate never fired). Three are harmless and were left
alone: `doctor.ts` compares against `rel` strings this repo builds with `/` itself,
`vendor-claude-md.ts` joins with `/`, which Node accepts on Windows, and
`server.ts:1413`'s `startsWith('/')` only decides whether to call `resolve()`, which is a
no-op on an already-absolute `C:\…` path.

### npm runs package.json scripts through cmd.exe on Windows <!-- Added: 2026-09-11 -->
The `postinstall` guard `node bin/postinstall.js 2>/dev/null || true` was meant to make
completion setup unable to fail the install. Under cmd.exe (npm's default script shell
on Windows) the redirect has no `/dev/null` and `true` is not a command, so the guard
itself made `npm i -g @lenne.tech/cli` fail there. **Rules:** a script that must never
fail guards itself in code (`bin/postinstall.js` wraps `main()` in try/catch) instead of
in shell syntax; no `2>/dev/null`, `|| true`, POSIX env prefixes or single quotes in
`package.json#scripts` — `__tests__/package-scripts-portable.test.ts` enforces it
(`bash scripts/*.sh` entries are a separate, known gap). Child processes for our own
entry point run as `process.execPath` + `bin/lt`, never `lt` from PATH: during a global
install the bin link may not exist yet, and on Windows it is a `.cmd` shim that cannot
be spawned without a shell.

### A hook in a linked worktree inherits GIT_DIR — and hands it to the test suite <!-- Added: 2026-09-14 -->
In a linked worktree (`git worktree add`) git exports `GIT_DIR=<repo>/.git/worktrees/<name>`
to hooks; in the main checkout it does not. `.husky/pre-push` runs `npm run test`, and many
tests spawn git in temporary repos (`git init`, `git config`, `git branch -m`, `git commit`).
With `GIT_DIR` inherited, every one of those calls hit the real repository instead. One push
renamed the branch being pushed to `dev`, committed 14 fixture commits onto it, created
`feat/DEV-2381`/`feat/slot-2`/`release/1.0`, and wrote `core.bare=true` plus a `Test` user into
the shared `.git/config` — which every worktree reads. The push itself failed on the resulting
test errors, so nothing left the machine. It surfaced only once the hook was repaired: before,
it died on the missing `husky.sh` before running anything in a worktree. **Rules:** a hook
that runs tests first `unset`s `GIT_DIR GIT_WORK_TREE GIT_INDEX_FILE`
(`__tests__/husky-hooks.test.ts` guards it). A test that spawns git must not rely on the ambient
environment being clean. After an unexpected hook failure, check `git config --local --list`
and `git for-each-ref --sort=-committerdate` before anything else.

### Find binaries with `findExecutable`, spawn third-party tools with `spawnCmdSync` <!-- Added: 2026-09-14 -->
Two habits that work on macOS/Linux fail on native Windows. `spawnSync('which', [x])`
finds nothing, because PowerShell and cmd.exe have no `which`. `spawnSync('npm', …)` or
`spawnSync('…\claude.cmd', …)` fails because npm-installed tools are `.cmd` shims, and
Node refuses to spawn those without a shell (CVE-2024-27980, `EINVAL`). Adding
`shell: true` would bring back shell interpretation of arguments. **Rules:** resolve a
binary with `src/lib/platform.ts#findExecutable` (PATH + PATHEXT in Node, well-known
install locations as `candidates`). Run a tool that may be a shim with `spawnCmdSync`
(cross-spawn: plain `spawnSync` on POSIX, escaped cmd.exe call on Windows). The escaping
is not airtight for global npm shims (`%APPDATA%\npm\*.cmd` re-parse `%*`), so pass plain
arguments only, never untrusted free text. Platform,
env and file probe are injectable, so write the Windows branch as a test on any host
(`__tests__/platform.test.ts`). Migrated so far: Claude/Codex lookup, plugin
requirements. The `lt dev` spawn sites (`dev-process.ts`, `dev/up.ts`, …) and
`dev-service.ts#resolveCaddyBin` are not migrated yet. They follow once the Windows
laptop test settles process lifecycle and the Caddy mode.

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

**Global flags on every subcommand** (intercepted before `run()`, so the command never executes when set):
- `--help` / `-h` — human-readable help.
- `--help-json` — same help as a single JSON document on stdout. Stable contract (`HelpJsonShape` in `src/lib/command-help.ts`); always includes `command`, `description`, `options`, `globalFlags` and a `richHelp` boolean. Use this when an AI agent needs to discover a command's surface programmatically.
- `--noConfirm` — skip confirmations.

When adding a new command, the global `installHelpInterceptor` ([src/cli.ts:28](src/cli.ts#L28) → [src/lib/command-help.ts](src/lib/command-help.ts)) handles `--help` and `--help-json` automatically. Export `const help: CommandHelp` from the command module to make the JSON payload rich (`richHelp: true`); without it the agent still gets a usable fallback with the global flags and the gluegun metadata. Because gluegun commands use `module.exports = XCommand`, attach it via `module.exports = Object.assign(XCommand, { help })` — a bare `export const help` is clobbered by that reassignment (see Gotchas & Learnings).

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
