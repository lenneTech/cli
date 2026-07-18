---
name: starter-release-convention
description: nest-server-starter versioning/update conventions (version lock-step, sync script behavior, spectaql auto-sync)
metadata:
  type: project
---

nest-server-starter release convention: the starter's `package.json` `version` field is kept in LOCK-STEP with the `@lenne.tech/nest-server` dependency version (starter 11.30.0 == nest-server 11.30.0). Both fields must be bumped together before running `pnpm run update`.

**Why:** Kai stated this as the binding convention when updating the starter to 11.30.0 (2026-07-18); historical commits ("Updated to nest-server version X") follow it.

**How to apply:**
- `pnpm run update` = `node extras/sync-packages.mjs`: reads the nest-server version from package.json, installs it, then syncs the starter's DIRECT deps to the versions nest-server declares (e.g. bumped `@nestjs/swagger` automatically). It does NOT touch transitives or overrides.
- `spectaql.yml` `info.version` is auto-synced to the package version by the check/server-start pipeline — a dirty `spectaql.yml` after `pnpm run check` is expected and belongs in the update commit.
- `pnpm run check` (`scripts/check.mjs`) parses and runs the `check:raw` chain; its single "test" step covers BOTH suites (`pnpm test` = vitest unit + e2e), so summed metrics (e.g. "120 passed / 14 files") already include e2e.
- Overrides live in `pnpm-workspace.yaml` (pnpm 11), not package.json; framework-side override removals (e.g. 11.30.0 removed ajv/picomatch/js-yaml/uuid) do NOT automatically make the starter's same-named overrides obsolete — the starter's chains (mostly via @compodoc) are independent; only touch them when audit/tree proves them dead.
