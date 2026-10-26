---
name: convert-esm-trust-boundary
description: lt server convert-esm runs project code by design (build, built server, nodemon exec via sh -c, node -e import of every package specifier) — all inside the project's own trust boundary; do not re-flag
metadata:
  type: reference
---

Reviewed 2026-10-26 (`src/lib/esm-verify.ts`, `src/lib/esm-cjs-named-imports.ts`, `src/lib/esm-convert.ts`).

- `startAndProbe(apiDir, '/bin/sh', ['-c', 'exec ' + nodemon.exec])`: `exec` is the project's own
  `nodemon.json`, which nodemon itself runs through a shell on every `pnpm start`. The step right
  before it runs the project's `build` script. No lt.config or flag value reaches the string.
- `importWithNode`: the `-e` script is a constant; specifiers travel as JSON in `LT_ESM_SPECIFIERS`
  and are only `import()`ed. Measured: a `data:text/javascript,…` specifier in project source DOES
  execute there (also under `--skip-verify`), but that is project-supplied code in the project the
  user asked to convert; installed packages run at the same step anyway. Same boundary as build.
- Only `lt server convert-esm` sets `checkNamedImports: true`; the vendor conversion
  (`convertCloneToVendored` → `isEsmProject`) passes `analyze: false`, so `lt fullstack init` /
  `convert-mode` run no project code through it.
- Writes use plain `writeFileSync` and `collectFiles` follows symlinked dirs (statSync) — a
  malicious repo could aim rewrites outside itself, but the same command executes its code, so no
  escalation. Re-check if convert-esm ever becomes non-interactive from `lt fullstack update`.

Pin → clone ref (`vendor-upstream-ref.ts`): `semver.valid` gate (accepts `v1.2.3` and padded
whitespace, rejects `;`/`=`), then argv via `execArgs`; a bad ref only triggers the default-branch
fallback. Safe.

Related: [[cli-repo-review-scope]], [[spawndetached-sh-exec-safe]], [[heal-overwrite-family]]
