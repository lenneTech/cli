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
- `src/lib/dev-patches.ts#patchPlaywrightConfig` — injects an executable "bridge block" of TS between `// >>> lt-dev:bridge >>>` / `// <<< lt-dev:bridge <<<` markers into the consumer's `playwright.config.ts`. The block is a CONSTANT (no interpolation), so there is no injection sink; the risk is in the **staleness comparison** that decides whether to rewrite an existing block.

**Newline collapse in a normalise-before-compare erases the `//` comment boundary.** A comparator like `s.replace(/['"]/g,'"').replace(/\s+/g,' ').trim()` maps a block whose lines were MERGED onto the same normalised string as the multi-line original — but merged lines are swallowed by the preceding `//` comment, so the injected loader is entirely inert while reading as "up to date". Verified: flattening the whole block, and merging just the last comment line with the first `import`, both survive the patch (`patched: false`, file untouched); pre-change byte-comparison repaired both. No code-injection primitive exists (the attacker's only degrees of freedom are quote-flips and whitespace redistribution — they cannot add tokens), so the impact caps at neutralising the block + losing the CLI's tamper-reversion.
**Rule for any marker-bracketed block comparator: preserve the newline structure.** Normalise per line (`split(/\r?\n/).map(trim).filter(Boolean).join('\n')` then quote-flip + `[^\S\n]+` collapse) — tolerates re-indent/quote-style/CRLF/blank lines, detects merges. Also keep every generated line ≤80 chars (today L7=83, L8=81 in the bridge block) so no consumer formatter has a reason to re-wrap and cause a false positive.
Secondary, pre-existing: `indexOf` finds the FIRST start and FIRST end marker independently, so an end-before-start ordering makes `slice(startIdx, endIdx+len)` return `''` and the rewrite DUPLICATES the text between them. Unchanged by the semantic-compare work.

Confirmed non-issues at time of review: no `child_process`/`exec`/`spawn`/`eval` in deployment/angular/dockerignore code; `mongo-uri.js` ships in nest-server-starter (not generated) and does not log the URI; `migrate-store.js` (`src/templates/vendor-scripts/`) requires local files only, no shell.
