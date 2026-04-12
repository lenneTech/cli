# Vendor-Mode Workflow — Step-by-Step

Praktische Anleitung für die Überführung eines lenne.tech Fullstack-Projekts vom **npm-Mode** in den **Vendor-Mode**, das Update und die optionale Rückführung.

**Kurz:** Im Vendor-Mode wird der Framework-Code (`@lenne.tech/nest-server`, `@lenne.tech/nuxt-extensions`) direkt ins Projekt kopiert (`src/core/` bzw. `app/core/`), statt via npm installiert.

> **Ausführliche Referenz**: Alle Commands und Hintergründe findest du im [LT-ECOSYSTEM-GUIDE](./LT-ECOSYSTEM-GUIDE.md).

---

## Inhaltsverzeichnis

- [Voraussetzungen](#voraussetzungen)
- [Teil 1: npm → Vendor überführen](#teil-1-npm--vendor-überführen)
- [Teil 2: Vendor-Mode updaten](#teil-2-vendor-mode-updaten)
- [Teil 3: Vendor → npm zurückführen](#teil-3-vendor--npm-zurückführen)
- [Troubleshooting](#troubleshooting)

---

## Voraussetzungen

Bevor du startest, stelle sicher:

| Check | Command |
|-------|---------|
| lt CLI installiert | `lt --version` |
| Claude Code mit lt-dev Plugin | `/lt-dev:plugin:check` |
| Projekt ist ein Fullstack-Monorepo | Verzeichnisse `projects/api/` und `projects/app/` existieren |
| Arbeitsverzeichnis ist clean | `git status` zeigt keine uncommitted changes |
| Du bist auf einem Feature-Branch | `git checkout -b feature/vendor-mode` |

---

## Teil 1: npm → Vendor überführen

### Schritt 1: Status prüfen

**Command:**
```bash
lt status
```

**Was passiert:** Zeigt den aktuellen Framework-Modus für Backend und Frontend. Du erwartest jetzt `npm (@lenne.tech/nest-server dependency)` und `npm (@lenne.tech/nuxt-extensions dependency)`.

---

### Schritt 2: Dry-Run — Plan anzeigen

**Command (vom Monorepo-Root):**
```bash
lt fullstack convert-mode --to vendor --dry-run
```

**Was passiert:** Die CLI scannt `projects/api/` und `projects/app/`, erkennt die aktuellen Modi, und zeigt **was passieren würde**, ohne irgendetwas zu ändern. Prüfe die Ausgabe:
- Beide Subprojekte als `npm → vendor`
- Upstream-Versionen werden auto-detected aus den jeweiligen `package.json`

---

### Schritt 3: Konvertierung ausführen

**Command:**
```bash
lt fullstack convert-mode --to vendor --noConfirm
```

**Was passiert:**
1. **Backend**: klont `@lenne.tech/nest-server` in `/tmp/`, kopiert `src/core/` + `src/index.ts` + `src/core.module.ts` + `src/test/` + `src/templates/` + `src/types/` + `LICENSE` nach `projects/api/src/core/`, wendet Flatten-Fix an (4 edge-case Dateien), schreibt alle Consumer-Imports von `@lenne.tech/nest-server` auf relative Pfade um, merged die upstream Dependencies dynamisch in `package.json`, konvertiert `express` Value-Imports zu Type-Imports (vendor-Kompatibilität), erzeugt `src/core/VENDOR.md`, prepended ein Vendor-Notice-Block in `CLAUDE.md`
2. **Frontend**: klont `@lenne.tech/nuxt-extensions` in `/tmp/`, kopiert `src/module.ts` + `src/runtime/` nach `projects/app/app/core/`, ersetzt `'@lenne.tech/nuxt-extensions'` in `nuxt.config.ts` durch `'./app/core/module'`, schreibt die 4 expliziten Consumer-Imports um, entfernt den npm-Dependency, erzeugt `app/core/VENDOR.md`

Die Temp-Verzeichnisse in `/tmp/` werden automatisch bereinigt.

---

### Schritt 4: Abhängigkeiten neu installieren

**Command (vom Monorepo-Root):**
```bash
pnpm install
```

**Was passiert:** pnpm installiert die neu-gemergten Dependencies (die upstream vom Framework stammten) und entfernt `@lenne.tech/nest-server` bzw. `@lenne.tech/nuxt-extensions` aus `node_modules/`.

---

### Schritt 5: Backend validieren

**Commands:**
```bash
cd projects/api
pnpm exec tsc --noEmit
pnpm run lint
pnpm test
cd ..
```

**Was passiert:**
- `tsc --noEmit`: TypeScript-Check über den gesamten Backend-Code inkl. vendored `src/core/`. Erwartung: keine Fehler.
- `pnpm run lint`: oxlint über src/ + tests/. Erwartung: 0 errors.
- `pnpm test`: vitest e2e-Suite. Erwartung: alle Tests grün (initial können ~10 Min dauern wegen TypeScript-Transform der vendored Core).

---

### Schritt 6: Frontend validieren

**Commands:**
```bash
cd projects/app
pnpm run lint
pnpm run build
cd ..
```

**Was passiert:**
- `lint`: oxlint über app/. Erwartung: 0 errors.
- `build`: nuxt-Build durchläuft prepare → build → nitro output. Erwartung: `✨ Build complete!`

---

### Schritt 7: Status erneut prüfen

**Command:**
```bash
lt status
```

**Erwartete Ausgabe:**
```
Monorepo Subprojects:
  Backend:  projects/api → vendor (src/core/, VENDOR.md)
  Frontend: projects/app → vendor (app/core/, VENDOR.md)
```

---

### Schritt 8: Änderungen committen

**Commands:**
```bash
git add -A
git commit -m "chore: convert fullstack to vendor mode

- Backend: @lenne.tech/nest-server vendored into src/core/
- Frontend: @lenne.tech/nuxt-extensions vendored into app/core/
- Both VENDOR.md files track baseline + sync history"
```

**Was passiert:** Der Commit enthält typischerweise ~500 neue Dateien (vendored core) und modifizierte Consumer-Imports.

---

## Teil 2: Vendor-Mode updaten

Nach der Überführung musst du dein Projekt weiterhin mit Upstream-Änderungen synchron halten. Im Vendor-Mode geschieht das **kuratiert** über Claude-Code-Agents.

### Workflow A: Umfassendes Update (empfohlen)

**Command (in Claude Code):**
```
/lt-dev:fullstack:update-all
```

**Was passiert:**
1. **Phase 1**: Erkennt Modi beider Subprojekte (vendor in diesem Fall)
2. **Phase 2**: Generiert `UPDATE_PLAN.md` mit Version-Gaps und erwartet deine Zustimmung
3. **Phase 3**: Backend-Sync via `nest-server-core-updater` Agent (clone upstream, diff, human-review, apply, flatten-fix reapply)
4. **Phase 4**: Frontend-Sync via `nuxt-extensions-core-updater` Agent (clone upstream, diff, human-review, apply)
5. **Phase 5**: Package-Maintenance via `npm-package-maintainer` (FULL MODE)
6. **Phase 6**: `CLAUDE.md`-Sync aus den Upstream-Startern
7. **Phase 7**: Cross-Validation (Build, Lint, Tests für beide Subprojekte)
8. **Phase 8**: Final Report

---

### Workflow B: Nur Backend updaten

**Command:**
```
/lt-dev:backend:update-nest-server-core
```

**Was passiert:** Wie Phase 3 von Workflow A — synct `src/core/` mit Upstream-Änderungen.

---

### Workflow C: Nur Frontend updaten

**Command:**
```
/lt-dev:frontend:update-nuxt-extensions-core
```

**Was passiert:** Wie Phase 4 von Workflow A — synct `app/core/` mit Upstream-Änderungen.

---

### Workflow D: Sync auf spezifische Version

**Command:**
```
/lt-dev:backend:update-nest-server-core --target 11.25.0
```

**Was passiert:** Statt auf HEAD zu synchen, wird eine spezifische Upstream-Version gezogen. Gut für stabile Major/Minor-Releases.

---

### Freshness-Check

**Command (in beiden Subprojekten verfügbar):**
```bash
cd projects/api  # oder projects/app
pnpm run check:vendor-freshness
```

**Was passiert:** Liest Baseline-Version aus `VENDOR.md` und vergleicht mit der aktuellen Version auf npm. Non-blocking Warning wenn eine neuere Version existiert. Wird automatisch von `pnpm run check` ausgeführt.

---

### Nach dem Update: Validation

**Command (vom Monorepo-Root):**
```bash
pnpm run check
```

**Was passiert:** Führt pro Subprojekt audit + format:check + lint + tests + build + server-start aus. Muss grün durchlaufen, bevor du den Update-Commit machst.

---

### Upstream-Contribution (optional)

Wenn du lokale Patches im vendored core gemacht hast, die **generell nützlich** sind (Bugfix, neue Feature, Type-Korrektur), kannst du sie als Upstream-PR vorbereiten:

**Backend-Patches:**
```
/lt-dev:backend:contribute-nest-server-core
```

**Frontend-Patches:**
```
/lt-dev:frontend:contribute-nuxt-extensions-core
```

**Was passiert:** Der Agent durchsucht `git log` seit der VENDOR.md-Baseline, filtert kosmetische Commits raus, kategorisiert substantielle Commits als `upstream-candidate` oder `project-specific`, cherry-picked die Kandidaten auf einen frischen Upstream-Branch, generiert einen PR-Body-Entwurf und zeigt dir die Summary. **Push erfolgt manuell von dir nach Review.**

---

## Teil 3: Vendor → npm zurückführen

Falls der Vendor-Mode für dein Projekt nicht funktioniert oder du wieder zur npm-Dependency zurück willst.

### Schritt 1: Lokale Patches prüfen

**Command:**
```bash
cat projects/api/src/core/VENDOR.md | grep -A 20 "## Local changes"
cat projects/app/app/core/VENDOR.md | grep -A 20 "## Local changes"
```

**Was passiert:** Zeigt die Local-Changes-Tabelle aus beiden `VENDOR.md`-Dateien. **Wenn dort substantielle Patches gelistet sind, gehen diese bei der Rückführung verloren!**

---

### Schritt 2: Patches upstream beitragen (falls vorhanden)

**Empfehlung**: Bevor du zurückführst, beitrage die lokalen Patches:

```
/lt-dev:backend:contribute-nest-server-core
/lt-dev:frontend:contribute-nuxt-extensions-core
```

**Was passiert:** Siehe "Upstream-Contribution" oben. Nach Merge der Upstream-PRs kann die Rückführung ohne Datenverlust erfolgen.

---

### Schritt 3: Dry-Run — Plan anzeigen

**Command (vom Monorepo-Root):**
```bash
lt fullstack convert-mode --to npm --dry-run
```

**Was passiert:** Zeigt `vendor → npm` für beide Subprojekte. Die zu installierenden Versionen werden aus den `VENDOR.md`-Baselines gelesen.

---

### Schritt 4: Rückführung ausführen

**Command:**
```bash
lt fullstack convert-mode --to npm --noConfirm
```

**Was passiert:**
1. **Backend**:
   - Liest Baseline-Version aus `src/core/VENDOR.md`
   - Warnt bei lokalen Patches in der "Local changes"-Tabelle
   - Schreibt alle Consumer-Imports von relativen Pfaden zurück auf `@lenne.tech/nest-server`
   - Löscht `src/core/`
   - Stellt `@lenne.tech/nest-server` in `package.json` wieder her (mit Baseline-Version)
   - Stellt `migrate:*` Scripts auf `node_modules/.bin/` zurück
   - Entfernt Vendor-Artefakte: `bin/migrate.js`, `migrations-utils/ts-compiler.js`, `migration-guides/`
   - Entfernt Vendor-Marker aus `CLAUDE.md`
2. **Frontend**:
   - Liest Baseline-Version aus `app/core/VENDOR.md`
   - Schreibt die 4 expliziten Consumer-Imports zurück auf `@lenne.tech/nuxt-extensions`
   - Löscht `app/core/`
   - Stellt `@lenne.tech/nuxt-extensions` in `package.json` wieder her
   - Schreibt `nuxt.config.ts` zurück: `'./app/core/module'` → `'@lenne.tech/nuxt-extensions'`
   - Entfernt `check:vendor-freshness` Script
   - Entfernt Vendor-Marker aus `CLAUDE.md`

---

### Schritt 5: Abhängigkeiten neu installieren

**Command:**
```bash
pnpm install
```

**Was passiert:** pnpm installiert `@lenne.tech/nest-server` und `@lenne.tech/nuxt-extensions` frisch aus dem npm-Registry.

---

### Schritt 6: Validieren

**Commands:**
```bash
cd projects/api && pnpm exec tsc --noEmit && pnpm run lint && pnpm test && cd ..
cd projects/app && pnpm run lint && pnpm run build && cd ..
```

**Was passiert:** Stellt sicher, dass alles nach der Rückführung immer noch funktioniert. `tsc` im Backend prüft ob die `@lenne.tech/nest-server` Types aus `node_modules/` jetzt gefunden werden. Frontend-Build prüft, dass Nuxt das Modul als npm-Dep lädt.

---

### Schritt 7: Status erneut prüfen

**Command:**
```bash
lt status
```

**Erwartete Ausgabe:**
```
Monorepo Subprojects:
  Backend:  projects/api → npm (@lenne.tech/nest-server dependency)
  Frontend: projects/app → npm (@lenne.tech/nuxt-extensions dependency)
```

---

### Schritt 8: Änderungen committen

**Commands:**
```bash
git add -A
git commit -m "chore: revert fullstack to npm mode

- Backend: back to @lenne.tech/nest-server X.Y.Z npm dependency
- Frontend: back to @lenne.tech/nuxt-extensions A.B.C npm dependency
- Vendored cores (src/core/, app/core/) removed"
```

---

## Troubleshooting

### Problem: `tsc` failed mit `new Error('msg', { cause })` Fehler

**Ursache:** TypeScript-Target ist zu alt (ES2020 oder niedriger).

**Fix:** In `projects/api/tsconfig.json` das Target auf `"es2022"` setzen:
```json
{
  "compilerOptions": {
    "target": "es2022"
  }
}
```

---

### Problem: Vitest-Fehler `'express' does not provide an export named 'Response'`

**Ursache:** Im Vendor-Mode wird die TypeScript-Source der Core direkt von Vitest evaluiert. Value-Imports von TypeScript-type-only Exports brechen.

**Fix:** Sollte automatisch vom CLI gefixed worden sein. Falls nicht, in allen betroffenen Dateien:
```typescript
// Vorher
import { Request, Response } from 'express';

// Nachher
import type { Request, Response } from 'express';
```

---

### Problem: Konvertierung scheitert mit "Destination path already exists"

**Ursache:** Das Projekt hat bereits projektspezifische `bin/` oder `migration-guides/` Verzeichnisse, die mit Upstream-Inhalten kollidieren.

**Fix:** Inhalte sichern, Verzeichnisse löschen, Konvertierung erneut ausführen, Inhalte zurückkopieren.

```bash
cp projects/api/bin/migrate.js /tmp/migrate-backup.js
cp -r projects/api/migration-guides /tmp/migration-guides-backup
rm -rf projects/api/bin projects/api/migration-guides
lt fullstack convert-mode --to vendor --noConfirm
# Nach Konvertierung:
mv /tmp/migration-guides-backup/MY-FILE.md projects/api/migration-guides/
```

---

### Problem: Nach Konvertierung fehlen einige Consumer-Imports in der Rewrite

**Symptom:** `lt fullstack convert-mode` zeigt Warning wie `X file(s) still contain '@lenne.tech/nest-server' imports`.

**Fix:** Die gemeldeten Dateien manuell prüfen und Imports auf relative Pfade umschreiben. Die Warning zeigt die genauen Pfade an.

---

### Problem: Tests schlagen unter paralleler Last fehl (Flakiness)

**Ursache:** TypeScript-Source-Loading im Vendor-Mode ist langsamer als pre-compiled `dist/` — das deckt bestehende Timing-abhängige Test-Races auf.

**Fix-Optionen:**
- Einzelne flaky Tests robust machen (Retry-Pattern, Polling statt `setTimeout`)
- Als Workaround `retry: 3` in `vitest-e2e.config.ts` ist bereits aktiv
- Letzte Option: `poolOptions.forks.singleFork: true` (macht tests sequenziell — ~4× langsamer)

---

### Problem: Upstream-Sync findet Konflikte

**Symptom:** `/lt-dev:backend:update-nest-server-core` zeigt Konflikte zwischen Upstream-Änderung und lokalem Patch.

**Fix:** Der Agent pausiert und präsentiert die Konflikte. Du kannst:
- `approve all` — alle Upstream-Picks übernehmen (lokale Patches überschrieben)
- `approve clean` — nur konfliktfreie Picks
- `reject <file>` — spezifische Datei skippen
- `show <file>` — Hunk anzeigen
- `done` — mit aktueller Auswahl fortfahren

---

## Schnell-Referenz

| Aktion | Command |
|--------|---------|
| Status prüfen | `lt status` |
| Dry-Run npm→vendor | `lt fullstack convert-mode --to vendor --dry-run` |
| npm→vendor | `lt fullstack convert-mode --to vendor --noConfirm` |
| Vendor-Update | `/lt-dev:fullstack:update-all` |
| Backend-only Update | `/lt-dev:backend:update-nest-server-core` |
| Frontend-only Update | `/lt-dev:frontend:update-nuxt-extensions-core` |
| Freshness-Check | `pnpm run check:vendor-freshness` |
| Full Check | `pnpm run check` |
| Upstream-PR (Backend) | `/lt-dev:backend:contribute-nest-server-core` |
| Upstream-PR (Frontend) | `/lt-dev:frontend:contribute-nuxt-extensions-core` |
| Dry-Run vendor→npm | `lt fullstack convert-mode --to npm --dry-run` |
| vendor→npm | `lt fullstack convert-mode --to npm --noConfirm` |

---

> **Weiterführend**: Architektur, Konzepte und Referenz aller CLI-/Plugin-Funktionen im [LT-ECOSYSTEM-GUIDE](./LT-ECOSYSTEM-GUIDE.md).
