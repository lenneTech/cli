# Command Reference for lt

This document provides a comprehensive reference for all `lt` CLI commands. For configuration file options, see [lt.config.md](./lt.config.md).

## Related Documentation

- **[LT-ECOSYSTEM-GUIDE](./LT-ECOSYSTEM-GUIDE.md)** — Complete reference for `lt` CLI **and** the `lt-dev` Claude-Code Plugin including architecture, vendor-mode workflows, agents, and skills
- **[VENDOR-MODE-WORKFLOW](./VENDOR-MODE-WORKFLOW.md)** — Step-by-step guide for converting a project from npm mode to vendor mode, updating it, and optional rollback
- **[lt.config.md](./lt.config.md)** — Configuration file reference

## Table of Contents

- [Global Flags](#global-flags)
- [CLI Commands](#cli-commands)
- [Server Commands](#server-commands)
- [Local Development Commands](#local-development-commands)
- [Ticket Commands](#ticket-commands)
- [Ports Commands](#ports-commands)
- [Git Commands](#git-commands)
- [Fullstack Commands](#fullstack-commands)
- [Deployment Commands](#deployment-commands)
- [NPM Commands](#npm-commands)
- [Frontend Commands](#frontend-commands)
- [Config Commands](#config-commands)
- [Utility Commands](#utility-commands)
- [Database Commands](#database-commands)
- [Directus Commands](#directus-commands)
- [TypeScript Commands](#typescript-commands)
- [Starter Commands](#starter-commands)
- [Claude Commands](#claude-commands)
- [Blocks & Components](#blocks--components)
- [Template Commands](#template-commands)
- [Other Commands](#other-commands)

---

## Global Flags

These flags work on **every** `lt` subcommand. They are intercepted before the command's `run()` fires, so the command is never executed when one of them is set.

| Flag | Description |
|--------|-------------|
| `--help`, `-h` | Print human-readable help (usage, aliases, options, examples). |
| `--help-json` | Print the same help as a single JSON document on stdout. Stable contract — see shape below. Intended for AI agents and tooling that want to discover a command's surface programmatically. |
| `--noConfirm` | Skip interactive confirmations (where supported by the command). |

**`--help-json` payload shape** (`HelpJsonShape` in [src/lib/command-help.ts](../src/lib/command-help.ts)):

```jsonc
{
  "aliases": ["c"],
  "command": "lt server create",
  "configuration": "commands.server.create.*",
  "description": "Create new server",
  "examples": ["server create --name Foo --noConfirm"],
  "features": ["..."],
  "globalFlags": [
    { "flag": "--help",      "type": "boolean", "description": "..." },
    { "flag": "-h",          "type": "boolean", "description": "..." },
    { "flag": "--help-json", "type": "boolean", "description": "..." }
  ],
  "name": "create",
  "options": [
    { "flag": "--name", "type": "string", "required": true, "description": "Server name" }
  ],
  "richHelp": true
}
```

- `richHelp: true` means the command exported a typed `CommandHelp` — `options`, `features`, `examples` and `configuration` are authoritative.
- `richHelp: false` means only gluegun metadata was available — `options` is the empty array, but `globalFlags` is still guaranteed.

---

## CLI Commands

### `lt cli create`

Creates a new CLI project based on the lenne.Tech CLI starter.

**Usage:**
```bash
lt cli create [name] [options]
```

**Options:**
| Option | Description |
|--------|-------------|
| `--author <name>` | Author name for the CLI |
| `--link` | Link CLI globally after creation |
| `--nolink` | Skip linking |

**Configuration:** `commands.cli.create.author`, `defaults.author`

---

### `lt cli rename`

Renames the current CLI project.

**Usage:**
```bash
lt cli rename <new-name>
```

---

## Server Commands

### `lt server create`

Creates a new standalone NestJS server project in a sibling directory. For an in-workspace API, prefer [`lt fullstack add-api`](#lt-fullstack-add-api).

**Usage:**
```bash
lt server create [name] [options]
```

**Options:**
| Option | Description |
|--------|-------------|
| `--name <name>` | Server name (preferred over the positional argument) |
| `--description <text>` | Project description |
| `--author <name>` | Author name |
| `--api-mode <Rest\|GraphQL\|Both>` | API mode (ignored with `--next`) |
| `--framework-mode <npm\|vendor>` | Framework consumption mode (ignored with `--next`) |
| `--framework-upstream-branch <ref>` | Upstream `nest-server` branch/tag/commit to vendor (only with `--framework-mode vendor`) |
| `--branch <branch>` / `-b` | Branch of nest-server-starter to use as template |
| `--copy <path>` / `-c` | Copy from local template directory instead of cloning |
| `--link <path>` | Symlink to local template directory (fastest, changes affect original) |
| `--git` | Initialize git repository |
| `--next` | **Experimental:** clone [`nest-base`](https://github.com/lenneTech/nest-base) (Bun + Prisma 7 + Postgres + Better-Auth) instead of `nest-server-starter`. Skips API-mode / vendor-mode / install / lt.config.json processing. |
| `--dry-run` | Print the resolved plan and exit without making any changes |
| `--force` | Override the workspace-detection abort under `--noConfirm` |
| `--noConfirm` | Skip confirmation prompts |

**Workspace-awareness:** When run inside a directory that already looks like a fullstack workspace (contains `pnpm-workspace.yaml` or `projects/`), the command behaves differently per mode:

- **interactive** → asks for confirmation before creating a stray standalone clone
- **`--noConfirm` without `--force`** → **refuses** with exit code 1 and points the caller to `lt fullstack add-api`. This is the default behaviour for AI agents and CI scripts: fail loud rather than produce a stray clone that pnpm-workspace.yaml does not pick up.
- **`--noConfirm --force`** → proceeds and logs a hint so the override is visible in CI logs.

**CLAUDE.md Patching:** If the project contains a `CLAUDE.md`, the generic API mode description is replaced with the selected mode. In single-mode projects (`Rest` or `GraphQL`), the "API Mode System" documentation section is condensed to a brief note. Skipped when `--next` is used.

**Configuration:** `commands.server.create.*`, `defaults.author`, `defaults.noConfirm`

---

### `lt server module`

Creates a new server module with model, service, controller/resolver.

**Usage:**
```bash
lt server module [options]
```

**Options:**
| Option | Description |
|--------|-------------|
| `--name <name>` | Module name |
| `--controller <type>` | Controller type: `Rest`, `GraphQL`, `Both`, `auto` |
| `--noConfirm` | Skip confirmation prompts |
| `--skipLint` | Skip lint fix after creation |

**Configuration:** `commands.server.module.*`, `defaults.controller`, `defaults.skipLint`, `defaults.noConfirm`

---

### `lt server object`

Creates a new embedded object (sub-document).

**Usage:**
```bash
lt server object [options]
```

**Options:**
| Option | Description |
|--------|-------------|
| `--name <name>` | Object name |
| `--skipLint` | Skip lint fix after creation |

**Configuration:** `commands.server.object.skipLint`, `defaults.skipLint`

---

### `lt server permissions`

Scans all server modules and generates a permissions report showing roles, restrictions, and security gaps.

**Usage:**
```bash
lt server permissions [options]
```

**Options:**
| Option | Description |
|--------|-------------|
| `--path <dir>` | Path to NestJS project (default: auto-detect) |
| `--output <file>` | Output file (default: `permissions.<format>`) |
| `--format <md\|json\|html>` | Output format (default: `html` for TTY, `json` for CI) |
| `--open` / `--no-open` | Open report in browser (default: `true` for TTY) |
| `--console` | Print summary to console |
| `--fail-on-warnings` | Exit code 1 on warnings (for CI/CD) |
| `--noConfirm` | Skip confirmation prompts |

**Configuration:** `commands.server.permissions.*`, `defaults.noConfirm`

---

### `lt server addProp`

Adds a property to an existing module or object.

**Usage:**
```bash
lt server addProp [options]
```

**Options:**
| Option | Description |
|--------|-------------|
| `--type <type>` | Target type: `Module` or `Object` |
| `--element <name>` | Target element name |
| `--skipLint` | Skip lint fix after creation |

**Configuration:** `commands.server.addProp.skipLint`, `defaults.skipLint`

---

### `lt server create-secret`

Creates a random secret key.

**Usage:**
```bash
lt server create-secret
```

---

### `lt server set-secrets`

Sets secrets in environment files.

**Usage:**
```bash
lt server set-secrets [options]
```

---

### `lt server test`

Runs server tests.

**Usage:**
```bash
lt server test
```

---

### `lt server convert-mode`

Convert an existing API (NestJS) project between npm mode and vendor mode for `@lenne.tech/nest-server`.

**Usage:**
```bash
lt server convert-mode --to <vendor|npm> [options]
```

**Options:**
| Option | Description |
|--------|-------------|
| `--to <mode>` | Target mode: `vendor` or `npm` (required) |
| `--upstream-branch <ref>` | Upstream branch/tag to vendor from (only with `--to vendor`) |
| `--version <version>` | nest-server version to install (only with `--to npm`, default: from VENDOR.md baseline) |
| `--dry-run` | Show the resolved plan without making any changes |
| `--noConfirm` | Skip confirmation prompt |

**Behavior:**

- **npm → vendor:**
  - Clones `@lenne.tech/nest-server` from GitHub at the specified tag (default: currently installed version)
  - Copies `src/core/`, `src/index.ts`, `src/core.module.ts`, `src/test/`, `src/types/`, and `LICENSE` to `<api-root>/src/core/`; places upstream `src/templates/` at `<api-root>/src/templates/` (outside `core/` so the runtime E-Mail template resolver works)
  - Applies flatten-fix on `index.ts`, `core.module.ts`, `test.helper.ts`, `core-persistence-model.interface.ts`
  - Rewrites all consumer imports from `'@lenne.tech/nest-server'` to relative paths
  - Merges upstream dependencies dynamically into `package.json`
  - Rewrites `migrate:*` scripts to use local `bin/migrate.js` with `ts-compiler.js` bootstrap
  - Adds `check:vendor-freshness` script
  - Creates `src/core/VENDOR.md` with baseline version + commit SHA
  - Prepends a vendor-mode notice block to `CLAUDE.md`

- **vendor → npm:**
  - Extracts baseline version from `src/core/VENDOR.md` (warns if local patches exist)
  - Rewrites consumer imports back to `@lenne.tech/nest-server`
  - Deletes `src/core/`
  - Restores `@lenne.tech/nest-server` dependency in `package.json`
  - Restores `migrate:*` scripts to `node_modules/.bin/` paths
  - Removes vendor artifacts (`bin/`, `migrations-utils/ts-compiler.js`, `migration-guides/`) and `CLAUDE.md` marker

**Examples:**
```bash
# Convert existing npm project to vendor mode at a specific version
cd projects/api
lt server convert-mode --to vendor --upstream-branch 11.24.3 --noConfirm

# Preview what the conversion would do
lt server convert-mode --to vendor --dry-run

# Convert vendored project back to npm with a specific version
lt server convert-mode --to npm --version 11.24.3 --noConfirm
```

**Note:** nest-server tags have **no** `v` prefix — use e.g. `11.24.3`, not `v11.24.3`.

For mode-aware update workflows after conversion, use:
- `/lt-dev:backend:update-nest-server-core` (vendor mode)
- `/lt-dev:backend:update-nest-server` (npm mode)
- `/lt-dev:fullstack:update-all` (coordinated backend + frontend)

---

## Local Development Commands

Run multiple lt projects in parallel without port collisions or cross-wiring.
**URL-first**: every project gets stable HTTPS URLs (`<slug>.localhost`,
`api.<slug>.localhost`) served by Caddy. Internal ports are opaque and
auto-allocated. Cross-project state (database, storage, cookies) is
namespaced by slug so projects cannot accidentally interfere.

### `lt dev`

Open the local-orchestration submenu.

**Usage:**
```bash
lt dev
```

**Alias:** `lt d`

---

### `lt dev install`

One-time per-machine setup. Idempotent — re-run anytime to diagnose what's missing. Owns the full Caddy lifecycle via a dedicated LaunchAgent (macOS) / systemd-user unit (Linux) — **does not** use `brew services caddy`, whose hardcoded `/opt/homebrew/etc/Caddyfile` path would crash-loop against our `~/.lenneTech/Caddyfile`.

**Usage:**
```bash
lt dev install
lt dev install --skip-init   # do NOT auto-run `lt dev init` afterwards
```

**Alias:** `lt d i`

**Auto-chaining:** when run from inside an lt-dev-capable project that is not yet initialized, `lt dev install` runs `lt dev init` for that project **afterwards**. Pass `--skip-init` to opt out. This is one hop deep and never recurses — `install` calls the init *helper*, not the init command.

**What it does:**
1. Verifies `caddy` is on PATH (suggests `brew install caddy` if missing).
2. Creates `~/.lenneTech/Caddyfile` stub if absent.
3. Detects a conflicting `brew services caddy` registration and asks you to stop it.
4. Writes + bootstraps a dedicated service:
   - **macOS:** `~/Library/LaunchAgents/tech.lenne.lt-dev-caddy.plist` via `launchctl bootstrap gui/<uid>`.
   - **Linux:** `~/.config/systemd/user/lt-dev-caddy.service` via `systemctl --user enable --now`.
5. Waits up to 8s for Caddy's admin endpoint (`http://127.0.0.1:2019/config/`) to respond.
6. Validates the Caddyfile.
7. Reminds you to run the CA trust command **with HOME preserved**:
   ```bash
   sudo -E HOME="$HOME" caddy trust
   ```
   Without `-E HOME="$HOME"`, sudo switches HOME to `/var/root` and caddy cannot find its user-scoped CA — this was the bug that blocked the very first install attempt.

**Logs:** `~/.lenneTech/caddy.log`, `~/.lenneTech/caddy.err.log`.

---

### `lt dev uninstall`

Symmetric counterpart to `lt dev install`. Removes the LaunchAgent / systemd-user unit and stops the Caddy daemon. Does **not** remove the caddy binary itself.

**Usage:**
```bash
lt dev uninstall              # interactive: asks whether to purge Caddyfile + logs
lt dev uninstall --purge      # also remove ~/.lenneTech/Caddyfile + caddy logs
lt dev uninstall --noConfirm  # skip the purge prompt (keep files)
```

**Alias:** `lt d un`

**What it does NOT touch:**
- the `caddy` binary (use `brew uninstall caddy` if you want to remove the tool too)
- per-project state under `<project>/.lt-dev/` (use `lt dev down`)
- the trusted CA in the system keychain (use `sudo -E HOME="$HOME" caddy untrust` if desired)

---

### `lt dev init`

Initialize an existing project for `lt dev` and apply idempotent env-aware patches. Safe to run multiple times; safe to run after `lt fullstack init`.

**Usage:**
```bash
lt dev init
lt dev init --skip-install   # do NOT auto-run `lt dev install` first
```

**Alias:** `lt d init`, `lt d migrate`, `lt d m` (`migrate` is the former name, kept for backwards compatibility)

**Auto-chaining:** if the machine has not been prepared yet (no `lt dev install` has run), `lt dev init` runs the install step **first**, then initializes the project. Pass `--skip-install` to opt out. This is one hop deep and never recurses — `init` calls the install *helper*, not the install command.

**What it does:**
1. Detects the workspace layout (monorepo `projects/api`+`projects/app`, or standalone).
2. Builds the project identity (slug from `package.json` "name", subdomains).
3. Patches legacy hardcoded ports in `config.env.ts` (`port: 3000`), `nuxt.config.ts` (`port: 3001`, vite proxy target), `playwright.config.ts` (`baseURL`/`host`/`url`) to env-overridable form. Defaults preserved, idempotent.
4. Persists the entry to `~/.lenneTech/projects.json` (override path via `LT_DEV_REGISTRY_PATH`).
5. Adds `.lt-dev/` to the project's `.gitignore`.
6. Injects (or refreshes) a "Local Development (lt dev)" URL block into `CLAUDE.md` files at the workspace root and inside each subproject — bracketed by HTML comment markers.

---

### `lt dev up`

Start API + App behind Caddy. Allocates internal ports (4000+), spawns processes detached, persists PIDs to `<root>/.lt-dev/state.json`.

**Usage:**
```bash
lt dev up
```

**Alias:** `lt d u`

**Environment variables injected:**
| Variable | Consumer | Example value |
|----------|----------|---------------|
| `PORT` | Nest (api) / Nuxt (app) | auto-allocated 4000+ |
| `BASE_URL` / `NSC__BASE_URL` | nest-server canonical API URL | `https://api.crm.localhost` |
| `APP_URL` / `NSC__APP_URL` | nest-server frontend origin (CORS, BetterAuth) | `https://crm.localhost` |
| `NUXT_API_URL` | Nuxt vite-proxy target for `/api`, `/iam`, … | `https://api.crm.localhost` |
| `NUXT_PUBLIC_API_URL` | Nuxt `useRuntimeConfig().public.apiUrl` | `https://api.crm.localhost` |
| `NUXT_PUBLIC_SITE_URL` | Nuxt `useRuntimeConfig().public.siteUrl` + Playwright | `https://crm.localhost` |
| `NUXT_PUBLIC_STORAGE_PREFIX` | namespaces sessionStorage/localStorage | `crm` |
| `NUXT_PUBLIC_API_PROXY` | always `false` — Caddy + cookie-domain make it obsolete | `false` |
| `NSC__MONGOOSE__URI` | nest-server Mongoose URI | `mongodb://127.0.0.1/crm-local` |
| `DATABASE_URL` | Postgres convenience URL (for nest-base-style projects) | `postgresql://crm-local:crm-local@localhost:5432/crm-local` |

**Override the binary** for both spawns via `LT_PNPM_BIN` (e.g. `LT_PNPM_BIN=/usr/local/bin/pnpm lt dev up`).

**Pre-flight guards (exit code 1 each):**
- Caddy not installed (`lt dev install` first)
- Caddy daemon not running (run `lt dev install` — it bootstraps the lt-dev service)
- A FRESHLY allocated internal port is already in use by a foreign process

**Health-aware (re)start (idempotent):** `lt dev up` is safe to re-run. It probes
the actual internal ports — not just the recorded supervisor PID — so it can tell
a still-serving component from a *crashed* one (the supervisor / nodemon survives a
ts-node crash and the recorded PID stays alive while nothing listens on the port).
Behaviour:
- **All present components truly serving** → no-op, exits 0 with "already running".
- **Some serving, some down** → restarts ONLY the down component(s); a healthy one
  keeps running untouched and its PID is preserved in the session.
- Before respawning a crashed component it terminates that supervisor's whole
  process group (so its idle `nodemon` doesn't leak / stack a second one) and
  reclaims any orphaned listener still squatting the reused port.

This is the fix for the "`status` says api running but no data loads" case: a
crashed ts-node dev API is healed by simply re-running `lt dev up` (it does not
fall back to compiled `node dist` — ts-node is kept so code edits hot-reload).

**Logs:** `<root>/.lt-dev/api.log`, `<root>/.lt-dev/app.log` (append-mode).

---

### `lt dev down`

Stop processes started by `lt dev up` and remove the project's Caddy block.

**Usage:**
```bash
lt dev down
```

**Alias:** `lt d d`

Sends `SIGTERM` to the detached process group (negative PID) so descendants — Vite, the Nest watcher, etc. — receive the signal too. PID values from `state.json` are validated before signaling. Best-effort: removes the project's Caddy block and reloads even if no session was active.

---

### `lt dev prune`

Remove the leftovers that accumulate around parallel ticket work.

**Usage:**
```bash
lt dev prune             # interactive (confirms DB drops, default yes)
lt dev prune --dry-run   # show the plan, change nothing
lt dev prune --noConfirm # documented default without a prompt
```

Collects three classes of orphans:

1. **Orphaned ticket databases** of the current project — `<base>-<id>` (+`-test`, `-test-<n>`) whose ticket has neither a live worktree nor a live registry entry. Ticket ids come from this repo's own `feat/*` branches (the durable record `lt ticket stop` keeps), never from name shapes — so sibling projects sharing a name prefix are safe. Databases recorded via `lt ticket stop --keep-db` are never touched.
2. **Stale shard test databases** (`<base>-test-<n>` from `lt dev test --shard`) when no test session is running.
3. **Dead registry entries** (any project) — the recorded path no longer exists, so the entry and its reserved internal ports are reclaimed. Databases of dead MAIN projects are never dropped (a deleted folder is not consent to destroy data).

`lt dev up` runs the same collection automatically after a successful start (opt out with `--no-prune`), so restarting an environment always cleans up after its predecessors. Database access uses `mongosh` when available and falls back to the project's own `mongodb` driver otherwise — a machine without mongosh no longer silently skips every drop.

---

### `lt dev status`

Show what is registered + running.

**Usage:**
```bash
lt dev status         # current project
lt dev status --all   # every project in the registry
```

**Alias:** `lt d s`

The current-project view shows subdomains → upstream ports, db URI, per-component
health, and live `lsof` state. **Health is honest:** a component is reported
`running` only when its supervisor PID is alive AND its internal port is actually
bound. A supervisor that survived a ts-node crash (PID alive, port free) is shown
as `crashed (supervisor up, port not listening)` instead of the old misleading
`running`, with a hint to run `lt dev up` to restart just that one.

The `--all` view lists every project with a single indicator:
- `●` (green) — all present components serving
- `◐` (yellow) — `degraded` (some up, some down) or `crashed` (supervisor up, port free)
- `○` (dim) — stopped

A single `lsof` snapshot covers every registered port, so `--all` stays fast.

---

### `lt dev tunnel`

Expose a running `lt dev up` project to the public internet via a Cloudflare Quick Tunnel. Foreground command — runs until Ctrl-C.

**Usage:**
```bash
lt dev tunnel              # tunnel the App
lt dev tunnel --api        # tunnel the API instead
```

**Alias:** `lt d tun`

**What it does:**
1. Checks `cloudflared` is on PATH (suggests `brew install cloudflared` otherwise).
2. Confirms the Caddy daemon is up (`lt dev install` must have run).
3. Spawns `cloudflared tunnel --url https://<slug>.localhost --http-host-header <slug>.localhost --no-tls-verify`. The host-header rewrite is required — without it Caddy would not match the project block for the random `*.trycloudflare.com` hostname.
4. Waits for cloudflared to publish the public URL (usually 5-10s) and prints it prominently.

**Caveats (also printed at runtime):**
- Auth cookies on the localhost domain are NOT valid on the `*.trycloudflare.com` URL — users log in again on the tunnel URL.
- Better-Auth's `trustedOrigins` won't include the random tunnel URL — login flows that validate the origin reject the request unless the URL is added explicitly to the API config.
- Default tunnels expose ONLY the App. For full external usage (e.g. external client calling the API), start a second `lt dev tunnel --api` in another shell — the API will be reachable on its own `*.trycloudflare.com` URL.

**Not yet supported (intentional scope limit):**
- Named tunnels with a persistent URL (`cloudflared tunnel create`)
- Multi-host tunneling in one process
- Background/detached mode

---

### `lt dev doctor`

Diagnose Caddy / CA / DNS / port issues. Exit code 0 = all green, 1 = at least one FAIL.

**Usage:**
```bash
lt dev doctor
```

**Alias:** `lt d doc`

**Checks:**
1. `caddy` on PATH
2. Caddy daemon running (admin endpoint `:2019` reachable)
3. Caddyfile validates
4. Ports 80 + 443 free or held by Caddy
5. `*.localhost` resolves to `127.0.0.1` (RFC 6761)
6. Registry status

---

### `lt dev test`

One-shot E2E wrapper: ensure `up`, wait for the App URL, run `pnpm run test:e2e` with the `.lt-dev/.env` bridge loaded. Optional teardown after.

**Usage:**
```bash
lt dev test                      # App E2E (projects/app)
lt dev test --api                # API E2E (projects/api) — no Caddy required
lt dev test --teardown           # plus `lt dev down` after
lt dev test --debug              # PWDEBUG=1 + HEADED=1
lt dev test -- --ui spec.ts      # everything after `--` is forwarded to playwright
```

**Alias:** `lt d t`

**Behaviour:**
1. Pre-flight: Caddy installed + daemon running (App mode only).
2. If no `lt dev up` session is alive: invokes `lt dev up` first.
3. Waits up to 30 s for the App URL to respond.
4. Reads `<root>/.lt-dev/.env` and merges into the spawn env (existing process.env wins for keys it defines).
5. Spawns `pnpm run test:e2e [forwarded args]` in `projects/api` (with `--api`) or `projects/app` (default).
6. With `--teardown`, runs `lt dev down` after.

**When to use this vs. `pnpm run test:e2e` directly:**
- Use **`lt dev test`** for TDD loops, ad-hoc reproduction, or when you want a single-command "ensure-up + run + teardown" flow.
- Use **direct `pnpm run test:e2e`** (or VS Code Playwright Extension, IDE test runners) for everyday work — the auto-injected `playwright.config.ts` bridge loads the `.lt-dev/.env` automatically, so the env is correct without the wrapper.

---

### ENV bridge for external test runners

`lt dev up` writes a `<root>/.lt-dev/.env` file with the following keys:

| Key | Source |
|-----|--------|
| `BASE_URL`, `APP_URL`, `NSC__BASE_URL`, `NSC__APP_URL` | Identity → `https://api.<slug>.localhost` / `https://<slug>.localhost` |
| `NUXT_API_URL`, `NUXT_PUBLIC_API_URL`, `NUXT_PUBLIC_SITE_URL` | Same URLs for Nuxt |
| `NUXT_PUBLIC_STORAGE_PREFIX` | Project slug |
| `NUXT_PUBLIC_API_PROXY` | Always `false` under `lt dev` |
| `NSC__MONGOOSE__URI`, `DATABASE_URL` | Project-namespaced DB URI (when `dbName` known) |
| `LT_DEV_ACTIVE`, `LT_DEV_DB_NAME` | Marker keys for consumers |
| `NODE_EXTRA_CA_CERTS` | Path to Caddy's root CA cert (auto-detected) |

`lt dev init` injects a tiny `// >>> lt-dev:bridge >>>` block at the top of `playwright.config.ts` that loads this file at config-load time — making Playwright (CLI, IDE, VS Code extension) automatically use the `lt dev` URLs and trust the local CA, without inheriting the parent shell.

`lt dev down` removes the bridge file so subsequent runs without `lt dev up` fall back cleanly to the classic `localhost:3000`/`localhost:3001` defaults.

---

## Ticket Commands

One fully isolated dev environment per ticket: a git worktree on its own branch, its own
`lt dev` stack, its own URLs (`<slug>-<id>.localhost`), its own ports, and its own database
(`<base>-<id>`). Several tickets run side by side without colliding.

### `lt ticket start`

Create a ticket environment: worktree + branch + isolated stack.

**Usage:**
```bash
lt ticket start DEV-2200
lt ticket start login-fix --as lf
lt ticket start DEV-2200 --base origin/develop --no-up
```

**Parameters:**

| Parameter | Description | Default |
|-----------|-------------|---------|
| `<name>` | Ticket id (`DEV-2200` → id `2200`) or free feature name (slugified) | — |
| `--as` | Explicit short id, overriding the derived one | derived from name |
| `--base` | Base ref for the new branch | probes `origin/dev` → `develop` → remote HEAD → `main` → `master` |
| `--branch` | Explicit branch name | `feat/<name>` |
| `--no-up` | Only create the worktree; do not boot the stack | `false` |

**Reserved ids:** `local`, `dev`, `test`, `e2e`, `ci`, `prod`, `production`, `staging` are
refused. Their derived database name would collide with the *project's own* dev/test
database (both derivations strip a trailing `-(local|dev)` before appending their suffix,
so e.g. project DB `imo-local` + ticket id `local` derives back to `imo-local`). Use `--as`
to map such a name to a distinct id.

---

### `lt ticket stop`

Tear a ticket environment down: stop the stack, remove the worktree, **drop the ticket's
databases**. The branch is kept, so committed work is never lost.

**Usage:**
```bash
lt ticket stop 2200
lt ticket stop 2200 --keep-db
lt ticket stop                  # from INSIDE a ticket worktree → cleans up "this" env
```

**Parameters:**

| Parameter | Description | Default |
|-----------|-------------|---------|
| `<id>` | Ticket id. Omit it inside a ticket worktree to stop *that* environment | from `.lt-dev/ticket` marker |
| `--keep-db` | Keep the ticket databases instead of dropping them | `false` (they ARE dropped) |
| `--force` | Remove even with uncommitted changes / unpushed commits | `false` |
| `--noConfirm` | Skip the confirmation prompt for the database drop | `false` |
| `--drop-db` | **Deprecated no-op** — dropping is the default now | — |

**Databases are dropped by default.** `lt ticket stop` removes the whole environment —
worktree *and* registry entry — so its databases are orphans the moment it returns: nothing
references them, nothing lists them, nothing reuses them. Left behind, they simply
accumulate. The command asks before dropping (unless `--noConfirm`), and `--keep-db` opts
out entirely.

**What it will never drop:** the project's own `<base>-local` / `<base>-test` databases, a
database belonging to a *different* ticket, or one named by a registry entry that turns out
to belong to another checkout. Anything that is not provably this ticket's database is
refused with a warning rather than guessed at.

**Ordering:** the worktree is removed *before* the databases are dropped. Removing a worktree
can fail (locked, modified submodule, permissions); dropping a database cannot be undone. So
the fallible step runs first — if it fails, nothing was destroyed.

---

### `lt ticket list`

Dashboard of all ticket environments: URLs, branch, status, database.

**Usage:**
```bash
lt ticket list
```

---

### `lt ticket switch`

Print a ticket worktree's path and open it in the editor.

**Usage:**
```bash
lt ticket switch 2200
```

---

### `lt ticket test`

Run the E2E suite inside a ticket's isolated stack and database.

**Usage:**
```bash
lt ticket test 2200
lt ticket test 2200 --shard 2
```

---

## Git Commands

All git commands support the `--noConfirm` flag and can be configured via `defaults.noConfirm` or `commands.git.noConfirm`.

**Commands with `--dry-run` support:** create, update, clear, force-pull, reset, undo, clean, squash, rebase, rename - preview changes without executing them.

### `lt git create`

Creates a new git branch from a base branch.

**Usage:**
```bash
lt git create <branch-name> [base-branch] [options]
```

**Options:**
| Option | Description |
|--------|-------------|
| `--base <branch>` | Base branch for the new branch |
| `--noConfirm` | Skip confirmation prompts |
| `--dry-run` | Preview what would be created without making changes |

**Configuration:** `commands.git.create.base`, `commands.git.baseBranch`, `defaults.baseBranch`

---

### `lt git get`

Checks out a git branch (local or remote).

**Usage:**
```bash
lt git get <branch-name> [options]
```

**Options:**
| Option | Description |
|--------|-------------|
| `--noConfirm` | Skip confirmation prompts |
| `--mode hard` | Remove local commits automatically |

**Configuration:** `commands.git.get.*`, `defaults.noConfirm`

---

### `lt git squash`

Squashes all commits in the current branch.

**Usage:**
```bash
lt git squash [base-branch] [options]
```

**Options:**
| Option | Description |
|--------|-------------|
| `--noConfirm` | Skip confirmation prompts |
| `--dry-run` | Preview commits that would be squashed |
| `--author <name>` | Author for the squash commit |
| `--message <text>` | Commit message |

**Configuration:** `commands.git.squash.*`, `defaults.noConfirm`, `defaults.baseBranch`, `defaults.author`

---

### `lt git rebase`

Rebases the current branch onto another branch.

**Usage:**
```bash
lt git rebase [base-branch] [options]
```

**Options:**
| Option | Description |
|--------|-------------|
| `--noConfirm` | Skip confirmation prompts |
| `--dry-run` | Preview commits that would be rebased |
| `--base <branch>` | Base branch for rebase |

**Configuration:** `commands.git.rebase.*`, `defaults.noConfirm`, `defaults.baseBranch`

---

### `lt git clear`

Clears all current changes (hard reset).

**Usage:**
```bash
lt git clear [options]
```

**Options:**
| Option | Description |
|--------|-------------|
| `--noConfirm` | Skip confirmation prompts |
| `--dry-run` | Preview what would be discarded |

**Configuration:** `commands.git.clear.noConfirm`, `defaults.noConfirm`

---

### `lt git force-pull`

Force pulls the current branch, discarding local changes.

**Usage:**
```bash
lt git force-pull [options]
```

**Options:**
| Option | Description |
|--------|-------------|
| `--noConfirm` | Skip confirmation prompts |
| `--dry-run` | Preview what would be lost |

**Configuration:** `commands.git.forcePull.noConfirm`, `defaults.noConfirm`

---

### `lt git reset`

Resets the current branch to match the remote.

**Usage:**
```bash
lt git reset [options]
```

**Options:**
| Option | Description |
|--------|-------------|
| `--noConfirm` | Skip confirmation prompts |
| `--dry-run` | Preview what would be reset |

**Configuration:** `commands.git.reset.noConfirm`, `defaults.noConfirm`

---

### `lt git undo`

Undoes the last commit (keeps files).

**Usage:**
```bash
lt git undo [options]
```

**Options:**
| Option | Description |
|--------|-------------|
| `--noConfirm` | Skip confirmation prompts |
| `--dry-run` | Preview the commit that would be undone |

**Configuration:** `commands.git.undo.noConfirm`, `defaults.noConfirm`

---

### `lt git rename`

Renames the current branch.

**Usage:**
```bash
lt git rename <new-name> [options]
```

**Options:**
| Option | Description |
|--------|-------------|
| `--noConfirm` | Skip confirmation prompts |
| `--dry-run` | Preview the rename operation |
| `--deleteRemote` | Delete remote branch after rename |

**Configuration:** `commands.git.rename.noConfirm`, `defaults.noConfirm`

---

### `lt git update`

Updates the current branch (fetch + pull + npm install).

**Usage:**
```bash
lt git update [options]
```

**Options:**
| Option | Description |
|--------|-------------|
| `--skipInstall` | Skip npm install after update |
| `--dry-run` | Preview incoming commits without making changes |

**Configuration:** `commands.git.update.skipInstall`, `defaults.skipInstall`

---

### `lt git clean`

Removes local merged branches.

**Usage:**
```bash
lt git clean [options]
```

**Options:**
| Option | Description |
|--------|-------------|
| `--noConfirm` | Skip confirmation prompts |
| `--dry-run` | Preview which branches would be deleted |

**Configuration:** `commands.git.clean.noConfirm`, `defaults.noConfirm`

---

### `lt git install-scripts`

Installs bash scripts for git operations to `~/.local/bin/`.

**Usage:**
```bash
lt git install-scripts
```

Installs helper scripts:
- `git-squash` - Squash commits
- `git-rebase` - Rebase branch
- `git-clear` - Clear changes
- `git-force-pull` - Force pull
- etc.

---

## Fullstack Commands

### `lt fullstack init`

Creates a new fullstack workspace with API and frontend.

**Usage:**
```bash
lt fullstack init [options]
```

**Options:**
| Option | Description |
|--------|-------------|
| `--name <name>` | Project name |
| `--frontend <type>` | Frontend framework: `angular` or `nuxt` |
| `--api-branch <branch>` | Branch of nest-server-starter to use for API |
| `--api-copy <path>` | Copy API from local template directory |
| `--api-link <path>` | Symlink API to local template (fastest, changes affect original) |
| `--frontend-branch <branch>` | Branch of frontend starter to use (ng-base-starter or nuxt-base-starter) |
| `--frontend-copy <path>` | Copy frontend from local template directory |
| `--frontend-link <path>` | Symlink frontend to local template (fastest, changes affect original) |
| `--framework-mode <mode>` | Backend framework consumption mode: `npm` (classic) or `vendor` (pilot, core copied to `src/core/`) |
| `--framework-upstream-branch <ref>` | Upstream `nest-server` branch/tag to vendor from (only with `--framework-mode vendor`) |
| `--frontend-framework-mode <mode>` | Frontend framework consumption mode: `npm` or `vendor` (nuxt-extensions copied to `app/core/`) |
| `--next` | **Experimental:** clone [`nest-base`](https://github.com/lenneTech/nest-base) (Bun + Prisma 7 + Postgres + Better-Auth) for the API instead of `nest-server-starter`. Forces `--api-mode Rest` and `--framework-mode npm`, skips workspace install (run `pnpm install` for app and `bun install` for api manually). |
| `--dry-run` | Print the resolved plan without making any changes |
| `--git` | Push initial commit to remote repository (git is always initialized) |
| `--git-link <url>` | Git remote repository URL (required when `--git` is true) |
| `--noConfirm` | Skip confirmation prompts |

**Note:** Git is always initialized with the `dev` branch. The `--git` flag only controls whether the initial commit is pushed to a remote repository.

**Note:** For Nuxt frontends with `--frontend-copy` or `--frontend-link`, specify the path to the `nuxt-base-template/` subdirectory, not the repository root.

**CLAUDE.md Patching:** If the workspace contains a `CLAUDE.md` file, the following template placeholders are replaced with project-specific values:

| Placeholder | Replaced with |
|-------------|---------------|
| `{{PROJECT_NAME}}` | Project name |
| `{{PROJECT_DIR}}` | Absolute project directory path |
| `{{API_MODE}}` | Selected API mode (`Rest`, `GraphQL`, or `Both`) |
| `{{FRONTEND_FRAMEWORK}}` | Frontend framework (`Nuxt 4` or `Angular`) |

Additionally, the API's `CLAUDE.md` is patched to reflect the selected API mode — the generic "API Mode" description is replaced with the chosen mode, and in single-mode projects (`Rest` or `GraphQL`), the "API Mode System" section is condensed.

**Configuration:** `commands.fullstack.*`, `defaults.noConfirm`

**Auto-detection in existing workspaces:** When `lt fullstack init` runs without a name argument inside a directory that already looks like a fullstack workspace (contains `pnpm-workspace.yaml` or `projects/`), it inspects the layout and dispatches to the matching incremental command:

- both `projects/api` and `projects/app` exist → refuses with a hint to use `add-api` / `add-app` directly
- only `projects/app` exists → delegates to `lt fullstack add-api` (with all original flags forwarded)
- only `projects/api` exists → delegates to `lt fullstack add-app`
- neither exists → falls through to the regular new-workspace flow

To force a brand-new workspace from inside an existing one, pass `--name <slug>`.

---

### `lt fullstack add-api`

Add a NestJS API (`projects/api/`) to an existing fullstack workspace that currently only contains a frontend (`projects/app/`). Mirrors every API-related flag from `lt fullstack init` so configuration stays consistent across both flows.

**Usage:**
```bash
lt fullstack add-api [options]
```

**Options:**
| Option | Description |
|--------|-------------|
| `--api-mode <mode>` | API mode: `Rest`, `GraphQL`, or `Both` |
| `--framework-mode <mode>` | Backend framework consumption mode: `npm` (classic) or `vendor` (core copied to `src/core/`) |
| `--framework-upstream-branch <ref>` | Upstream `nest-server` branch/tag/commit to vendor (only with `--framework-mode vendor`) |
| `--api-branch <branch>` | Branch of `nest-server-starter` to clone |
| `--api-copy <path>` | Copy API from a local template directory |
| `--api-link <path>` | Symlink API to a local template directory (fastest, changes affect original) |
| `--next` | **Experimental:** clone [`nest-base`](https://github.com/lenneTech/nest-base) (Bun + Prisma 7 + Postgres + Better-Auth) instead of `nest-server-starter`. Forces `--api-mode Rest` and `--framework-mode npm`, runs `bun run rename` post-clone, skips workspace install. |
| `--workspace-dir <path>` | Workspace root. When omitted, defaults to cwd; if cwd is not a workspace, the command walks up until it finds one (so it works from inside `projects/api/src/`). |
| `--skip-install` | Skip `pnpm install` and the post-install format pass |
| `--dry-run` | Print the resolved plan without making any changes |
| `--noConfirm` | Skip all interactive prompts |

**Refusal cases:**
- `projects/api/` already exists → suggests `lt fullstack init` in a fresh directory
- no workspace detected at the target path → asks the user to run `lt fullstack init` first

**Side effects:** writes `projects/api/lt.config.json` with the resolved `apiMode` + `frameworkMode`, hoists workspace-scoped `pnpm.overrides` from sub-projects to the root, runs `pnpm install` + `oxfmt` on the new sub-project (unless `--skip-install` is set).

**Configuration:** Reads `commands.fullstack.*` (same keys as `lt fullstack init`).

---

### `lt fullstack add-app`

Add a frontend app (`projects/app/`) to an existing fullstack workspace that currently only contains an API (`projects/api/`). Mirrors every frontend-related flag from `lt fullstack init`.

**Usage:**
```bash
lt fullstack add-app [options]
```

**Options:**
| Option | Description |
|--------|-------------|
| `--frontend <type>` | Frontend framework: `nuxt` or `angular` |
| `--frontend-framework-mode <mode>` | Frontend framework consumption mode: `npm` or `vendor` (nuxt-extensions copied to `app/core/`) |
| `--frontend-branch <branch>` | Branch of the frontend starter to clone (`ng-base-starter` or `nuxt-base-starter`) |
| `--frontend-copy <path>` | Copy frontend from a local template directory |
| `--frontend-link <path>` | Symlink frontend to a local template directory (fastest, changes affect original) |
| `--next` | Default the nuxt-base-starter ref to the `next` branch (auth `basePath` aligned with the experimental `--next` API) |
| `--workspace-dir <path>` | Workspace root. When omitted, defaults to cwd; if cwd is not a workspace, the command walks up until it finds one (so it works from inside `projects/api/src/`). |
| `--skip-install` | Skip `pnpm install` and the post-install format pass |
| `--dry-run` | Print the resolved plan without making any changes |
| `--noConfirm` | Skip all interactive prompts |

**Refusal cases:**
- `projects/app/` already exists → suggests `lt fullstack init` in a fresh directory
- no workspace detected at the target path → asks the user to run `lt fullstack init` first

**Side effects:** patches `projects/app/.env` with a project-specific `NUXT_PUBLIC_STORAGE_PREFIX`, optionally vendorizes `nuxt-extensions` into `app/core/`, hoists workspace-scoped `pnpm.overrides`, runs `pnpm install` + `oxfmt` on the new sub-project (unless `--skip-install` is set).

**Configuration:** Reads `commands.fullstack.*` (same keys as `lt fullstack init`).

---

### `lt fullstack convert-mode`

Convert **both** backend (`projects/api/`) and frontend (`projects/app/`) of a fullstack monorepo between npm mode and vendor mode in a single command. Auto-detects the subprojects, shows the plan for each side, and orchestrates the backend + frontend conversions sequentially.

**Usage:**
```bash
lt fullstack convert-mode --to <vendor|npm> [options]
```

**Options:**
| Option | Description |
|--------|-------------|
| `--to <mode>` | Target mode: `vendor` or `npm` (required) |
| `--framework-upstream-branch <ref>` | Backend upstream branch/tag (only with `--to vendor`, e.g. `11.24.3`) |
| `--frontend-framework-upstream-branch <ref>` | Frontend upstream branch/tag (only with `--to vendor`, e.g. `1.5.3`) |
| `--framework-version <version>` | Backend nest-server version (only with `--to npm`, default: from `VENDOR.md` baseline) |
| `--frontend-framework-version <version>` | Frontend nuxt-extensions version (only with `--to npm`, default: from `VENDOR.md` baseline) |
| `--skip-backend` | Skip backend conversion (frontend only) |
| `--skip-frontend` | Skip frontend conversion (backend only) |
| `--dry-run` | Show the resolved plan without making any changes |
| `--noConfirm` | Skip confirmation prompt |

**Subproject Detection:**

The command searches for subprojects in this order:
- Backend: `projects/api/` → `packages/api/`
- Frontend: `projects/app/` → `packages/app/`

Subprojects that are already in the target mode or not found are gracefully skipped.

**Behavior:**

For each subproject that needs conversion:
- **Backend**: delegates to the same pipeline as `lt server convert-mode`
- **Frontend**: delegates to the same pipeline as `lt frontend convert-mode`
- **Failure isolation**: If backend fails, frontend still runs (unless `--dry-run`). Final summary lists per-subproject status.

**Examples:**
```bash
# Convert both subprojects to vendor mode at current versions (auto-detected)
cd my-monorepo
lt fullstack convert-mode --to vendor --noConfirm

# Convert to vendor with explicit versions
lt fullstack convert-mode --to vendor \
  --framework-upstream-branch 11.24.3 \
  --frontend-framework-upstream-branch 1.5.3 \
  --noConfirm

# Preview the plan without changes
lt fullstack convert-mode --to vendor --dry-run

# Convert back to npm (preserves local patches by warning before execution)
lt fullstack convert-mode --to npm --noConfirm

# Only convert backend (frontend stays as-is)
lt fullstack convert-mode --to vendor --skip-frontend --noConfirm
```

**Note:** nest-server tags use **no** `v` prefix (e.g. `11.24.3`). nuxt-extensions tags also use **no** `v` prefix (e.g. `1.5.3`).

For mode-aware update workflows after conversion, use:
- `/lt-dev:fullstack:update-all` (comprehensive, mode-aware)
- `/lt-dev:backend:update-nest-server-core` (backend vendor mode)
- `/lt-dev:frontend:update-nuxt-extensions-core` (frontend vendor mode)

---

## Deployment Commands

### `lt deployment create`

Creates the TurboOps deployment config (`.turboops.json`) in the workspace root and
prints the one-time TurboOps setup checklist (project, stages, CI/CD variables, DNS,
stage env vars).

The Dockerfiles, `docker-compose.yml` and `.gitlab-ci.yml` already ship with the
lt-monorepo template, so nothing else is generated. An existing `.turboops.json` is
merged, not overwritten — hand-added keys survive a re-run.

**Angular apps** additionally get their environment files pointed at the deployed
stage URLs, because Angular bakes them into the bundle at build time (Nuxt reads
them from the TurboOps stage env at runtime, so nothing is patched there):

| File | Stage | API URL | App URL |
|------|-------|---------|---------|
| `environment.prod.ts` | `production` | `api.<domain>` | `<domain>` |
| `environment.develop.ts` | `dev` | `api.dev.<domain>` | `dev.<domain>` |
| `environment.test.ts` | `dev` | `api.dev.<domain>` | `dev.<domain>` |

`environment.ts` (local dev) is never touched. Only the URL origin is replaced, so
custom paths (`/v2/graphql`) survive and a re-run with a new domain updates them.

**Usage:**
```bash
lt deployment create [name] [domain] [options]
```

**Options:**
| Option | Description |
|--------|-------------|
| `--domain <domain>` | Main domain for the project (default: `<name>.lenne.tech`) |
| `--project <slug>` | TurboOps project slug = registry namespace + login user (default: kebab-case name) |
| `--noConfirm` | Skip prompts; resolve every value from flags, `lt.config`, or defaults |

**Configuration:** `commands.deployment.domain`, `commands.deployment.noConfirm`, `defaults.domain`, `defaults.noConfirm`

> **Upgrading from the Docker-Swarm generator:** the old
> `commands.deployment.gitHub`, `gitLab`, `prodRunner`, and `testRunner` config
> keys were removed with the switch to TurboOps. They are now flagged as unknown
> by `lt config validate` — delete them from your `lt.config` if present.

---

## NPM Commands

### `lt npm reinit`

Reinitializes npm packages (removes node_modules and reinstalls).

**Usage:**
```bash
lt npm reinit [options]
```

**Options:**
| Option | Description |
|--------|-------------|
| `--update` / `-u` | Update package.json before reinstall |
| `--noConfirm` | Skip confirmation prompts |

**Configuration:** `commands.npm.reinit.*`, `defaults.noConfirm`

---

### `lt npm update`

Updates npm packages.

**Usage:**
```bash
lt npm update
```

---

## Frontend Commands

### `lt frontend angular`

Creates a new standalone Angular workspace using ng-base-starter. For an in-workspace app, prefer [`lt fullstack add-app --frontend angular`](#lt-fullstack-add-app).

**Usage:**
```bash
lt frontend angular [name] [options]
```

**Options:**
| Option | Description |
|--------|-------------|
| `--name <name>` | Workspace name (preferred over the positional argument) |
| `--branch <branch>` / `-b` | Branch of ng-base-starter to use as template |
| `--copy <path>` / `-c` | Copy from local template directory instead of cloning |
| `--link <path>` | Symlink to local template directory (fastest, changes affect original) |
| `--localize` | Enable Angular localize |
| `--noLocalize` | Disable Angular localize |
| `--gitLink <url>` | Git repository URL to link |
| `--dry-run` | Print the resolved plan and exit without making any changes |
| `--force` | Override the workspace-detection abort under `--noConfirm` |
| `--noConfirm` / `-y` | Skip confirmation prompts |

**Workspace-awareness:** Inside a fullstack workspace the command is interactive (confirm prompt), but under `--noConfirm` it **refuses** with exit code 1 and points the caller to `lt fullstack add-app --frontend angular`. Pass `--noConfirm --force` to override (rare).

**Configuration:** `commands.frontend.angular.*`, `defaults.noConfirm`

---

### `lt frontend nuxt`

Creates a new standalone Nuxt workspace using nuxt-base-starter. For an in-workspace app, prefer [`lt fullstack add-app --frontend nuxt`](#lt-fullstack-add-app).

**Usage:**
```bash
lt frontend nuxt [options]
```

**Options:**
| Option | Description |
|--------|-------------|
| `--name <name>` | Workspace name |
| `--branch <branch>` / `-b` | Branch of nuxt-base-starter to use (uses git clone instead of create-nuxt-base) |
| `--copy <path>` / `-c` | Copy from local template directory instead of cloning |
| `--link <path>` | Symlink to local template directory (fastest, changes affect original) |
| `--frontend-framework-mode <npm\|vendor>` | Frontend framework consumption mode (`vendor` copies `nuxt-extensions` into `app/core/`) |
| `--next` | Default branch to `nuxt-base-starter#next` (auth `basePath` aligned with the experimental `--next` API) |
| `--dry-run` | Print the resolved plan and exit without making any changes |
| `--force` | Override the workspace-detection abort under `--noConfirm` |
| `--noConfirm` | Skip confirmation prompts (requires `--name`) |

**Note:** For `--copy` and `--link`, specify the path to the `nuxt-base-template/` subdirectory, not the repository root:
```bash
lt frontend nuxt --copy /path/to/nuxt-base-starter/nuxt-base-template
```

**Workspace-awareness:** Inside a fullstack workspace the command is interactive (confirm prompt), but under `--noConfirm` it **refuses** with exit code 1 and points the caller to `lt fullstack add-app --frontend nuxt`. Pass `--noConfirm --force` to override (rare).

**Configuration:** `commands.frontend.nuxt.*`, `commands.fullstack.frontendFrameworkMode` (shared with `init` / `add-app`)

---

### `lt frontend convert-mode`

Convert an existing frontend (Nuxt) project between npm mode and vendor mode for `@lenne.tech/nuxt-extensions`.

**Usage:**
```bash
lt frontend convert-mode --to <vendor|npm> [options]
```

**Options:**
| Option | Description |
|--------|-------------|
| `--to <mode>` | Target mode: `vendor` or `npm` (required) |
| `--upstream-branch <ref>` | Upstream branch/tag to vendor from (only with `--to vendor`) |
| `--version <version>` | nuxt-extensions version to install (only with `--to npm`, default: from VENDOR.md baseline) |
| `--dry-run` | Show the resolved plan without making any changes |
| `--noConfirm` | Skip confirmation prompt |

**Behavior:**

- **npm → vendor:**
  - Clones `@lenne.tech/nuxt-extensions` from GitHub at the specified tag (default: currently installed version)
  - Copies `src/module.ts`, `src/index.ts`, `src/runtime/`, and `LICENSE` to `<app-root>/app/core/`
  - Rewrites `nuxt.config.ts` module entry from `'@lenne.tech/nuxt-extensions'` to `'./app/core/module'`
  - Rewrites explicit consumer imports in `app/**/*.{ts,vue}` and `tests/**/*.ts` to relative paths
  - Removes `@lenne.tech/nuxt-extensions` from `package.json` dependencies
  - Merges upstream runtime dependencies (e.g. `@nuxt/kit`)
  - Adds `check:vendor-freshness` script
  - Creates `app/core/VENDOR.md` with baseline version + commit SHA
  - Prepends a vendor-mode notice block to `CLAUDE.md`

- **vendor → npm:**
  - Extracts baseline version from `app/core/VENDOR.md` (warns if local patches exist)
  - Rewrites consumer imports back to `@lenne.tech/nuxt-extensions`
  - Deletes `app/core/`
  - Restores `@lenne.tech/nuxt-extensions` dependency in `package.json`
  - Rewrites `nuxt.config.ts` module entry back
  - Removes vendor scripts and `CLAUDE.md` marker

**Examples:**
```bash
# Convert existing npm project to vendor mode at a specific version
cd projects/app
lt frontend convert-mode --to vendor --upstream-branch 1.5.3 --noConfirm

# Convert vendored project back to npm with a specific version
lt frontend convert-mode --to npm --version 1.5.3 --noConfirm
```

**Note:** nuxt-extensions tags have **no** `v` prefix — use e.g. `1.5.3`, not `v1.5.3`.

For mode-aware update workflows after conversion, use:
- `/lt-dev:frontend:update-nuxt-extensions-core` (vendor mode)
- `/lt-dev:fullstack:update-all` (coordinated backend + frontend)

---

## Config Commands

### `lt config init`

Creates a new `lt.config` file interactively.

**Usage:**
```bash
lt config init [options]
```

**Options:**
| Option | Description |
|--------|-------------|
| `--format <type>` | File format: `json` or `yaml` |
| `--controller <type>` | Default controller type |
| `--frontend <type>` | Default frontend framework |
| `--interactive <bool>` | Enable/disable interactive mode |
| `--noConfirm` | Skip confirmation prompts (overwrite existing) |

**Configuration:** `commands.config.init.noConfirm`, `defaults.noConfirm`

---

### `lt config show`

Displays the merged configuration for the current directory.

**Usage:**
```bash
lt config show
```

---

### `lt config help`

Shows help for the configuration system.

**Usage:**
```bash
lt config help
```

---

### `lt config validate`

Validates the current `lt.config` file.

**Usage:**
```bash
lt config validate
```

Reports syntax errors, type mismatches, and unknown keys.

---

## Utility Commands

### `lt status`

Shows project status and context.

**Usage:**
```bash
lt status
```

Displays:
- Project type detection (nest-server, nuxt, angular, etc.)
- Package information
- Git branch and repository status
- Configuration file status
- Available commands for the project type

---

### `lt doctor`

Diagnoses common development environment issues.

**Usage:**
```bash
lt doctor [options]
```

**Options:**
| Option | Description |
|--------|-------------|
| `--fix` | Attempt automatic fixes |

Checks:
- Node.js version
- npm version
- Git installation
- lt CLI version and updates
- Project configuration
- Dependencies installation

---

### `lt history`

Views and manages command history.

**Usage:**
```bash
lt history [count]
lt history search <pattern>
lt history clear
```

**Arguments:**
- `count` - Number of recent commands to show (default: 20)
- `search <pattern>` - Search history for matching commands
- `clear` - Clear command history

**Options:**
| Option | Description |
|--------|-------------|
| `--noConfirm` | Skip confirmation when clearing |

---

### `lt completion`

Generates and installs shell completion scripts.

**Usage:**
```bash
lt completion install         # Install completions (recommended)
lt completion <bash|zsh|fish> # Output completion script
```

**How it works:**
- Generates **static completion files** at install time (no runtime overhead)
- Completions are **auto-updated** when CLI is installed/updated
- Files are loaded once at shell startup

**Installation:**
```bash
# Automatic (recommended)
lt completion install

# Manual (if needed)
lt completion bash > ~/.local/share/lt/completions/lt.bash
lt completion zsh > ~/.local/share/lt/completions/_lt
lt completion fish > ~/.config/fish/completions/lt.fish
```

**Completion file locations:**
- Bash: `~/.local/share/lt/completions/lt.bash`
- Zsh: `~/.local/share/lt/completions/_lt`
- Fish: `~/.config/fish/completions/lt.fish`

---

### `lt templates list`

Lists available templates.

**Usage:**
```bash
lt templates list
```

Shows:
- Built-in templates
- Custom templates (~/.lt/templates)
- Project templates (./lt-templates)

---

## Database Commands

### `lt mongodb collection-export`

Exports a MongoDB collection to JSON file.

**Usage:**
```bash
lt mongodb collection-export [options]
```

**Options:**
| Option | Description |
|--------|-------------|
| `--mongoUri <uri>` | MongoDB connection URI |
| `--database <name>` | Database name |
| `--collection <name>` | Collection name |
| `--output <path>` | Output file path |

---

### `lt mongodb s3-restore`

Restores a MongoDB database from an S3 backup.

**Usage:**
```bash
lt mongodb s3-restore [options]
```

**Options:**
| Option | Description |
|--------|-------------|
| `--bucket <name>` | S3 bucket name |
| `--key <key>` | S3 access key ID |
| `--secret <secret>` | S3 secret access key |
| `--url <url>` | S3 endpoint URL |
| `--region <region>` | S3 region |
| `--folder <folder>` | S3 folder/prefix |
| `--mongoUri <uri>` | MongoDB connection URI |
| `--database <name>` | Target database name |

---

### `lt qdrant stats`

Shows statistics for Qdrant collections.

**Usage:**
```bash
lt qdrant stats
```

---

### `lt qdrant delete`

Deletes a Qdrant collection.

**Usage:**
```bash
lt qdrant delete
```

---

## Directus Commands

### `lt directus docker-setup`

Sets up a local Directus Docker instance using docker-compose.

**Usage:**
```bash
lt directus docker-setup [options]
```

**Options:**
| Option | Description |
|--------|-------------|
| `--name <name>` / `-n` | Instance name (stored in ~/.lt/directus/<name>) |
| `--version <version>` / `-v` | Directus version (default: latest) |
| `--database <type>` / `--db <type>` | Database type: `postgres`, `mysql`, `sqlite` |
| `--port <number>` / `-p` | Port number (default: auto-detect starting from 8055) |
| `--update` | Update existing instance configuration |
| `--noConfirm` | Skip confirmation prompts |

**Configuration:** `commands.directus.dockerSetup.*`, `defaults.noConfirm`

**Port Auto-detection:**
- If `--port` is not specified, the CLI automatically finds an available port starting from 8055
- Each instance gets its own port (8055, 8056, 8057, etc.)
- This allows running multiple Directus instances simultaneously

**Generated files:**
- `~/.lt/directus/<name>/docker-compose.yml` - Container configuration
- `~/.lt/directus/<name>/.env` - Secrets and environment variables
- `~/.lt/directus/<name>/README.md` - Usage instructions

**Examples:**
```bash
# Create PostgreSQL instance (auto-detects port 8055)
lt directus docker-setup --name my-project --database postgres

# Create second instance (auto-detects port 8056)
lt directus docker-setup --name another-project --database mysql

# Create with specific port
lt directus docker-setup --name custom-app --database sqlite --port 9000

# Create with specific version
lt directus docker-setup --name my-app --database mysql --version 10

# Update existing instance
lt directus docker-setup --name my-project --version 11 --update
```

---

### `lt directus remove`

Removes a Directus Docker instance and all its data.

**Usage:**
```bash
lt directus remove [name] [options]
```

**Arguments:**
| Argument | Description |
|----------|-------------|
| `name` | Instance name to remove (optional, will prompt if omitted) |

**Options:**
| Option | Description |
|--------|-------------|
| `--noConfirm` | Skip confirmation prompts |

**Configuration:** `commands.directus.remove.*`, `defaults.noConfirm`

**What gets removed:**
- Stops and removes Docker containers
- Removes all Docker volumes (database, uploads, extensions)
- Deletes instance directory from ~/.lt/directus/

**Examples:**
```bash
# Interactive (shows list of instances)
lt directus remove

# Remove specific instance
lt directus remove my-project

# Skip confirmation
lt directus remove my-project --noConfirm
```

---

### `lt directus typegen`

Generates TypeScript types from Directus collections.

**Usage:**
```bash
lt directus typegen [options]
```

**Options:**
| Option | Description |
|--------|-------------|
| `--url <url>` / `-u` | Directus API URL |
| `--token <token>` / `-t` | Directus API token (Administrator permissions required) |
| `--output <path>` / `-o` | Output file path |
| `--noConfirm` | Skip confirmation prompts |

**Configuration:** `commands.directus.typegen.*`, `defaults.noConfirm`

**Examples:**
```bash
# Interactive
lt directus typegen

# With all options
lt directus typegen --url http://localhost:8055 --token <token> --output ./types.ts
```

---

## TypeScript Commands

### `lt typescript create`

Creates a new TypeScript project.

**Usage:**
```bash
lt typescript create [name] [options]
```

**Options:**
| Option | Description |
|--------|-------------|
| `--author <name>` | Author name |
| `--noConfirm` | Skip confirmation prompts |
| `--updatePackages` | Update packages to latest versions |

**Configuration:** `commands.typescript.create.*`, `defaults.author`, `defaults.noConfirm`

---

### `lt typescript playground`

Opens TypeScript playground.

**Usage:**
```bash
lt typescript playground
```

---

## Starter Commands

### `lt starter chrome-extension`

Creates a Chrome extension project.

**Usage:**
```bash
lt starter chrome-extension [name]
```

---

## Claude Commands

### `lt claude plugins`

Installs and manages Claude Code plugins from multiple marketplaces.

**Usage:**
```bash
lt claude plugins [plugin-name] [options]
```

**Parameters:**
| Parameter | Description |
|-----------|-------------|
| `plugin-name` | Optional. Name of a specific plugin to install |

**Options:**
| Option | Description |
|--------|-------------|
| `--list` | List available plugins from all marketplaces |
| `--uninstall` | Uninstall a plugin |

**Plugin Sources:**
- [lenne-tech marketplace](https://github.com/lenneTech/claude-code) - lenne.Tech plugins for NestJS development
- [claude-plugins-official](https://github.com/anthropics/claude-plugins-official) - Official Anthropic plugins (e.g., typescript-lsp)

**Default Behavior:**
When run without a plugin name, all lenne.Tech plugins plus recommended external plugins (like `typescript-lsp`) are installed automatically.

**Examples:**
```bash
# Install all recommended plugins (lenne.Tech + recommended external)
lt claude plugins

# Install a specific plugin
lt claude plugins typescript-lsp

# List available plugins
lt claude plugins --list

# Uninstall a plugin
lt claude plugins lt-dev --uninstall
```

---

### `lt claude shortcuts`

Installs Claude Code shell shortcuts (aliases) for quick access to common commands.

**Usage:**
```bash
lt claude shortcuts
```

**Alias:** `lt claude s`

**Shortcuts installed:**
| Alias | Command | Description |
|-------|---------|-------------|
| `c` | `claude --dangerously-skip-permissions` | Start new Claude Code session |
| `cc` | `claude --dangerously-skip-permissions --continue` | Continue last session |
| `cr` | `claude --dangerously-skip-permissions --resume` | Select and resume previous session |

**Note:** These shortcuts use `--dangerously-skip-permissions` which enables autonomous operation by bypassing permission prompts. Ensure you have proper data backups before using them.

**Examples:**
```bash
# Install shortcuts to ~/.zshrc (or detected shell config)
lt claude shortcuts

# After installation, use:
c        # Start new session
cc       # Continue last session
cr       # Resume a previous session
```

---

## Blocks & Components

### `lt blocks add`

Adds code blocks to your project from the lenne.tech component library.

**Usage:**
```bash
lt blocks add [block-name] [options]
```

**Options:**
| Option | Description |
|--------|-------------|
| `--noConfirm` | Skip confirmation prompts (auto-install dependencies) |

**Configuration:** `commands.blocks.add.noConfirm`, `defaults.noConfirm`

---

### `lt components add`

Adds components to your project from the lenne.tech component library.

**Usage:**
```bash
lt components add [component-name] [options]
```

**Options:**
| Option | Description |
|--------|-------------|
| `--noConfirm` | Skip confirmation prompts (auto-install dependencies) |

**Configuration:** `commands.components.add.noConfirm`, `defaults.noConfirm`

---

## Template Commands

### `lt templates llm`

Gets LLM prompt templates.

**Usage:**
```bash
lt templates llm [prompt-name] [options]
```

**Options:**
| Option | Description |
|--------|-------------|
| `--output <path>` / `-o` | Save to file |
| `--clipboard` / `-c` | Copy to clipboard |
| `--display` / `-d` | Display in terminal |

---

## Other Commands

### `lt update`

Updates the lt CLI to the latest version.

**Usage:**
```bash
lt update
```

---

### `lt docs open`

Opens documentation in the browser.

**Usage:**
```bash
lt docs open [doc]
```

**Arguments:**
- `lenne.Tech` - lenne.Tech documentation
- `NestJS` - NestJS documentation
- `GlueGun` - GlueGun documentation

---

### `lt tools crypt`

Generates a password hash.

**Usage:**
```bash
lt tools crypt [password]
```

---

### `lt tools sha256`

Generates a SHA256 hash.

**Usage:**
```bash
lt tools sha256 [text]
```

---

### `lt tools jwt-read`

Reads and decodes a JWT token.

**Usage:**
```bash
lt tools jwt-read [token]
```

---

### `lt tools regex`

Tests regular expressions.

**Usage:**
```bash
lt tools regex [pattern] [text]
```

---

### `lt tools crawl`

Crawls a website and stores each page as a Markdown file (with YAML frontmatter containing `source_url`, `download_date`, `first_downloaded`, `description`, language, word count, etc.) so it can be consumed as a Claude Code knowledge base. Optionally follows same-origin links up to a configurable depth, seeds the queue from `<origin>/sitemap.xml`, and downloads referenced images into a shared `images/` folder (deduplicated by content hash). Re-running the command against the same output directory updates existing pages while preserving their original `first_downloaded` timestamp.

**Alias:** `cr`

**Usage:**
```bash
lt tools crawl <url> [options]
```

**Options:**
- `--out <dir>` — Output directory (default: current directory). Single-page crawls write the `.md` directly here; multi-page crawls generate `<out>/README.md` plus `<out>/pages/` and `<out>/images/`.
- `--depth <n|all>` — Link depth (default `0`). `0` = only the start page, `1` = start page + direct same-origin links, `2` = and their links, ... Use `--depth all` (or `--depth -1`, or the shortcut flag `--all`) to follow every same-origin link transitively; the crawl then stops when `--max-pages` is reached.
- `--all` — Shortcut for `--depth all`.
- `--render` / `--no-render` — Render each page through a headless browser before extraction (default **on**). Required for SPAs (Vue/Nuxt/React/Angular) whose content is client-rendered. Uses `playwright-core` with system Chrome / Edge first, then Playwright's bundled Chromium. Use `--no-render` for a plain HTTP fetch when you know the site is static (faster, no browser needed).
- `--install-browser` — If `--render` finds no browser, auto-install Playwright's Chromium (one-time ~170 MB download).
- `--prune` / `--no-prune` — After a multi-page crawl, remove any `.md` or image files inside `<out>/pages` and `<out>/images` that were not written by the current run (default **on**). Keeps the knowledge base aligned with the live site on update runs. Empty subdirectories are cleaned up too. Ignored in single-page mode. Use `--no-prune` to preserve old files.
- `--no-images` — Disable image downloads.
- `--no-sitemap` — Skip discovery via `<origin>/sitemap.xml`.
- `--concurrency <n>` — Parallel HTTP requests (default `4`).
- `--max-pages <n>` — Safety cap on total pages (default `200`).
- `--selector <css>` — CSS selector scoping the main content (e.g. `article`, `main`).
- `--timeout <ms>` — HTTP request timeout in ms (default `20000`).
- `--noConfirm` — Skip confirmation prompts.

**Examples:**
```bash
# Single page into the current directory
lt tools crawl https://example.com/article --noConfirm

# Crawl start page + direct links into ./knowledge
lt tools crawl https://example.com --out ./knowledge --depth 1 --noConfirm

# Full mini-site with sitemap seeding and images
lt tools crawl https://example.com --out ./kb --depth 2 --max-pages 100 --noConfirm

# Crawl every reachable same-origin page (safety cap via --max-pages)
lt tools crawl https://example.com --out ./kb --depth all --max-pages 500 --noConfirm

# Same, using the --all shortcut
lt tools crawl https://example.com --out ./kb --all --max-pages 500 --noConfirm

# Full SPA-aware crawl (render + prune are on by default)
lt tools crawl https://lenne.tech --all --noConfirm

# Opt-out: plain HTTP fetch for a known-static site, keep orphans
lt tools crawl https://example.com --all --no-render --no-prune --noConfirm
```

### `lt tools ocr`

Converts PDFs to clean Markdown using [marker-pdf](https://github.com/datalab-to/marker) — a PyTorch-based, layout-aware OCR engine that produces real Markdown tables, headings and lists. On Apple Silicon (M-series) inference runs on the GPU via Metal Performance Shaders (MPS) and is typically 5–15× faster than CPU-only PDF text extractors. Marker is auto-installed into an isolated virtualenv at `~/.lt/marker/.venv/` on first use; subsequent runs reuse the cached environment and ~3 GB of model weights.

**Aliases:** `ocr`, `pdf2md`

**Usage:**
```bash
lt tools ocr <file.pdf|directory> [options]
lt tools ocr --status              # Show installation status
lt tools ocr --install             # Install marker-pdf without converting anything
```

**Options:**
- `--output-dir <dir>` — Output directory (default: `<input>-MD/` for batch, `<input>.md-out/` for single).
- `--workers <n>` — Parallel worker processes for batch mode (default `3`).
- `--device <auto|mps|cuda|cpu>` — Override `TORCH_DEVICE`. Default `auto` picks `mps` on Apple Silicon, `cpu` elsewhere. Set `cuda` if running on a Linux machine with an NVIDIA GPU and the appropriate PyTorch CUDA build.
- `--skip-existing` / `--no-skip-existing` — Skip already-converted files in batch mode (default **on**).
- `--keep-images` — Extract embedded images alongside the Markdown (default **off** — Markdown only).
- `--format <markdown|json|html|chunks>` — Output format (default `markdown`).

**Setup notes:**
- Requires `python3` (≥ 3.10) on PATH.
- Uses `uv` if available (fastest install path); falls back to `python3 -m venv` + `pip` otherwise.
- The first conversion is slower because the model weights download (~3 GB). Subsequent runs start instantly.
- Apple Silicon: `device: mps` is auto-selected. Linux/CUDA: pass `--device cuda`.

**Examples:**
```bash
# Inspect tooling status (python3, uv, venv path, auto-detected device)
lt tools ocr --status

# One-time install (skip if you just want to convert and let auto-install handle it)
lt tools ocr --install

# Convert a single PDF (creates ./report.pdf.md-out/report/report.md)
lt tools ocr ./report.pdf

# Batch a directory with 4 parallel workers
lt tools ocr ./pdfs --output-dir ./md --workers 4

# Force CPU mode (e.g. when MPS-related crashes occur on Sonoma)
lt tools ocr ./report.pdf --device cpu
```

**When to reach for this command vs. the lt-knowledge ingest pipeline:** `lt tools ocr` is for **local developer workflows** — quick PDF → Markdown for research, demos, validation sets, sanity checks. For productive ingestion (Vector / Graph / Wiki layers, confidence-based fallback, Whisper for audio, archive-aware processing) use the lt-knowledge stack with its Docling + LightOnOCR sidecars. Marker is intentionally **not** added there because its MPS advantage doesn't apply in Linux containers and Docling already covers the same use cases with native confidence scoring (see `lt-knowledge/docs/OCR-COMPARISON-MARKER.md`).

---

## Configuration Priority

All configurable commands follow this priority order (highest to lowest):

1. **CLI parameters** (e.g., `--noConfirm`)
2. **Command-specific config** (e.g., `commands.git.get.noConfirm`)
3. **Category-level config** (e.g., `commands.git.noConfirm`)
4. **Global defaults** (e.g., `defaults.noConfirm`)
5. **Code defaults**
6. **Interactive user input** (only if no value determined from above)

For detailed configuration options, see [lt.config.md](./lt.config.md).
