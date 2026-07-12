---
name: cli-repo-review-scope
description: What "security" means when reviewing THIS repo (@lenne.tech/cli) — the CLI itself, not a NestJS/Nuxt app
metadata:
  type: project
---

Security reviews in this repo (`@lenne.tech/cli`) target the CLI itself — a Gluegun/TypeScript tool — NOT a running NestJS/Nuxt app.

**Why:** There is no server, browser, DB, `@Restricted`/CrudService/Better-Auth, or Vue/SSR in this codebase. The framework permission-model / resolver-injection / v-html checks in the reviewer prompt are N/A here.

**How to apply:** Focus the audit on two surfaces:
1. The CLI's own Node/TS code — command injection via `system.run`/`exec` (shell-string interpolation of paths/args), path traversal, unsafe JSON, ReDoS, secret handling.
2. The security of code/config the CLI GENERATES into user projects — the generated root `.dockerignore` (`src/lib/ensure-root-dockerignore.ts`), `.turboops.json`, migration bootstrap scripts (`src/extensions/server.ts`, `src/templates/vendor-scripts/`), and Angular `environment.*.ts` URL patching (`src/lib/angular-environments.ts`).

Trust boundaries that matter for a CLI: committed `lt.config.json`/`.yaml` values (`defaults.*`, `commands.*`) and CLI args are an input a victim can be tricked into running against a cloned repo — validate before writing them into generated source/config. See [[cli-generated-file-injection]].
