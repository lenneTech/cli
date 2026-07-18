---
name: project-nuxt-base-starter
description: Maintenance facts for ~/code/lenneTech/nuxt-base-starter (two-package layout, unhead-v2 pins, @nuxt/ui override tracks app version, pin-contract test, release-age gate practice)
metadata:
  type: project
---

# nuxt-base-starter maintenance facts (as of 2026-07-18)

- Layout: repo root = `create-nuxt-base` scaffolder (deps: cross-spawn + fs-extra in `index.js`; devDeps: oxfmt + standard-version — all used, nothing removable). The real app lives in `nuxt-base-template/` with OWN package.json + pnpm-lock.yaml + settings-only pnpm-workspace.yaml (overrides live THERE, root workspace.yaml has deliberately zero overrides).
- Validation: root `pnpm run check` = frozen install + audit + format:check + `cd nuxt-base-template && pnpm run check`; template check = `scripts/check.mjs` orchestrator (audit gate, format, lint, 68 unit tests, build, server-start). Baseline 68 tests / 5 files.
- **unhead-v2 pins (`nuxt-seo-utils: 8.1.8` + `unhead: 2.1.15`) must stay while nuxt is built against unhead v2** (nuxt 4.4.8 deps `@unhead/vue ^2.1.15`). Removal condition: nuxt moves to unhead v3. Verification after any unhead-near change: `pnpm why unhead | grep -c "^unhead@"` == 1 AND `.output/server/node_modules/unhead/dist/server.mjs` exists after build (missing file = 500 on every SSR request of the BUILT app; dev mode hides it).
  **How to apply:** treat @nuxtjs/seo, nuxt-seo-utils, nuxt, @nuxt/ui bumps as unhead-near; run both checks each time.
- **`'@nuxt/ui@<4.7.2'` override target must track the app's own @nuxt/ui version** (dedupe onto ONE @nuxt/ui; selector exists because @lenne.tech/bug.lt hard-pins @nuxt/ui@4.2.1, GHSA-gj2h-2fpw-fhv9). When bumping @nuxt/ui in package.json, bump the override target in the same run (done 4.9.0→4.10.0 on 2026-07-18).
- Framework-required deps WITHOUT direct imports (do NOT remove): `better-auth`, `@better-auth/passkey`, `tus-js-client` are peerDependencies of `@lenne.tech/nuxt-extensions` (verified in its manifest); `@iconify-json/lucide` is used via `i-lucide-*` icon names (app.config.ts etc.); `lint-staged`/`simple-git-hooks` via hooks; `rimraf` via npx in scripts.
- **pnpm pin contract:** `tests/unit/pnpm-pin-contract.test.ts` enforces `pnpm@X.Y.Z+sha512.<hex>` format in EVERY reachable manifest that has a packageManager field (standalone: root AND template) + `engines.pnpm` gating the major + Dockerfile/CI deriving from package.json. Bump BOTH manifests together; hash method = shasum -a 512 of npm tarball (same as [[project-nuxt-extensions]]; 11.14.0 hash cross-checked byte-identical with nuxt-extensions' pin).
- **Release-age gate practice:** template policy comment says wait out the ~24h gate for third-party packages instead of adding `minimumReleaseAgeExclude` entries. Applied 2026-07-18: skipped `@iconify-json/lucide@1.2.118` (3h old). Only `@lenne.tech/*` glob is excluded.
- **BLOCKED: typescript 6.0.3 → 7.x** — same architectural blocker as [[project-nuxt-extensions]] (native Go compiler; Volar/vue-tsc + openapi-ts need the TS-JS compiler API). Do not attempt in this Nuxt template until the Vue toolchain supports it.
- Overrides `minimatch@>=9.0.0 <9.0.7: 9.0.9` and `esbuild@<0.28.1: 0.28.1`: liveness criterion documented in workspace.yaml = selector's package resolves in lockfile (both do). True load-bearing test = resolve with zero overrides (expensive) — last verified by upstream comment; re-verify only during a major maintenance, not routinely.
