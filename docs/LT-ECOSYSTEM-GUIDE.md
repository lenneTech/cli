# lenne.tech Fullstack-Ecosystem: CLI & lt-dev Plugin

Umfassender Leitfaden für `lt CLI` und das `lt-dev` Claude-Code-Plugin mit Fokus auf **Vendor-Mode-Workflows** für `@lenne.tech/nest-server` und `@lenne.tech/nuxt-extensions`.

---

## Inhaltsverzeichnis

- [Überblick](#überblick)
- [Architekturdiagramm](#architekturdiagramm)
- [lt CLI — Funktionen](#lt-cli--funktionen)
  - [Projekt-Scaffolding](#projekt-scaffolding)
  - [Server-Entwicklung](#server-entwicklung)
  - [Frontend-Entwicklung](#frontend-entwicklung)
  - [Fullstack-Workflows](#fullstack-workflows)
  - [Vendor-Mode-Konvertierung](#vendor-mode-konvertierung)
  - [Status & Diagnose](#status--diagnose)
  - [Weitere Tools](#weitere-tools)
- [lt-dev Plugin — Funktionen](#lt-dev-plugin--funktionen)
  - [Commands](#commands)
  - [Autonomous Agents](#autonomous-agents)
  - [Skills (Wissensbasis)](#skills-wissensbasis)
- [Vendor-Mode-Prozesse](#vendor-mode-prozesse)
  - [Neues Projekt im Vendor-Mode erstellen](#1-neues-projekt-im-vendor-mode-erstellen)
  - [npm → Vendor überführen (Backend)](#2-backend-npm--vendor-überführen)
  - [npm → Vendor überführen (Frontend)](#3-frontend-npm--vendor-überführen)
  - [Vendor → npm zurückführen (Backend)](#4-backend-vendor--npm-rückführung)
  - [Vendor → npm zurückführen (Frontend)](#5-frontend-vendor--npm-rückführung)
  - [Update-Workflows](#6-update-workflows)
  - [Upstream-Contribution](#7-upstream-contribution)
- [Entscheidungsmatrix](#entscheidungsmatrix)
- [Glossar](#glossar)

---

## Überblick

Das lenne.tech-Ecosystem besteht aus zwei komplementären Werkzeugen:

- **`lt CLI`** (`@lenne.tech/cli`) — Terminal-Tool für Scaffolding, Generierung, Status und Mode-Konvertierung
- **`lt-dev` Plugin** — Claude-Code-Plugin mit Commands, autonomen Agents und Skills für intelligente Entwicklungs-Workflows

Beide Werkzeuge unterstützen den **Vendor-Mode** als Pilot für `@lenne.tech/nest-server` (Backend) und `@lenne.tech/nuxt-extensions` (Frontend). Im Vendor-Mode wird der Framework-Code direkt als Projekt-Source in `src/core/` (Backend) bzw. `app/core/` (Frontend) kopiert — ohne npm-Dependency.

---

## Architekturdiagramm

```
┌─────────────────────────────────────────────────────────────────────┐
│                  Entwickler / Claude Code                           │
└─────────┬────────────────────────────────────────────────┬──────────┘
          │                                                │
          │ Terminal                                       │ Slash-Commands
          ▼                                                ▼
┌──────────────────────┐                      ┌────────────────────────┐
│      lt CLI          │                      │    lt-dev Plugin       │
│                      │                      │                        │
│ • Scaffolding        │                      │ • Commands             │
│ • Mode-Conversion    │◄─── invoked by ──────┤ • Agents               │
│ • Code-Generation    │                      │ • Skills               │
│ • Status/Diagnose    │                      │                        │
└──────────┬───────────┘                      └────────────┬───────────┘
           │                                               │
           │ writes to                                     │ operates on
           ▼                                               ▼
┌──────────────────────────────────────────────────────────────────────┐
│                    Fullstack-Projekt                                 │
│                                                                      │
│  projects/api (Backend — NestJS)          projects/app (Frontend)    │
│  ├── npm mode: @lenne.tech/nest-server    ├── npm mode: @lenne.tech/ │
│  │    in package.json                     │    nuxt-extensions       │
│  └── vendor mode: src/core/ + VENDOR.md   └── vendor mode: app/core/ │
│                                                + VENDOR.md           │
└──────────────────────────────────────────────────────────────────────┘
           ▲                                              ▲
           │ syncs from                                   │ syncs from
           │                                              │
┌──────────┴──────────────┐                   ┌───────────┴────────────┐
│  github.com/lenneTech/  │                   │ github.com/lenneTech/  │
│  nest-server            │                   │ nuxt-extensions        │
│  nest-server-starter    │                   │ nuxt-base-starter      │
└─────────────────────────┘                   └────────────────────────┘
```

---

## lt CLI — Funktionen

### Projekt-Scaffolding

| Command | Zweck |
|---------|-------|
| `lt fullstack init` | Erstellt ein neues Monorepo mit API + Frontend. Unterstützt npm- und vendor-Mode für beide Seiten |
| `lt frontend nuxt` | Standalone Nuxt-4-Projekt aus `nuxt-base-starter` |
| `lt frontend angular` | Standalone Angular-Projekt aus `ng-base-starter` |
| `lt server create` | Standalone NestJS-Projekt aus `nest-server-starter` |
| `lt starter chrome-extension` | Chrome-Extension-Starter |
| `lt cli create` | Neues CLI-Projekt via Gluegun |
| `lt typescript create` | TypeScript-Library-Starter |

**Fullstack-Init mit Vendor-Modes:**

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
- `--framework-mode npm|vendor` — Backend-Modus
- `--frontend-framework-mode npm|vendor` — Frontend-Modus
- `--framework-upstream-branch <tag>` — Spezifische nest-server Version für Vendor
- `--dry-run` — Plan anzeigen ohne Änderungen

---

### Server-Entwicklung

| Command | Zweck |
|---------|-------|
| `lt server module` | Generiert ein NestJS-Modul (Model, Service, Controller, Resolver, Tests) |
| `lt server object` | Generiert einen Input/Output-Typ |
| `lt server add-property` | Fügt einem existierenden Modul ein Property hinzu |
| `lt server test` | Generiert E2E-Tests für ein Modul |
| `lt server permissions` | Analysiert alle `@Roles`/`@Restricted` Decoratoren, erzeugt Report (md/json/html) |
| `lt server create-secret` | Generiert sichere Secrets für `.env` |
| `lt server set-secrets` | Setzt Secrets im Projekt |
| **`lt server convert-mode`** | **Konvertiert Backend zwischen npm und vendor Mode** |

Alle Code-Generatoren sind **mode-aware**: Im Vendor-Mode nutzen sie relative Pfade zu `src/core/`, im npm-Mode den bare specifier `@lenne.tech/nest-server`.

---

### Frontend-Entwicklung

| Command | Zweck |
|---------|-------|
| `lt frontend nuxt` | Nuxt-Projekt aus Starter erstellen |
| `lt frontend angular` | Angular-Projekt aus Starter erstellen |
| **`lt frontend convert-mode`** | **Konvertiert Frontend zwischen npm und vendor Mode** |

---

### Fullstack-Workflows

| Command | Zweck |
|---------|-------|
| `lt fullstack init` | Fullstack-Monorepo erstellen (siehe oben) |
| `lt fullstack update` | Zeigt mode-spezifische Update-Anweisungen für Backend UND Frontend |
| **`lt fullstack convert-mode`** | **Konvertiert Backend UND Frontend in einem Schritt zwischen npm und vendor Mode** |

**Fullstack Mode-Konvertierung in einem Command:**

```bash
# Beide Subprojekte in vendor mode
lt fullstack convert-mode --to vendor --noConfirm

# Mit spezifischen Upstream-Versionen
lt fullstack convert-mode --to vendor \
  --framework-upstream-branch 11.24.3 \
  --frontend-framework-upstream-branch 1.5.3 \
  --noConfirm

# Beide zurück zu npm
lt fullstack convert-mode --to npm --noConfirm

# Nur Backend konvertieren
lt fullstack convert-mode --to vendor --skip-frontend --noConfirm

# Nur Frontend konvertieren
lt fullstack convert-mode --to vendor --skip-backend --noConfirm

# Dry-run (Plan ohne Änderungen)
lt fullstack convert-mode --to vendor --dry-run
```

Der Command findet automatisch `projects/api/` und `projects/app/` (oder `packages/api` / `packages/app`), erkennt die aktuellen Modi, zeigt einen Plan an und orchestriert dann die Konvertierung beider Seiten mit den passenden Helper-Methoden.

---

### Vendor-Mode-Konvertierung

**Backend**: `lt server convert-mode`

```bash
# npm → vendor
cd projects/api
lt server convert-mode --to vendor --upstream-branch 11.24.3 --noConfirm

# vendor → npm
lt server convert-mode --to npm --version 11.24.3 --noConfirm

# Dry-run (Plan ohne Änderungen)
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

Beide Commands klonen das jeweilige Upstream-Repo nach `/tmp/`, führen die Code-Transformation durch und räumen am Ende auf. Es werden **keine lokalen Pfade** benötigt.

---

### Status & Diagnose

| Command | Zweck |
|---------|-------|
| `lt status` | Zeigt Projekt-Typ, Framework-Modus (Backend + Frontend), Config, Git-Branch, Versionen. Im Monorepo-Root werden beide Subprojekte automatisch gescannt |
| `lt doctor` | Prüft Umgebung, Versionen, Abhängigkeiten |
| `lt history` | Zeigt CLI-Command-Verlauf |

**Beispiel im IMO-Monorepo-Root:**

```
Monorepo Subprojects:
  Backend:  projects/api → vendor (src/core/, VENDOR.md)
  Frontend: projects/app → vendor (app/core/, VENDOR.md)
```

---

### Weitere Tools

| Bereich | Commands |
|---------|----------|
| **Config** | `lt config init`, `lt config validate`, `lt config show`, `lt config help` |
| **Git** | `lt git create`, `git get`, `git update`, `git clean`, `git squash`, `git rebase`, `git rename`, `git reset`, `git undo`, `git clear`, `git force-pull` |
| **NPM** | `lt npm reinit` |
| **MongoDB** | `lt mongodb collection-export`, `mongodb s3-restore` |
| **Qdrant** | `lt qdrant stats`, `qdrant delete` |
| **Directus** | `lt directus docker-setup`, `directus typegen`, `directus remove` |
| **Deployment** | `lt deployment create` (GitHub/GitLab Pipelines) |
| **Blocks/Components** | `lt blocks add`, `lt components add` |
| **Tools** | `lt tools regex`, `tools sha256`, `tools jwt-read`, `tools crypt`, `tools install-scripts` |
| **Docs** | `lt docs open` |
| **Claude** | `lt claude shortcuts`, `lt claude plugins` |
| **Templates** | `lt templates llm` |

---

## lt-dev Plugin — Funktionen

Das `lt-dev` Claude-Code-Plugin enthält **Commands** (User-invocable), **Agents** (autonome Execution) und **Skills** (Wissensbasen).

### Commands

#### Backend

| Command | Zweck |
|---------|-------|
| `/lt-dev:backend:update-nest-server` | Aktualisiert `@lenne.tech/nest-server` im npm-Mode mit Migration-Guides |
| `/lt-dev:backend:update-nest-server-core` | Synct vendored `src/core/` mit Upstream (Vendor-Mode) |
| `/lt-dev:backend:convert-to-vendor` | Konvertiert bestehendes Projekt von npm → vendor (inkl. Migration-Guides) |
| `/lt-dev:backend:convert-to-npm` | Konvertiert vendored Projekt zurück zu npm |
| `/lt-dev:backend:contribute-nest-server-core` | Bereitet lokale Patches als Upstream-PR für nest-server vor |
| `/lt-dev:backend:sec-audit` | Security-Audit des Backend-Codes |
| `/lt-dev:backend:sec-review` | Security-Review eines spezifischen Code-Bereichs |
| `/lt-dev:backend:test-generate` | Generiert E2E-Tests |
| `/lt-dev:backend:code-cleanup` | Räumt Code auf (imports, formatting) |

#### Frontend

| Command | Zweck |
|---------|-------|
| `/lt-dev:frontend:update-nuxt-extensions-core` | Synct vendored `app/core/` mit Upstream |
| `/lt-dev:frontend:convert-to-vendor` | Konvertiert Frontend-Projekt von npm → vendor |
| `/lt-dev:frontend:convert-to-npm` | Konvertiert vendored Frontend zurück zu npm |
| `/lt-dev:frontend:contribute-nuxt-extensions-core` | Bereitet lokale Patches als Upstream-PR für nuxt-extensions vor |
| `/lt-dev:frontend:figma-init` | Initialisiert Figma-Code-Connect Setup |
| `/lt-dev:frontend:figma-research` | Analysiert Figma-Designs für Implementierung |
| `/lt-dev:frontend:figma-to-code` | Übersetzt Figma-Design in Vue/Nuxt-Code |
| `/lt-dev:frontend:env-migrate` | Migriert `.env` von alten Standards |
| `/lt-dev:frontend:init-conventions` | Initialisiert Frontend-Konventionen |

#### Fullstack

| Command | Zweck |
|---------|-------|
| **`/lt-dev:fullstack:update-all`** | **Comprehensive Update**: Backend + Frontend (mode-aware) + Package-Maintenance + CLAUDE.md-Sync + Validation |
| `/lt-dev:fullstack:update` | Einfacher Backend + Frontend Update (legacy, weniger umfassend) |
| `/lt-dev:fullstack:sync-claude-md` | Synct `CLAUDE.md` aus Upstream-Starter-Templates |

#### Maintenance

| Command | Zweck |
|---------|-------|
| `/lt-dev:maintenance:maintain` | FULL MODE: Package-Update + Audit + Security + Deduplication |
| `/lt-dev:maintenance:maintain-check` | DRY-RUN: Analyse ohne Änderungen |
| `/lt-dev:maintenance:maintain-security` | Nur Security-Patches |
| `/lt-dev:maintenance:maintain-pre-release` | Conservative Patch-only vor Release |
| `/lt-dev:maintenance:maintain-post-feature` | Post-Feature-Cleanup |

#### Git

| Command | Zweck |
|---------|-------|
| `/lt-dev:git:commit-message` | Generiert Conventional-Commit-Message aus Staging |
| `/lt-dev:git:create-request` | Erstellt Merge-Request mit beschreibendem Body |
| `/lt-dev:git:mr-description` | Generiert MR-Description aus Commits |
| `/lt-dev:git:mr-description-clipboard` | Dito, kopiert ins Clipboard |
| `/lt-dev:git:rebase` | Rebase auf development-Branch mit Conflict-Resolution |
| `/lt-dev:git:rebase-mrs` | Rebased mehrere MRs hintereinander |

#### Docker

| Command | Zweck |
|---------|-------|
| `/lt-dev:docker:gen-setup` | Generiert Docker-Konfiguration (Dockerfile + compose + .env) |

#### Plugin

| Command | Zweck |
|---------|-------|
| `/lt-dev:plugin:check` | Validiert das Plugin-Setup nach Context-Loss |
| `/lt-dev:plugin:element` | Interaktives Erstellen neuer Plugin-Elemente |

#### Vibe (Spec-Driven Development)

| Command | Zweck |
|---------|-------|
| `/lt-dev:vibe:plan` | Erstellt Implementierungsplan aus Requirement |
| `/lt-dev:vibe:build` | Implementiert nach Plan |
| `/lt-dev:vibe:build-plan` | Plan + Build in einem Flow |

#### Standalone

| Command | Zweck |
|---------|-------|
| `/lt-dev:debug` | Structured Debugging Session |
| `/lt-dev:review` | Code-Review mit mehreren Reviewer-Perspektiven |
| `/lt-dev:refactor-frontend` | Frontend-Refactoring-Helfer |
| `/lt-dev:resolve-ticket` | Linear-Ticket implementieren |
| `/lt-dev:create-ticket` | Linear-Ticket erstellen |
| `/lt-dev:create-story` | User-Story erstellen (DE) |
| `/lt-dev:create-task` | Linear-Task erstellen |
| `/lt-dev:create-bug` | Linear-Bug erstellen |
| `/lt-dev:linear-comment` | Linear-Kommentar erstellen |
| `/lt-dev:dev-submit` | Dev-Submit-Workflow (commit + push + MR) |
| `/lt-dev:interview` | Struktur-Interview für Requirements |
| `/lt-dev:skill-optimize` | Optimiert eine Plugin-Skill |
| `/lt-dev:spec-to-tasks` | Spec → Aufgaben-Liste |

---

### Autonomous Agents

Autonome Agents führen mehrschrittige Aufgaben ohne Interaktion aus. Sie werden via Commands oder Agent-Tool gespawnt.

#### Vendor-Mode Agents

| Agent | Zweck | Gespawnt von |
|-------|-------|--------------|
| `vendor-mode-converter` | Backend npm → vendor Konvertierung inkl. Migration-Guides | `/lt-dev:backend:convert-to-vendor` |
| `vendor-mode-converter-frontend` | Frontend npm → vendor Konvertierung inkl. Changelog | `/lt-dev:frontend:convert-to-vendor` |
| `nest-server-core-updater` | Upstream-Sync für vendored nest-server core | `/lt-dev:backend:update-nest-server-core` |
| `nuxt-extensions-core-updater` | Upstream-Sync für vendored nuxt-extensions core | `/lt-dev:frontend:update-nuxt-extensions-core` |
| `nest-server-core-contributor` | Upstream-PR-Drafts aus lokalen Backend-Patches | `/lt-dev:backend:contribute-nest-server-core` |
| `nuxt-extensions-core-contributor` | Upstream-PR-Drafts aus lokalen Frontend-Patches | `/lt-dev:frontend:contribute-nuxt-extensions-core` |

#### Update-Agents

| Agent | Zweck |
|-------|-------|
| `nest-server-updater` | npm-Mode Update von nest-server inkl. Migration-Guides |
| `fullstack-updater` | Coordinated Backend + Frontend Update (legacy) |
| `npm-package-maintainer` | Package-Optimierung (5 Modes) |
| `branch-rebaser` | Rebase-Automation mit Conflict-Resolution |

#### Development Agents

| Agent | Zweck |
|-------|-------|
| `backend-dev` | Autonomous NestJS-Entwicklung |
| `frontend-dev` | Autonomous Nuxt-4-Entwicklung |
| `architect` | Architektur-Planung mit Stack-Enforcement |
| `devops` | Docker, CI/CD, Environment |

#### Reviewer-Agents

| Agent | Zweck |
|-------|-------|
| `code-reviewer` | 6-Dimensionen Code-Review |
| `backend-reviewer` | NestJS-spezifisch |
| `frontend-reviewer` | Vue/Nuxt-spezifisch |
| `security-reviewer` | OWASP-aligned |
| `a11y-reviewer` | Accessibility + Lighthouse |
| `ux-reviewer` | UX-Patterns |
| `performance-reviewer` | Bundle, Queries, Caching |
| `devops-reviewer` | Docker, CI/CD Security |
| `docs-reviewer` | README, JSDoc, Migration-Guides |
| `test-reviewer` | Test-Coverage + Quality |

---

### Skills (Wissensbasis)

Skills enthalten strukturiertes Wissen und werden automatisch aktiviert bei passenden Anfragen.

| Skill | Zweck |
|-------|-------|
| **`nest-server-core-vendoring`** | Backend-Vendoring-Pattern, flatten-fix, Sync-Workflows |
| **`nuxt-extensions-core-vendoring`** | Frontend-Vendoring-Pattern, nuxt.config-Rewrite, Sync |
| `nest-server-updating` | npm-Mode Update-Prozesse, Migration-Guides, Error-Patterns |
| `generating-nest-servers` | NestJS-Module/Services/Controller generieren |
| `developing-lt-frontend` | Nuxt-4-Development, Composables, Forms, Auth |
| `maintaining-npm-packages` | Dependency-Optimierung (5 Modes) |
| `using-lt-cli` | lt CLI Reference, Konventionen |
| `developing-claude-plugins` | Plugin-Development (Skills, Commands, Agents) |
| `coordinating-agent-teams` | Agent-Team-Coordination, Parallelism |
| `building-stories-with-tdd` | TDD-Workflow für User-Stories |
| `rebasing-branches` | Rebase-Strategien mit Conflict-Resolution |
| `general-frontend-security` | OWASP Frontend Security |

---

## Vendor-Mode-Prozesse

### 1. Neues Projekt im Vendor-Mode erstellen

```
┌────────────────────────────────────────────────────────────────┐
│  ENTWICKLER                                                    │
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
│  lt CLI macht:                                                 │
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
│  PROJEKT BEREIT                                                │
│                                                                │
│  my-project/                                                   │
│  ├── projects/                                                 │
│  │   ├── api/                                                  │
│  │   │   ├── src/                                              │
│  │   │   │   ├── core/         ← Vendored nest-server          │
│  │   │   │   │   └── VENDOR.md                                 │
│  │   │   │   ├── server/       ← Projekt-Code                  │
│  │   │   │   └── main.ts                                       │
│  │   │   ├── bin/migrate.js                                    │
│  │   │   └── package.json (ohne @lenne.tech/nest-server)       │
│  │   └── app/                                                  │
│  │       ├── app/                                              │
│  │       │   ├── core/         ← Vendored nuxt-extensions      │
│  │       │   │   ├── module.ts                                 │
│  │       │   │   ├── runtime/                                  │
│  │       │   │   └── VENDOR.md                                 │
│  │       │   └── ...                                           │
│  │       ├── nuxt.config.ts (modules: ['./app/core/module'])   │
│  │       └── package.json (ohne @lenne.tech/nuxt-extensions)   │
│  └── CLAUDE.md                                                 │
└────────────────────────────────────────────────────────────────┘
```

**Alternative**: Nur Backend ODER nur Frontend vendored. Flags weglassen:

```bash
# Nur Backend vendored, Frontend bleibt npm
lt fullstack init --name my-project --frontend nuxt --api-mode Rest \
  --framework-mode vendor --framework-upstream-branch 11.24.3 --noConfirm

# Nur Frontend vendored, Backend bleibt npm
lt fullstack init --name my-project --frontend nuxt --api-mode Rest \
  --frontend-framework-mode vendor --noConfirm
```

---

### 2. Backend: npm → Vendor überführen

**Ausgangslage**: Existierendes Projekt im npm-Mode (`@lenne.tech/nest-server` in `package.json`).

```
┌──────────────────────────────────────────────────────────┐
│  ENTWICKLER in projects/api/                             │
│                                                          │
│  Option A — Via Claude Code (mit Migration-Guides):      │
│    /lt-dev:backend:convert-to-vendor                     │
│                                                          │
│  Option B — Direkt via CLI (ohne Migration-Guides):      │
│    lt server convert-mode --to vendor                    │
│                                                          │
│  Option C — Dry-Run (Plan ohne Änderungen):              │
│    lt server convert-mode --to vendor --dry-run          │
└─────────────┬────────────────────────────────────────────┘
              │
              ▼ Option A nutzt Agent
┌──────────────────────────────────────────────────────────┐
│  vendor-mode-converter Agent                             │
│                                                          │
│  Phase 0: Prerequisites                                  │
│    - Verify npm mode                                     │
│    - Verify NOT already vendored                         │
│    - Verify lt CLI available                             │
│                                                          │
│  Phase 1: Version Detection                              │
│    - SOURCE = current @lenne.tech/nest-server version    │
│    - TARGET = latest (or specified)                      │
│    - Calculate version gap                               │
│                                                          │
│  Phase 2: Migration-Guide Discovery                      │
│    - gh api lenneTech/nest-server/contents/migration-    │
│      guides                                              │
│    - Filter by from-version >= SOURCE, < TARGET          │
│    - Build ordered migration plan                        │
│                                                          │
│  Phase 3: CLI Conversion                                 │
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
│  Phase 4: Migration Application                          │
│    - Apply each migration guide in version order         │
│    - Translate @lenne.tech/nest-server refs to relative  │
│      paths                                               │
│                                                          │
│  Phase 5: Validation Loop                                │
│    - tsc --noEmit                                        │
│    - pnpm lint                                           │
│    - pnpm test                                           │
│    - Fix until green                                     │
│                                                          │
│  Phase 6: Report                                         │
└──────────────────────────────────────────────────────────┘
```

---

### 3. Frontend: npm → Vendor überführen

**Ausgangslage**: Existierendes Nuxt-Projekt im npm-Mode.

```
┌──────────────────────────────────────────────────────────┐
│  ENTWICKLER in projects/app/                             │
│                                                          │
│  Option A — Via Claude Code (mit Changelog):             │
│    /lt-dev:frontend:convert-to-vendor                    │
│                                                          │
│  Option B — Direkt via CLI:                              │
│    lt frontend convert-mode --to vendor                  │
│                                                          │
│  Option C — Dry-Run:                                     │
│    lt frontend convert-mode --to vendor --dry-run        │
└─────────────┬────────────────────────────────────────────┘
              │
              ▼
┌──────────────────────────────────────────────────────────┐
│  vendor-mode-converter-frontend Agent (Option A)         │
│                                                          │
│  Phase 0: Prerequisites                                  │
│  Phase 1: Version Detection                              │
│    - SOURCE = current @lenne.tech/nuxt-extensions        │
│    - TARGET = latest                                     │
│                                                          │
│  Phase 2: Changelog Discovery                            │
│    - Fetch CHANGELOG.md from nuxt-extensions repo        │
│    - Fetch GitHub releases for version gap               │
│                                                          │
│  Phase 3: CLI Conversion                                 │
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
│  Phase 4: Changelog Application                          │
│    - Apply breaking changes from changelog               │
│                                                          │
│  Phase 5: Validation                                     │
│    - nuxt build                                          │
│    - pnpm lint                                           │
│                                                          │
│  Phase 6: Report                                         │
└──────────────────────────────────────────────────────────┘
```

---

### 4. Backend: Vendor → npm Rückführung

**Ausgangslage**: Projekt im Vendor-Mode (`src/core/VENDOR.md` existiert).

```
┌──────────────────────────────────────────────────────────┐
│  ENTWICKLER in projects/api/                             │
│                                                          │
│  Option A — Via Claude Code:                             │
│    /lt-dev:backend:convert-to-npm                        │
│                                                          │
│  Option B — Direkt via CLI:                              │
│    lt server convert-mode --to npm                       │
│                                                          │
│  Mit spezifischer Version:                               │
│    lt server convert-mode --to npm --version 11.24.3     │
└─────────────┬────────────────────────────────────────────┘
              │
              ▼
┌──────────────────────────────────────────────────────────┐
│  lt CLI macht:                                           │
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

**⚠️ Warnung vor Rückführung:**
Vor einem `convert-to-npm` sollten alle substantiellen lokalen Patches im vendored core über `/lt-dev:backend:contribute-nest-server-core` **upstream beigetragen** werden — sonst gehen sie verloren.

---

### 5. Frontend: Vendor → npm Rückführung

```
┌──────────────────────────────────────────────────────────┐
│  ENTWICKLER in projects/app/                             │
│                                                          │
│  Option A — Via Claude Code:                             │
│    /lt-dev:frontend:convert-to-npm                       │
│                                                          │
│  Option B — Direkt via CLI:                              │
│    lt frontend convert-mode --to npm                     │
│                                                          │
│  Mit spezifischer Version:                               │
│    lt frontend convert-mode --to npm --version 1.5.3     │
└─────────────┬────────────────────────────────────────────┘
              │
              ▼
┌──────────────────────────────────────────────────────────┐
│  lt CLI macht:                                           │
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

### 6. Update-Workflows

Der **empfohlene** Weg für alle Updates ist `/lt-dev:fullstack:update-all`. Er ist mode-aware und orchestriert die passenden Agents automatisch.

```
┌──────────────────────────────────────────────────────────────────┐
│  /lt-dev:fullstack:update-all                                    │
│                                                                  │
│  Phase 1: Detect project structure + framework modes             │
│    Backend:  test -f <api>/src/core/VENDOR.md  → vendor | npm    │
│    Frontend: test -f <app>/app/core/VENDOR.md  → vendor | npm    │
│                                                                  │
│  Phase 2: Version analysis + UPDATE_PLAN.md + User Approval      │
│                                                                  │
│  Phase 3: Backend Framework Update                               │
│    IF npm:     spawn lt-dev:nest-server-updater                  │
│    IF vendor:  spawn lt-dev:nest-server-core-updater             │
│                                                                  │
│  Phase 4: Frontend Framework Update                              │
│    IF npm:     spawn lt-dev:fullstack-updater --skip-backend     │
│    IF vendor:  spawn lt-dev:nuxt-extensions-core-updater         │
│                                                                  │
│  Phase 5: Package Maintenance                                    │
│    → spawn lt-dev:npm-package-maintainer (FULL MODE)             │
│    (für Backend UND Frontend package.json)                       │
│                                                                  │
│  Phase 6: CLAUDE.md Sync aus Upstream Starters                   │
│                                                                  │
│  Phase 7: Cross-Validation (Build + Lint + Tests)                │
│                                                                  │
│  Phase 8: Final Report                                           │
└──────────────────────────────────────────────────────────────────┘
```

**Alle 4 Modus-Kombinationen werden unterstützt:**

| Backend | Frontend | Backend Agent | Frontend Agent |
|---------|----------|---------------|----------------|
| npm | npm | `nest-server-updater` | `fullstack-updater --skip-backend` |
| npm | vendor | `nest-server-updater` | `nuxt-extensions-core-updater` |
| vendor | npm | `nest-server-core-updater` | `fullstack-updater --skip-backend` |
| vendor | vendor | `nest-server-core-updater` | `nuxt-extensions-core-updater` |

**Skip-Flags:**

```bash
/lt-dev:fullstack:update-all --dry-run        # Nur Plan
/lt-dev:fullstack:update-all --skip-backend   # Nur Frontend
/lt-dev:fullstack:update-all --skip-frontend  # Nur Backend
/lt-dev:fullstack:update-all --skip-packages  # Nur Framework, keine Package-Maintenance
```

**Einzelne Updates** (wenn du nur einen Teil brauchst):

```bash
# Backend npm-Mode
/lt-dev:backend:update-nest-server

# Backend vendor-Mode
/lt-dev:backend:update-nest-server-core

# Frontend vendor-Mode
/lt-dev:frontend:update-nuxt-extensions-core

# Nur Packages optimieren
/lt-dev:maintenance:maintain
```

---

### 7. Upstream-Contribution

Wenn du im vendored core **generell nützliche** Änderungen gemacht hast (Bugfixes, Features), können diese als Pull-Request an das Upstream-Repo beigetragen werden.

```
┌────────────────────────────────────────────────────────────┐
│  BACKEND: /lt-dev:backend:contribute-nest-server-core      │
│  FRONTEND: /lt-dev:frontend:contribute-nuxt-extensions-core│
│                                                            │
│  Phase 1: git log seit VENDOR.md baseline                  │
│  Phase 2: Filter cosmetic commits (format, lint)           │
│  Phase 3: Categorize:                                      │
│    - upstream-candidate: generic bugfix, framework         │
│      enhancement, type correction                          │
│    - project-specific: business rules, branding            │
│  Phase 4: Clone upstream fresh + cherry-pick candidates    │
│  Phase 5: Generate PR draft with motivation                │
│  Phase 6: Present summary for human review                 │
│                                                            │
│  Human: reviews + pushes PR via normal GitHub flow         │
└────────────────────────────────────────────────────────────┘
```

Nach Merge des PR wird beim nächsten `/lt-dev:backend:update-nest-server-core` bzw. `/lt-dev:frontend:update-nuxt-extensions-core` der Patch als "upstream-delivered" erkannt und aus dem VENDOR.md Local-Changes-Log entfernt.

---

## Entscheidungsmatrix

### Wann npm-Mode?

- ✅ Standard-Projekt ohne lokale Framework-Anpassungen
- ✅ Schnelle Updates via `pnpm update`
- ✅ Weniger komplexe CI/CD
- ✅ Weniger Speicher-Footprint im Repo

### Wann Vendor-Mode?

- ✅ Claude Code soll den Framework-Code **verstehen** (besseres Kontextverständnis)
- ✅ Lokale Patches am Framework sind erforderlich
- ✅ Upstream-Beiträge sollen aus echter Entwicklung entstehen
- ✅ Debugging in Framework-Code mit Source-Maps / Originalcode
- ✅ Framework-Änderungen sofort testbar ohne npm-Release-Cycle
- ⚠️ Erfordert gelegentliche Merge-Konflikte beim Sync
- ⚠️ Längere Test-Import-Phase (TypeScript source)

---

## Glossar

| Begriff | Bedeutung |
|---------|-----------|
| **npm-Mode** | Framework als `@lenne.tech/nest-server` / `@lenne.tech/nuxt-extensions` npm-Dependency |
| **Vendor-Mode** | Framework-Source kopiert in `src/core/` (Backend) bzw. `app/core/` (Frontend) |
| **VENDOR.md** | Marker-Datei im vendored core mit Baseline-Version, Sync-Historie, Local-Patches |
| **Flatten-Fix** | Import-Path-Rewrites in 4 Backend-Dateien nach dem Kopieren (nur Backend) |
| **Consumer-Import-Codemod** | Rewrite von `@lenne.tech/nest-server` zu relativen Pfaden in Projekt-Code |
| **Upstream-Sync** | Pull von Upstream-Änderungen ins vendored core |
| **Upstream-Contribution** | Push von lokalen Patches als PR zum Upstream-Repo |
| **Mode-aware** | Code der automatisch korrekte Pfade für npm oder vendor wählt |
| **Starter** | `nest-server-starter` / `nuxt-base-starter` — Template-Repo mit Standard-Config |

---

## Quellen & Referenzen

### GitHub-Repos

| Repo | URL |
|------|-----|
| lt CLI | https://github.com/lenneTech/cli |
| lt-dev Plugin | https://github.com/lenneTech/claude-code |
| nest-server Framework | https://github.com/lenneTech/nest-server |
| nest-server Starter | https://github.com/lenneTech/nest-server-starter |
| nuxt-extensions Module | https://github.com/lenneTech/nuxt-extensions |
| nuxt-base Starter | https://github.com/lenneTech/nuxt-base-starter |
| lt-monorepo Template | https://github.com/lenneTech/lt-monorepo |

### Lokale Dokumentation

- `cli/CLAUDE.md` — CLI-interne Dokumentation + Vendor-Touchpoints-Tabelle
- `cli/docs/commands.md` — CLI Command-Reference
- `cli/docs/lt.config.md` — CLI Config-Reference
- `cli/scripts/test-vendor-init.sh` — Backend-Vendor-Integration-Tests (4 Szenarien × ~22 Assertions)
- `cli/scripts/test-frontend-vendor-init.sh` — Frontend-Vendor-Integration-Tests (4 Szenarien)
- `framework-vendoring-pilot-plan.md` — Original Vendor-Mode Blueprint

---

## Schnellreferenz — Die wichtigsten Commands

```bash
# ═══════════════════════════════════════════════════════════════
# PROJEKT-SETUP
# ═══════════════════════════════════════════════════════════════

# Neues Projekt (beide im vendor mode)
lt fullstack init --name <n> --frontend nuxt --api-mode Rest \
  --framework-mode vendor --frontend-framework-mode vendor --noConfirm

# Neues Projekt (npm mode, Standard)
lt fullstack init --name <n> --frontend nuxt --api-mode Rest --noConfirm

# Status checken (zeigt beide Modi im Monorepo-Root)
lt status

# ═══════════════════════════════════════════════════════════════
# KONVERTIERUNG — Fullstack (beide Subprojekte in einem Schritt)
# ═══════════════════════════════════════════════════════════════

# Beide Subprojekte: npm → vendor (vom Monorepo-Root)
lt fullstack convert-mode --to vendor --noConfirm

# Beide Subprojekte: vendor → npm (Rückführung)
lt fullstack convert-mode --to npm --noConfirm

# Mit spezifischen Upstream-Versionen
lt fullstack convert-mode --to vendor \
  --framework-upstream-branch 11.24.3 \
  --frontend-framework-upstream-branch 1.5.3 \
  --noConfirm

# Nur Backend bzw. nur Frontend
lt fullstack convert-mode --to vendor --skip-frontend --noConfirm
lt fullstack convert-mode --to vendor --skip-backend --noConfirm

# Dry-run (Plan ohne Änderungen)
lt fullstack convert-mode --to vendor --dry-run

# ═══════════════════════════════════════════════════════════════
# KONVERTIERUNG — Einzeln (in den jeweiligen Subprojekten)
# ═══════════════════════════════════════════════════════════════

# Backend: npm → vendor (mit Migrations via Claude Code)
/lt-dev:backend:convert-to-vendor

# Backend: npm → vendor (direkt via CLI)
cd projects/api && lt server convert-mode --to vendor

# Frontend: npm → vendor (mit Changelog via Claude Code)
/lt-dev:frontend:convert-to-vendor

# Frontend: npm → vendor (direkt via CLI)
cd projects/app && lt frontend convert-mode --to vendor

# Rückführung einzeln
cd projects/api && lt server convert-mode --to npm
cd projects/app && lt frontend convert-mode --to npm

# ═══════════════════════════════════════════════════════════════
# UPDATES
# ═══════════════════════════════════════════════════════════════

# Comprehensive Fullstack Update (empfohlen, mode-aware)
/lt-dev:fullstack:update-all

# Nur Backend
/lt-dev:backend:update-nest-server        # npm mode
/lt-dev:backend:update-nest-server-core   # vendor mode

# Nur Frontend
/lt-dev:frontend:update-nuxt-extensions-core  # vendor mode

# Nur Packages
/lt-dev:maintenance:maintain

# ═══════════════════════════════════════════════════════════════
# UPSTREAM CONTRIBUTION
# ═══════════════════════════════════════════════════════════════

# Backend: Lokale Patches als PR vorbereiten
/lt-dev:backend:contribute-nest-server-core

# Frontend: Lokale Patches als PR vorbereiten
/lt-dev:frontend:contribute-nuxt-extensions-core
```

---

*Diese Datei ist als lebende Dokumentation gedacht. Bei neuen Funktionen im lt-CLI oder lt-dev Plugin sollte sie aktualisiert werden.*
