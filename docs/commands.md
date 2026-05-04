# Command Reference for lt

This document provides a comprehensive reference for all `lt` CLI commands. For configuration file options, see [lt.config.md](./lt.config.md).

## Related Documentation

- **[LT-ECOSYSTEM-GUIDE](./LT-ECOSYSTEM-GUIDE.md)** — Complete reference for `lt` CLI **and** the `lt-dev` Claude-Code Plugin including architecture, vendor-mode workflows, agents, and skills
- **[VENDOR-MODE-WORKFLOW](./VENDOR-MODE-WORKFLOW.md)** — Step-by-step guide for converting a project from npm mode to vendor mode, updating it, and optional rollback
- **[lt.config.md](./lt.config.md)** — Configuration file reference

## Table of Contents

- [CLI Commands](#cli-commands)
- [Server Commands](#server-commands)
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

Creates deployment configuration for a monorepo.

**Usage:**
```bash
lt deployment create [name] [options]
```

**Options:**
| Option | Description |
|--------|-------------|
| `--domain <domain>` | Main domain for the project |
| `--gitHub` | Enable GitHub pipeline |
| `--gitLab` | Enable GitLab pipeline |
| `--testRunner <tag>` | GitLab test runner tag |
| `--prodRunner <tag>` | GitLab production runner tag |
| `--noConfirm` | Skip confirmation prompts |

**Configuration:** `commands.deployment.*`, `defaults.domain`, `defaults.noConfirm`

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
