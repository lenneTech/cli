---
name: cli-generated-file-injection
description: Where the CLI writes config/CLI values into generated source/config files — validate these to prevent injection
metadata:
  type: reference
---

Sinks where a user/config-supplied value is written into a generated file (audit these for injection whenever they change):

- `src/lib/angular-environments.ts#patchEnvironmentFile` — interpolates `domain` (→ origin) verbatim between quotes into `environment.*.ts` via a `.replace()` callback. An unvalidated `domain` with a quote breaks out of the string literal → arbitrary JS baked into the Angular bundle. `domain` is NOT validated in `src/commands/deployment/create.ts` (only the `project` slug is, via `PROJECT_SLUG_PATTERN`). Fix pattern: mirror the slug validation with a hostname regex + `fail()`.
- `src/commands/deployment/create.ts` — writes `.turboops.json` via `JSON.stringify` (safe: escapes) and via `template.generate` of `turboops.json.ejs` which uses `<%- JSON.stringify(props.project) %>` (raw EJS tag is safe here BECAUSE JSON.stringify already yields a valid quoted literal). `project` is slug-validated.
- `src/lib/ensure-root-dockerignore.ts` — `REQUIRED_PATTERNS`. Deliberately avoids `**/.env*` to keep `.env.example` (locked by a test). Gap: `.env.<mode>` files (`.env.production`, `.env.staging`, `.env.test`) and `.lt-dev/` logs/`.env.test` are not covered. Robust fix keeps `.env.example` via negation: `**/.env.*` + `!**/.env.example`.

Confirmed non-issues at time of review: no `child_process`/`exec`/`spawn`/`eval` in deployment/angular/dockerignore code; `mongo-uri.js` ships in nest-server-starter (not generated) and does not log the URI; `migrate-store.js` (`src/templates/vendor-scripts/`) requires local files only, no shell.
