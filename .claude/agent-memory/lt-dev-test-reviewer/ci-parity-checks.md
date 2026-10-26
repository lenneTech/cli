---
name: ci-parity-checks
description: How to reproduce the lt CLI's CI conditions locally (Node 20 binary path, npm 10 lockfile check, Windows job status) and check a vendor template against the real upstream loader
metadata:
  type: reference
---

CI (`.github/workflows/build.yml`) runs Linux AND Windows on **Node 20 / npm 10**; the Windows
job is `continue-on-error: true` (non-blocking) as of 2026-10-25. The dev machine runs Node 24,
so a dependency major bump (e.g. js-yaml 4 → 5) can pass locally and break CI.

**Node 20 runs:** a `PATH=…:$PATH` prefix does NOT work here, because the shell profile puts fnm
shims first again. Call the binary by absolute path:
`$HOME/.local/share/fnm/node-versions/v20.20.2/installation/bin/node node_modules/jest/bin/jest.js <files> --runInBand`
(child processes spawned via `process.execPath` then also run on 20).

**Lockfile sync the way CI's `npm ci` judges it:** copy only `package.json` + `package-lock.json`
into a scratchpad dir and run npm 10's `npm ci --dry-run --ignore-scripts` with the Node 20 binary
(`<bin>/node <bin>/npm ci …`). It validates sync and installs nothing.

**Vendor templates vs the real framework file:** a test's fake of an upstream file (e.g. the
nest-server 12 SWC loader that `templates/vendor-scripts/ts-compiler.js` delegates to) only proves
the author's assumption. Copy the real file from `~/code/lenneTech/nest-server/src/core/...` into a
scratchpad project, symlink `node_modules` to nest-server's own (it has `@swc/core`) or to the
starter's (TS 5.9 + ts-node), and run the template there. See [[proving-regression-tests-safely]].
