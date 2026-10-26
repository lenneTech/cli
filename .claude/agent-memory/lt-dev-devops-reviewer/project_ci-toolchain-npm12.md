---
name: ci-toolchain-npm12
description: CLI publish.yml runs on npm@latest (12.x since 2026-07), which blocks dependency install scripts by default; how CI-lockfile/audit claims were verified without touching the repo
metadata:
  type: project
---

publish.yml upgrades to `npm@latest` on Node 24, so npm majors arrive without a diff. On 2026-10-26 that was npm 12.2.1 (engines `^22.22.2 || ^24.15.0 || >=26`; setup-node `24` resolved 24.22.1). npm 12 blocks dependency install scripts unless `allowScripts` covers them: bcrypt, @parcel/watcher and unrs-resolver were skipped, but bcrypt still loads (prebuilds), lint, compile and the CLI start check pass. build.yml stays on Node 20 = npm 10.8.2.

**Why:** a future review may attribute an install-script or engines failure to a repo change when the cause is a new npm major pulled in by `npm@latest`.

**How to apply:** when reviewing CI/lockfile changes here, verify in a scratch copy, never in the checkout. `npm ci --dry-run --ignore-scripts` with only package.json + lockfile checks lockfile sync, and a negative control (an extra dep) shows `EUSAGE … Missing: … from lock file`. Run it under both npm 10.8.2 (fnm Node 20) and `npx npm@latest`. For Linux parity, Docker `node:20-bookworm-slim` / `node:24-bookworm-slim` works against an rsync'd copy. Related: [[ci-runs-check-pipeline]]
