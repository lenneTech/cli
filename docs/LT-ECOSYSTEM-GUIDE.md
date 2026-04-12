# lenne.tech Fullstack Ecosystem: CLI & lt-dev Plugin

Comprehensive reference for the `lt` CLI and the `lt-dev` Claude Code plugin, with focus on **vendor-mode workflows** for `@lenne.tech/nest-server` and `@lenne.tech/nuxt-extensions`.

---

## Table of Contents

- [Overview](#overview)
- [Architecture Diagram](#architecture-diagram)
- [lt CLI — Features](#lt-cli--features)
  - [Project Scaffolding](#project-scaffolding)
  - [Server Development](#server-development)
  - [Frontend Development](#frontend-development)
  - [Fullstack Workflows](#fullstack-workflows)
  - [Vendor-Mode Conversion](#vendor-mode-conversion)
  - [Status & Diagnostics](#status--diagnostics)
  - [Additional Tools](#additional-tools)
- [lt-dev Plugin — Features](#lt-dev-plugin--features)
  - [Commands](#commands)
  - [Autonomous Agents](#autonomous-agents)
  - [Skills (Knowledge Base)](#skills-knowledge-base)
- [Vendor-Mode Processes](#vendor-mode-processes)
  - [1. Create a new project in vendor mode](#1-create-a-new-project-in-vendor-mode)
  - [2. Backend: convert npm → vendor](#2-backend-convert-npm--vendor)
  - [3. Frontend: convert npm → vendor](#3-frontend-convert-npm--vendor)
  - [4. Backend: vendor → npm rollback](#4-backend-vendor--npm-rollback)
  - [5. Frontend: vendor → npm rollback](#5-frontend-vendor--npm-rollback)
  - [6. Update workflows](#6-update-workflows)
  - [7. Upstream contribution](#7-upstream-contribution)
- [Decision Matrix](#decision-matrix)
- [Glossary](#glossary)

---

## Overview

The lenne.tech ecosystem consists of two complementary tools:

- **`lt CLI`** (`@lenne.tech/cli`) — Terminal tool for scaffolding, code generation, status, and mode conversion
- **`lt-dev` Plugin** — Claude Code plugin providing commands, autonomous agents, and skills for intelligent development workflows

Both tools support the **vendor mode** as a pilot for `@lenne.tech/nest-server` (backend) and `@lenne.tech/nuxt-extensions` (frontend). In vendor mode, the framework code is copied directly into the project as source code under `src/core/` (backend) or `app/core/` (frontend) — without an npm dependency.

---

## Architecture Diagram

```
┌─────────────────────────────────────────────────────────────────────┐
│                  Developer / Claude Code                            │
└─────────┬────────────────────────────────────────────────┬──────────┘
          │                                                │
          │ Terminal                                       │ Slash commands
          ▼                                                ▼
┌──────────────────────┐                      ┌────────────────────────┐
│      lt CLI          │                      │    lt-dev Plugin       │
│                      │                      │                        │
│ • Scaffolding        │                      │ • Commands             │
│ • Mode conversion    │◄─── invoked by ──────┤ • Agents               │
│ • Code generation    │                      │ • Skills               │
│ • Status/diagnosis   │                      │                        │
└──────────┬───────────┘                      └────────────┬───────────┘
           │                                               │
           │ writes to                                     │ operates on
           ▼                                               ▼
┌─────────────────────────────────────────────────────────────────────┐
│                    Fullstack Project                                 │
│                                                                      │
│  projects/api (Backend — NestJS)          projects/app (Frontend)    │
│  ├── npm mode: @lenne.tech/nest-server    ├── npm mode: @lenne.tech/ │
│  │    in package.json                     │    nuxt-extensions       │
│  └── vendor mode: src/core/ + VENDOR.md   └── vendor mode: app/core/ │
│                                                + VENDOR.md           │
└─────────────────────────────────────────────────────────────────────┘
           ▲                                               ▲
           │ syncs from                                    │ syncs from
           │                                               │
┌──────────┴──────────────┐                   ┌───────────┴────────────┐
│  github.com/lenneTech/  │                   │ github.com/lenneTech/  │
│  nest-server            │                   │ nuxt-extensions        │
│  nest-server-starter    │                   │ nuxt-base-starter      │
└─────────────────────────┘                   └────────────────────────┘
```

---

## lt CLI — Features

### Project Scaffolding

| Command | Purpose |
|---------|---------|
| `lt fullstack init` | Create a new monorepo with API + frontend. Supports npm and vendor mode for both sides |
| `lt frontend nuxt` | Standalone Nuxt 4 project from `nuxt-base-starter` |
| `lt frontend angular` | Standalone Angular project from `ng-base-starter` |
| `lt server create` | Standalone NestJS project from `nest-server-starter` |
| `lt starter chrome-extension` | Chrome extension starter |
| `lt cli create` | New CLI project via Gluegun |
| `lt typescript create` | TypeScript library starter |

**Fullstack init with vendor modes:**

```bash
lt fullstack init \
  --name my-project \
  --frontend nuxt \
  --api-mode Rest \
  --framework-mode vendor \
  --frontend-framework-mode vendor \
  --framework-upstream-branch 11.24.3 \
  --noConfirm
```

Flags:
- `--framework-mode npm|vendor` — Backend mode
- `--frontend-framework-mode npm|vendor` — Frontend mode
- `--framework-upstream-branch <tag>` — Specific nest-server version for vendor
- `--dry-run` — Show plan without making changes

---

### Server Development

| Command | Purpose |
|---------|---------|
| `lt server module` | Generate a NestJS module (model, service, controller, resolver, tests) |
| `lt server object` | Generate an input/output type |
| `lt server add-property` | Add a property to an existing module |
| `lt server test` | Generate E2E tests for a module |
| `lt server permissions` | Analyze all `@Roles`/`@Restricted` decorators, generate report (md/json/html) |
| `lt server create-secret` | Generate secure secrets for `.env` |
| `lt server set-secrets` | Set secrets in the project |
| **`lt server convert-mode`** | **Convert backend between npm and vendor mode** |

All code generators are **mode-aware**: In vendor mode they use relative paths to `src/core/`; in npm mode they use the bare specifier `@lenne.tech/nest-server`.

---

### Frontend Development

| Command | Purpose |
|---------|---------|
| `lt frontend nuxt` | Create Nuxt project from starter |
| `lt frontend angular` | Create Angular project from starter |
| **`lt frontend convert-mode`** | **Convert frontend between npm and vendor mode** |

---

### Fullstack Workflows

| Command | Purpose |
|---------|---------|
| `lt fullstack init` | Create fullstack monorepo (see above) |
| `lt fullstack update` | Show mode-specific update instructions for backend AND frontend |
| **`lt fullstack convert-mode`** | **Convert backend AND frontend between npm and vendor mode in a single command** |

**Fullstack mode conversion in one command:**

```bash
# Both subprojects to vendor mode
lt fullstack convert-mode --to vendor --noConfirm

# With specific upstream versions
lt fullstack convert-mode --to vendor \
  --framework-upstream-branch 11.24.3 \
  --frontend-framework-upstream-branch 1.5.3 \
  --noConfirm

# Both back to npm
lt fullstack convert-mode --to npm --noConfirm

# Only convert backend
lt fullstack convert-mode --to vendor --skip-frontend --noConfirm

# Only convert frontend
lt fullstack convert-mode --to vendor --skip-backend --noConfirm

# Dry-run (plan without changes)
lt fullstack convert-mode --to vendor --dry-run
```

The command automatically locates `projects/api/` and `projects/app/` (or `packages/api` / `packages/app`), detects the current modes, shows a plan, and then orchestrates the conversion of both sides using the appropriate helper methods.

---

### Vendor-Mode Conversion

**Backend**: `lt server convert-mode`

```bash
# npm → vendor
cd projects/api
lt server convert-mode --to vendor --upstream-branch 11.24.3 --noConfirm

# vendor → npm
lt server convert-mode --to npm --version 11.24.3 --noConfirm

# Dry-run (plan without changes)
lt server convert-mode --to vendor --dry-run
```

**Frontend**: `lt frontend convert-mode`

```bash
# npm → vendor
cd projects/app
lt frontend convert-mode --to vendor --upstream-branch 1.5.3 --noConfirm

# vendor → npm
lt frontend convert-mode --to npm --version 1.5.3 --noConfirm

# Dry-run
lt frontend convert-mode --to vendor --dry-run
```

Both commands clone the respective upstream repo into `/tmp/`, perform the code transformation, and clean up at the end. **No local paths** are required.

---

### Status & Diagnostics

| Command | Purpose |
|---------|---------|
| `lt status` | Shows project type, framework mode (backend + frontend), config, git branch, versions. At the monorepo root, both subprojects are automatically scanned |
| `lt doctor` | Checks environment, versions, dependencies |
| `lt history` | Shows CLI command history |

**Example at the monorepo root:**

```
Monorepo Subprojects:
  Backend:  projects/api → vendor (src/core/, VENDOR.md)
  Frontend: projects/app → vendor (app/core/, VENDOR.md)
```

---

### Additional Tools

| Area | Commands |
|------|----------|
| **Config** | `lt config init`, `lt config validate`, `lt config show`, `lt config help` |
| **Git** | `lt git create`, `git get`, `git update`, `git clean`, `git squash`, `git rebase`, `git rename`, `git reset`, `git undo`, `git clear`, `git force-pull` |
| **NPM** | `lt npm reinit` |
| **MongoDB** | `lt mongodb collection-export`, `mongodb s3-restore` |
| **Qdrant** | `lt qdrant stats`, `qdrant delete` |
| **Directus** | `lt directus docker-setup`, `directus typegen`, `directus remove` |
| **Deployment** | `lt deployment create` (GitHub/GitLab pipelines) |
| **Blocks/Components** | `lt blocks add`, `lt components add` |
| **Tools** | `lt tools regex`, `tools sha256`, `tools jwt-read`, `tools crypt`, `tools install-scripts` |
| **Docs** | `lt docs open` |
| **Claude** | `lt claude shortcuts`, `lt claude plugins` |
| **Templates** | `lt templates llm` |

---

## lt-dev Plugin — Features

The `lt-dev` Claude Code plugin provides **Commands** (user-invocable), **Agents** (autonomous execution), and **Skills** (knowledge bases).

### Commands

#### Backend

| Command | Purpose |
|---------|---------|
| `/lt-dev:backend:update-nest-server` | Update `@lenne.tech/nest-server` in npm mode with migration guides |
| `/lt-dev:backend:update-nest-server-core` | Sync vendored `src/core/` with upstream (vendor mode) |
| `/lt-dev:backend:convert-to-vendor` | Convert existing project from npm → vendor (incl. migration guides) |
| `/lt-dev:backend:convert-to-npm` | Convert vendored project back to npm |
| `/lt-dev:backend:contribute-nest-server-core` | Prepare local patches as upstream PR for nest-server |
| `/lt-dev:backend:sec-audit` | Security audit of backend code |
| `/lt-dev:backend:sec-review` | Security review of a specific code area |
| `/lt-dev:backend:test-generate` | Generate E2E tests |
| `/lt-dev:backend:code-cleanup` | Clean up code (imports, formatting) |

#### Frontend

| Command | Purpose |
|---------|---------|
| `/lt-dev:frontend:update-nuxt-extensions-core` | Sync vendored `app/core/` with upstream |
| `/lt-dev:frontend:convert-to-vendor` | Convert frontend project from npm → vendor |
| `/lt-dev:frontend:convert-to-npm` | Convert vendored frontend back to npm |
| `/lt-dev:frontend:contribute-nuxt-extensions-core` | Prepare local patches as upstream PR for nuxt-extensions |
| `/lt-dev:frontend:figma-init` | Initialize Figma Code Connect setup |
| `/lt-dev:frontend:figma-research` | Analyze Figma designs for implementation |
| `/lt-dev:frontend:figma-to-code` | Translate Figma design into Vue/Nuxt code |
| `/lt-dev:frontend:env-migrate` | Migrate `.env` from old standards |
| `/lt-dev:frontend:init-conventions` | Initialize frontend conventions |

#### Fullstack

| Command | Purpose |
|---------|---------|
| **`/lt-dev:fullstack:update-all`** | **Comprehensive update**: backend + frontend (mode-aware) + package maintenance + CLAUDE.md sync + validation |
| `/lt-dev:fullstack:update` | Simple backend + frontend update (legacy, less comprehensive) |
| `/lt-dev:fullstack:sync-claude-md` | Sync `CLAUDE.md` from upstream starter templates |

#### Maintenance

| Command | Purpose |
|---------|---------|
| `/lt-dev:maintenance:maintain` | FULL MODE: package update + audit + security + deduplication |
| `/lt-dev:maintenance:maintain-check` | DRY-RUN: analysis without changes |
| `/lt-dev:maintenance:maintain-security` | Security patches only |
| `/lt-dev:maintenance:maintain-pre-release` | Conservative patch-only before release |
| `/lt-dev:maintenance:maintain-post-feature` | Post-feature cleanup |

#### Git

| Command | Purpose |
|---------|---------|
| `/lt-dev:git:commit-message` | Generate conventional commit message from staging |
| `/lt-dev:git:create-request` | Create merge request with descriptive body |
| `/lt-dev:git:mr-description` | Generate MR description from commits |
| `/lt-dev:git:mr-description-clipboard` | Same, copied to clipboard |
| `/lt-dev:git:rebase` | Rebase onto development branch with conflict resolution |
| `/lt-dev:git:rebase-mrs` | Rebase multiple MRs sequentially |

#### Docker

| Command | Purpose |
|---------|---------|
| `/lt-dev:docker:gen-setup` | Generate Docker configuration (Dockerfile + compose + .env) |

#### Plugin

| Command | Purpose |
|---------|---------|
| `/lt-dev:plugin:check` | Validate the plugin setup after context loss |
| `/lt-dev:plugin:element` | Interactive creation of new plugin elements |

#### Vibe (Spec-Driven Development)

| Command | Purpose |
|---------|---------|
| `/lt-dev:vibe:plan` | Create implementation plan from requirement |
| `/lt-dev:vibe:build` | Implement according to plan |
| `/lt-dev:vibe:build-plan` | Plan + build in one flow |

#### Standalone

| Command | Purpose |
|---------|---------|
| `/lt-dev:debug` | Structured debugging session |
| `/lt-dev:review` | Code review with multiple reviewer perspectives |
| `/lt-dev:refactor-frontend` | Frontend refactoring helper |
| `/lt-dev:resolve-ticket` | Implement Linear ticket |
| `/lt-dev:create-ticket` | Create Linear ticket |
| `/lt-dev:create-story` | Create user story (German) |
| `/lt-dev:create-task` | Create Linear task |
| `/lt-dev:create-bug` | Create Linear bug |
| `/lt-dev:linear-comment` | Create Linear comment |
| `/lt-dev:dev-submit` | Dev-submit workflow (commit + push + MR) |
| `/lt-dev:interview` | Structured interview for requirements |
| `/lt-dev:skill-optimize` | Optimize a plugin skill |
| `/lt-dev:spec-to-tasks` | Spec → task list |

---

### Autonomous Agents

Autonomous agents perform multi-step tasks without interaction. They are spawned via commands or the Agent tool.

#### Vendor-Mode Agents

| Agent | Purpose | Spawned by |
|-------|---------|------------|
| `vendor-mode-converter` | Backend npm → vendor conversion incl. migration guides | `/lt-dev:backend:convert-to-vendor` |
| `vendor-mode-converter-frontend` | Frontend npm → vendor conversion incl. changelog | `/lt-dev:frontend:convert-to-vendor` |
| `nest-server-core-updater` | Upstream sync for vendored nest-server core | `/lt-dev:backend:update-nest-server-core` |
| `nuxt-extensions-core-updater` | Upstream sync for vendored nuxt-extensions core | `/lt-dev:frontend:update-nuxt-extensions-core` |
| `nest-server-core-contributor` | Upstream PR drafts from local backend patches | `/lt-dev:backend:contribute-nest-server-core` |
| `nuxt-extensions-core-contributor` | Upstream PR drafts from local frontend patches | `/lt-dev:frontend:contribute-nuxt-extensions-core` |

#### Update Agents

| Agent | Purpose |
|-------|---------|
| `nest-server-updater` | npm-mode update of nest-server incl. migration guides |
| `fullstack-updater` | Coordinated backend + frontend update (legacy) |
| `npm-package-maintainer` | Package optimization (5 modes) |
| `branch-rebaser` | Rebase automation with conflict resolution |

#### Development Agents

| Agent | Purpose |
|-------|---------|
| `backend-dev` | Autonomous NestJS development |
| `frontend-dev` | Autonomous Nuxt 4 development |
| `architect` | Architecture planning with stack enforcement |
| `devops` | Docker, CI/CD, environment |

#### Reviewer Agents

| Agent | Purpose |
|-------|---------|
| `code-reviewer` | 6-dimension code review |
| `backend-reviewer` | NestJS-specific |
| `frontend-reviewer` | Vue/Nuxt-specific |
| `security-reviewer` | OWASP-aligned |
| `a11y-reviewer` | Accessibility + Lighthouse |
| `ux-reviewer` | UX patterns |
| `performance-reviewer` | Bundle, queries, caching |
| `devops-reviewer` | Docker, CI/CD security |
| `docs-reviewer` | README, JSDoc, migration guides |
| `test-reviewer` | Test coverage + quality |

---

### Skills (Knowledge Base)

Skills contain structured knowledge and are automatically activated on matching queries.

| Skill | Purpose |
|-------|---------|
| **`nest-server-core-vendoring`** | Backend vendoring pattern, flatten-fix, sync workflows |
| **`nuxt-extensions-core-vendoring`** | Frontend vendoring pattern, nuxt.config rewrite, sync |
| `nest-server-updating` | npm-mode update processes, migration guides, error patterns |
| `generating-nest-servers` | Generate NestJS modules/services/controllers |
| `developing-lt-frontend` | Nuxt 4 development, composables, forms, auth |
| `maintaining-npm-packages` | Dependency optimization (5 modes) |
| `using-lt-cli` | lt CLI reference, conventions |
| `developing-claude-plugins` | Plugin development (skills, commands, agents) |
| `coordinating-agent-teams` | Agent team coordination, parallelism |
| `building-stories-with-tdd` | TDD workflow for user stories |
| `rebasing-branches` | Rebase strategies with conflict resolution |
| `general-frontend-security` | OWASP frontend security |

---

## Vendor-Mode Processes

### 1. Create a new project in vendor mode

```
┌────────────────────────────────────────────────────────────────┐
│  DEVELOPER                                                     │
│                                                                │
│  lt fullstack init                                             │
│    --name my-project                                           │
│    --frontend nuxt                                             │
│    --api-mode Rest                                             │
│    --framework-mode vendor          ← Backend vendored         │
│    --frontend-framework-mode vendor ← Frontend vendored        │
│    --framework-upstream-branch 11.24.3                         │
│    --noConfirm                                                 │
│                                                                │
└───────────────────────┬────────────────────────────────────────┘
                        │
                        ▼
┌────────────────────────────────────────────────────────────────┐
│  lt CLI performs:                                              │
│                                                                │
│  1. git clone lt-monorepo                                      │
│  2. setup frontend (nuxt-base-starter)                         │
│  3. setup backend (nest-server-starter)                        │
│  4. convertCloneToVendored (backend):                          │
│     - clone nest-server 11.24.3 → /tmp                         │
│     - copy src/core/, index.ts, core.module.ts, etc.           │
│     - apply flatten-fix (4 edge cases)                         │
│     - rewrite consumer imports (@lenne.tech/nest-server → ../) │
│     - merge upstream deps dynamically                          │
│     - apply express type-imports fix                           │
│     - create src/core/VENDOR.md                                │
│     - prepend vendor notice to CLAUDE.md                       │
│  5. convertAppCloneToVendored (frontend):                      │
│     - clone nuxt-extensions 1.5.3 → /tmp                       │
│     - copy src/module.ts + src/runtime/                        │
│     - rewrite nuxt.config.ts modules[] entry                   │
│     - rewrite consumer imports (4 files)                       │
│     - remove @lenne.tech/nuxt-extensions dep                   │
│     - create app/core/VENDOR.md                                │
│     - prepend vendor notice to CLAUDE.md                       │
│  6. pnpm install (monorepo)                                    │
│  7. git init + initial commit                                  │
│                                                                │
└────────────────────────────────────────────────────────────────┘
                        │
                        ▼
┌────────────────────────────────────────────────────────────────┐
│  PROJECT READY                                                 │
│                                                                │
│  my-project/                                                   │
│  ├── projects/                                                 │
│  │   ├── api/                                                  │
│  │   │   ├── src/                                              │
│  │   │   │   ├── core/         ← Vendored nest-server          │
│  │   │   │   │   └── VENDOR.md                                 │
│  │   │   │   ├── server/       ← Project code                  │
│  │   │   │   └── main.ts                                       │
│  │   │   ├── bin/migrate.js                                    │
│  │   │   └── package.json (no @lenne.tech/nest-server)         │
│  │   └── app/                                                  │
│  │       ├── app/                                              │
│  │       │   ├── core/         ← Vendored nuxt-extensions      │
│  │       │   │   ├── module.ts                                 │
│  │       │   │   ├── runtime/                                  │
│  │       │   │   └── VENDOR.md                                 │
│  │       │   └── ...                                           │
│  │       ├── nuxt.config.ts (modules: ['./app/core/module'])   │
│  │       └── package.json (no @lenne.tech/nuxt-extensions)    │
│  └── CLAUDE.md                                                 │
└────────────────────────────────────────────────────────────────┘
```

**Alternative**: Only backend OR only frontend vendored. Omit the respective flag:

```bash
# Only backend vendored, frontend stays npm
lt fullstack init --name my-project --frontend nuxt --api-mode Rest \
  --framework-mode vendor --framework-upstream-branch 11.24.3 --noConfirm

# Only frontend vendored, backend stays npm
lt fullstack init --name my-project --frontend nuxt --api-mode Rest \
  --frontend-framework-mode vendor --noConfirm
```

---

### 2. Backend: convert npm → vendor

**Starting point**: Existing project in npm mode (`@lenne.tech/nest-server` in `package.json`).

```
┌──────────────────────────────────────────────────────────┐
│  DEVELOPER in projects/api/                              │
│                                                          │
│  Option A — Via Claude Code (with migration guides):     │
│    /lt-dev:backend:convert-to-vendor                     │
│                                                          │
│  Option B — Directly via CLI (no migration guides):      │
│    lt server convert-mode --to vendor                    │
│                                                          │
│  Option C — Dry-run (plan without changes):              │
│    lt server convert-mode --to vendor --dry-run          │
└─────────────┬────────────────────────────────────────────┘
              │
              ▼ Option A uses agent
┌──────────────────────────────────────────────────────────┐
│  vendor-mode-converter agent                             │
│                                                          │
│  Phase 0: Prerequisites                                  │
│    - Verify npm mode                                     │
│    - Verify NOT already vendored                         │
│    - Verify lt CLI available                             │
│                                                          │
│  Phase 1: Version detection                              │
│    - SOURCE = current @lenne.tech/nest-server version    │
│    - TARGET = latest (or specified)                      │
│    - Calculate version gap                               │
│                                                          │
│  Phase 2: Migration-guide discovery                      │
│    - gh api lenneTech/nest-server/contents/migration-    │
│      guides                                              │
│    - Filter by from-version >= SOURCE, < TARGET          │
│    - Build ordered migration plan                        │
│                                                          │
│  Phase 3: CLI conversion                                 │
│    - lt server convert-mode --to vendor                  │
│      --upstream-branch <TARGET>                          │
│    - Applies all transformations:                        │
│      • clone nest-server                                 │
│      • copy + flatten-fix                                │
│      • rewrite imports                                   │
│      • merge deps                                        │
│      • express type-imports fix                          │
│      • VENDOR.md                                         │
│                                                          │
│  Phase 4: Migration application                          │
│    - Apply each migration guide in version order         │
│    - Translate @lenne.tech/nest-server refs to relative  │
│      paths                                               │
│                                                          │
│  Phase 5: Validation loop                                │
│    - tsc --noEmit                                        │
│    - pnpm lint                                           │
│    - pnpm test                                           │
│    - Fix until green                                     │
│                                                          │
│  Phase 6: Report                                         │
└──────────────────────────────────────────────────────────┘
```

---

### 3. Frontend: convert npm → vendor

**Starting point**: Existing Nuxt project in npm mode.

```
┌──────────────────────────────────────────────────────────┐
│  DEVELOPER in projects/app/                              │
│                                                          │
│  Option A — Via Claude Code (with changelog):            │
│    /lt-dev:frontend:convert-to-vendor                    │
│                                                          │
│  Option B — Directly via CLI:                            │
│    lt frontend convert-mode --to vendor                  │
│                                                          │
│  Option C — Dry-run:                                     │
│    lt frontend convert-mode --to vendor --dry-run        │
└─────────────┬────────────────────────────────────────────┘
              │
              ▼
┌──────────────────────────────────────────────────────────┐
│  vendor-mode-converter-frontend agent (Option A)         │
│                                                          │
│  Phase 0: Prerequisites                                  │
│  Phase 1: Version detection                              │
│    - SOURCE = current @lenne.tech/nuxt-extensions        │
│    - TARGET = latest                                     │
│                                                          │
│  Phase 2: Changelog discovery                            │
│    - Fetch CHANGELOG.md from nuxt-extensions repo        │
│    - Fetch GitHub releases for version gap               │
│                                                          │
│  Phase 3: CLI conversion                                 │
│    - lt frontend convert-mode --to vendor                │
│      --upstream-branch <TARGET>                          │
│    - Transformations:                                    │
│      • clone nuxt-extensions                             │
│      • copy src/module.ts + src/runtime/                 │
│      • rewrite nuxt.config.ts                            │
│      • rewrite 4 explicit consumer imports               │
│      • remove @lenne.tech/nuxt-extensions dep            │
│      • VENDOR.md                                         │
│                                                          │
│  Phase 4: Changelog application                          │
│    - Apply breaking changes from changelog              │
│                                                          │
│  Phase 5: Validation                                     │
│    - nuxt build                                          │
│    - pnpm lint                                           │
│                                                          │
│  Phase 6: Report                                         │
└──────────────────────────────────────────────────────────┘
```

---

### 4. Backend: vendor → npm rollback

**Starting point**: Project in vendor mode (`src/core/VENDOR.md` exists).

```
┌──────────────────────────────────────────────────────────┐
│  DEVELOPER in projects/api/                              │
│                                                          │
│  Option A — Via Claude Code:                             │
│    /lt-dev:backend:convert-to-npm                        │
│                                                          │
│  Option B — Directly via CLI:                            │
│    lt server convert-mode --to npm                       │
│                                                          │
│  With specific version:                                  │
│    lt server convert-mode --to npm --version 11.24.3     │
└─────────────┬────────────────────────────────────────────┘
              │
              ▼
┌──────────────────────────────────────────────────────────┐
│  lt CLI performs:                                        │
│                                                          │
│  1. Read baseline version from src/core/VENDOR.md        │
│  2. Warn if local patches exist in VENDOR.md             │
│     → Hint: /lt-dev:backend:contribute-nest-server-core  │
│     should be run FIRST to upstream them                 │
│  3. Rewrite consumer imports:                            │
│     relative paths → @lenne.tech/nest-server             │
│  4. Delete src/core/                                     │
│  5. Restore @lenne.tech/nest-server dep                  │
│  6. Restore migrate:* scripts to node_modules paths      │
│  7. Remove vendor artifacts:                             │
│     - bin/migrate.js                                     │
│     - migrations-utils/ts-compiler.js                    │
│     - migration-guides/                                  │
│  8. Remove CLAUDE.md vendor marker block                 │
│  9. Post-verification: scan for stale relative imports   │
└──────────────────────────────────────────────────────────┘
```

**⚠️ Warning before rollback:**
Before a `convert-to-npm`, all substantial local patches in the vendored core should be **contributed upstream** via `/lt-dev:backend:contribute-nest-server-core` — otherwise they will be lost.

---

### 5. Frontend: vendor → npm rollback

```
┌──────────────────────────────────────────────────────────┐
│  DEVELOPER in projects/app/                              │
│                                                          │
│  Option A — Via Claude Code:                             │
│    /lt-dev:frontend:convert-to-npm                       │
│                                                          │
│  Option B — Directly via CLI:                            │
│    lt frontend convert-mode --to npm                     │
│                                                          │
│  With specific version:                                  │
│    lt frontend convert-mode --to npm --version 1.5.3     │
└─────────────┬────────────────────────────────────────────┘
              │
              ▼
┌──────────────────────────────────────────────────────────┐
│  lt CLI performs:                                        │
│                                                          │
│  1. Read baseline version from app/core/VENDOR.md        │
│  2. Warn if local patches exist in VENDOR.md             │
│  3. Rewrite consumer imports:                            │
│     relative paths → @lenne.tech/nuxt-extensions         │
│  4. Delete app/core/                                     │
│  5. Restore @lenne.tech/nuxt-extensions dep              │
│  6. Rewrite nuxt.config.ts:                              │
│     './app/core/module' → '@lenne.tech/nuxt-extensions'  │
│  7. Remove vendor-freshness script                       │
│  8. Remove CLAUDE.md vendor marker block                 │
│  9. Post-verification                                    │
└──────────────────────────────────────────────────────────┘
```

---

### 6. Update workflows

The **recommended** path for all updates is `/lt-dev:fullstack:update-all`. It is mode-aware and orchestrates the appropriate agents automatically.

```
┌──────────────────────────────────────────────────────────────────┐
│  /lt-dev:fullstack:update-all                                    │
│                                                                  │
│  Phase 1: Detect project structure + framework modes             │
│    Backend:  test -f <api>/src/core/VENDOR.md  → vendor | npm    │
│    Frontend: test -f <app>/app/core/VENDOR.md  → vendor | npm    │
│                                                                  │
│  Phase 2: Version analysis + UPDATE_PLAN.md + user approval      │
│                                                                  │
│  Phase 3: Backend framework update                               │
│    IF npm:     spawn lt-dev:nest-server-updater                  │
│    IF vendor:  spawn lt-dev:nest-server-core-updater             │
│                                                                  │
│  Phase 4: Frontend framework update                              │
│    IF npm:     spawn lt-dev:fullstack-updater --skip-backend     │
│    IF vendor:  spawn lt-dev:nuxt-extensions-core-updater         │
│                                                                  │
│  Phase 5: Package maintenance                                    │
│    → spawn lt-dev:npm-package-maintainer (FULL MODE)             │
│    (for backend AND frontend package.json)                       │
│                                                                  │
│  Phase 6: CLAUDE.md sync from upstream starters                  │
│                                                                  │
│  Phase 7: Cross-validation (build + lint + tests)                │
│                                                                  │
│  Phase 8: Final report                                           │
└──────────────────────────────────────────────────────────────────┘
```

**All 4 mode combinations are supported:**

| Backend | Frontend | Backend Agent | Frontend Agent |
|---------|----------|---------------|----------------|
| npm | npm | `nest-server-updater` | `fullstack-updater --skip-backend` |
| npm | vendor | `nest-server-updater` | `nuxt-extensions-core-updater` |
| vendor | npm | `nest-server-core-updater` | `fullstack-updater --skip-backend` |
| vendor | vendor | `nest-server-core-updater` | `nuxt-extensions-core-updater` |

**Skip flags:**

```bash
/lt-dev:fullstack:update-all --dry-run        # Plan only
/lt-dev:fullstack:update-all --skip-backend   # Frontend only
/lt-dev:fullstack:update-all --skip-frontend  # Backend only
/lt-dev:fullstack:update-all --skip-packages  # Framework only, no package maintenance
```

**Individual updates** (if you only need one part):

```bash
# Backend npm mode
/lt-dev:backend:update-nest-server

# Backend vendor mode
/lt-dev:backend:update-nest-server-core

# Frontend vendor mode
/lt-dev:frontend:update-nuxt-extensions-core

# Packages only
/lt-dev:maintenance:maintain
```

---

### 7. Upstream contribution

If you have made **generally useful** changes to the vendored core (bug fixes, features), they can be contributed back as pull requests to the upstream repo.

```
┌──────────────────────────────────────────────────────────┐
│  BACKEND:  /lt-dev:backend:contribute-nest-server-core   │
│  FRONTEND: /lt-dev:frontend:contribute-nuxt-extensions-core│
│                                                          │
│  Phase 1: git log since VENDOR.md baseline               │
│  Phase 2: Filter cosmetic commits (format, lint)         │
│  Phase 3: Categorize:                                    │
│    - upstream-candidate: generic bugfix, framework       │
│      enhancement, type correction                        │
│    - project-specific: business rules, branding          │
│  Phase 4: Clone upstream fresh + cherry-pick candidates  │
│  Phase 5: Generate PR draft with motivation              │
│  Phase 6: Present summary for human review               │
│                                                          │
│  Human: reviews + pushes PR via normal GitHub flow       │
└──────────────────────────────────────────────────────────┘
```

After the PR is merged, the next `/lt-dev:backend:update-nest-server-core` or `/lt-dev:frontend:update-nuxt-extensions-core` run will recognize the patch as "upstream-delivered" and remove it from the VENDOR.md local-changes log.

---

## Decision Matrix

### When to use npm mode?

- ✅ Standard project without local framework modifications
- ✅ Fast updates via `pnpm update`
- ✅ Simpler CI/CD
- ✅ Smaller memory footprint in the repo

### When to use vendor mode?

- ✅ Claude Code should **understand** the framework code (better context comprehension)
- ✅ Local patches to the framework are required
- ✅ Upstream contributions should emerge from real development
- ✅ Debugging in framework code with source maps / original code
- ✅ Framework changes immediately testable without npm release cycle
- ⚠️ Requires occasional merge conflict handling during sync
- ⚠️ Longer test import phase (TypeScript source)

---

## Glossary

| Term | Meaning |
|------|---------|
| **npm mode** | Framework as `@lenne.tech/nest-server` / `@lenne.tech/nuxt-extensions` npm dependency |
| **Vendor mode** | Framework source copied into `src/core/` (backend) or `app/core/` (frontend) |
| **VENDOR.md** | Marker file in the vendored core with baseline version, sync history, local patches |
| **Flatten-fix** | Import path rewrites in 4 backend files after copying (backend only) |
| **Consumer-import codemod** | Rewrite of `@lenne.tech/nest-server` to relative paths in project code |
| **Upstream sync** | Pulling upstream changes into the vendored core |
| **Upstream contribution** | Pushing local patches as PR to the upstream repo |
| **Mode-aware** | Code that automatically chooses correct paths for npm or vendor |
| **Starter** | `nest-server-starter` / `nuxt-base-starter` — template repo with standard config |

---

## Sources & References

### GitHub repos

| Repo | URL |
|------|-----|
| lt CLI | https://github.com/lenneTech/cli |
| lt-dev Plugin | https://github.com/lenneTech/claude-code |
| nest-server framework | https://github.com/lenneTech/nest-server |
| nest-server starter | https://github.com/lenneTech/nest-server-starter |
| nuxt-extensions module | https://github.com/lenneTech/nuxt-extensions |
| nuxt-base starter | https://github.com/lenneTech/nuxt-base-starter |
| lt-monorepo template | https://github.com/lenneTech/lt-monorepo |

### Local documentation

- `cli/CLAUDE.md` — CLI internal documentation + vendor touchpoints table
- `cli/docs/commands.md` — CLI command reference
- `cli/docs/lt.config.md` — CLI config reference
- `cli/scripts/test-vendor-init.sh` — Backend vendor integration tests (4 scenarios × ~22 assertions)
- `cli/scripts/test-frontend-vendor-init.sh` — Frontend vendor integration tests (4 scenarios)

---

## Quick Reference — The Most Important Commands

```bash
# ═══════════════════════════════════════════════════════════════
# PROJECT SETUP
# ═══════════════════════════════════════════════════════════════

# New project (both in vendor mode)
lt fullstack init --name <n> --frontend nuxt --api-mode Rest \
  --framework-mode vendor --frontend-framework-mode vendor --noConfirm

# New project (npm mode, standard)
lt fullstack init --name <n> --frontend nuxt --api-mode Rest --noConfirm

# Check status (shows both modes at monorepo root)
lt status

# ═══════════════════════════════════════════════════════════════
# CONVERSION — Fullstack (both subprojects in one step)
# ═══════════════════════════════════════════════════════════════

# Both subprojects: npm → vendor (from monorepo root)
lt fullstack convert-mode --to vendor --noConfirm

# Both subprojects: vendor → npm (rollback)
lt fullstack convert-mode --to npm --noConfirm

# With specific upstream versions
lt fullstack convert-mode --to vendor \
  --framework-upstream-branch 11.24.3 \
  --frontend-framework-upstream-branch 1.5.3 \
  --noConfirm

# Only backend or only frontend
lt fullstack convert-mode --to vendor --skip-frontend --noConfirm
lt fullstack convert-mode --to vendor --skip-backend --noConfirm

# Dry-run (plan without changes)
lt fullstack convert-mode --to vendor --dry-run

# ═══════════════════════════════════════════════════════════════
# CONVERSION — Individual (in the respective subprojects)
# ═══════════════════════════════════════════════════════════════

# Backend: npm → vendor (with migrations via Claude Code)
/lt-dev:backend:convert-to-vendor

# Backend: npm → vendor (directly via CLI)
cd projects/api && lt server convert-mode --to vendor

# Frontend: npm → vendor (with changelog via Claude Code)
/lt-dev:frontend:convert-to-vendor

# Frontend: npm → vendor (directly via CLI)
cd projects/app && lt frontend convert-mode --to vendor

# Rollback individually
cd projects/api && lt server convert-mode --to npm
cd projects/app && lt frontend convert-mode --to npm

# ═══════════════════════════════════════════════════════════════
# UPDATES
# ═══════════════════════════════════════════════════════════════

# Comprehensive fullstack update (recommended, mode-aware)
/lt-dev:fullstack:update-all

# Backend only
/lt-dev:backend:update-nest-server        # npm mode
/lt-dev:backend:update-nest-server-core   # vendor mode

# Frontend only
/lt-dev:frontend:update-nuxt-extensions-core  # vendor mode

# Packages only
/lt-dev:maintenance:maintain

# ═══════════════════════════════════════════════════════════════
# UPSTREAM CONTRIBUTION
# ═══════════════════════════════════════════════════════════════

# Backend: prepare local patches as PR
/lt-dev:backend:contribute-nest-server-core

# Frontend: prepare local patches as PR
/lt-dev:frontend:contribute-nuxt-extensions-core
```

---

*This file is intended as living documentation. It should be updated when new features are added to the lt CLI or lt-dev plugin.*
