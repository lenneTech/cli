---
name: project-nuxt-extensions
description: Maintenance facts for ~/code/lenneTech/nuxt-extensions (pnpm, TS-7 blocker via @nuxt/module-builder peer, packageManager pin method)
metadata:
  type: project
---

# nuxt-extensions maintenance facts (as of 2026-07-18)

- Repo: `/Users/kaihaase/code/lenneTech/nuxt-extensions`, pnpm (`pnpm-lock.yaml`), Nuxt-4-module library. Baseline: 163 tests / 14 files, `pnpm run check` = single orchestrator (`scripts/check.mjs`) incl. audit gate.
- **BLOCKED: typescript 5.9.3 -> 7.0.2 (npm `latest`).** `typescript@7.x` is the Go-native compiler; stable 6.x exists only as 6.0.2/6.0.3. Blockers: `@nuxt/module-builder@1.0.2` (latest) has peerDep `typescript: ^5.8.3`, and `vue-tsc`/Volar patch the TS-5 JS compiler API that native TS 7 doesn't expose. Keep 5.9.3 (last 5.x) until module-builder + vue-tsc support TS 6/7.
  **How to apply:** re-check `pnpm view @nuxt/module-builder peerDependencies` on each run; unblock only when peer range allows >=6.
- `dependencies` has ONLY `@nuxt/kit: ^4.0.0` — the caret range is INTENTIONAL (library consumed by Nuxt-4 apps; do not pin exact, do not raise the floor). Peer ranges (`better-auth >=1.0.0`, `nuxt ^4.0.0`, etc.) are consumer-facing — never tighten during maintenance.
- All devDeps are peer-mirrors or toolchain and all in use (`@vitest/coverage-v8` via `test:coverage` script, `@nuxt/module-builder` via `nuxt-module-build` bin, `@types/node` implicit). Nothing to remove/recategorize.
- **packageManager pin update method (verified):** pin format is `pnpm@X.Y.Z+sha512.<hex>` where hex = `shasum -a 512` of the npm tarball (`curl -sL $(npm view pnpm@X.Y.Z dist.tarball) | shasum -a 512`). Verified: computed 11.13.1 hash matched the existing pin byte-for-byte. Local corepack auto-provisions the new version on next `pnpm` call. Test `test/package-manager-pin.test.ts` enforces pin format + `engines.pnpm ^<major>.0.0` + no duplicate pins in workflows.
- Bumped pin 11.13.1 -> 11.14.0 on 2026-07-18; pnpm-workspace.yaml is settings-only (no `packages:`, no overrides). No overrides exist in this repo.
