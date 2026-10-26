---
name: consumer-corpus-for-trigger-checks
description: Real generated lt projects live under ~/code/{customers,lenneTech,projekte,tests}; survey them to tell a real-world trigger from a hypothetical one before rating a finding
metadata:
  type: reference
---

The CLI patches files in consumer projects (CLAUDE.md lt-dev block, playwright.config.ts bridge,
config.env.ts, …). Whether an edge case in such a patcher is a real trigger or a hypothetical
one can be checked against the real corpus on this machine instead of guessed:

```bash
cd ~/code && find . -maxdepth 6 -name CLAUDE.md -not -path '*/node_modules/*' \
  | xargs grep -l "lt-dev:url-block:start"
```

On 2026-10-03 that found 66 files (root + `projects/api` + `projects/app` of ~25 projects).
`find -maxdepth 6` is needed — `grep -r --include` from `~/code` silently returned nothing.

**Why:** a finding's severity under the review bar depends on whether users will actually hit
it. The corpus showed every existing block holds only the generated `## Local Development (lt dev)`
section, which separated "plausible data-loss path" from "observed".

**How to apply:** read-only survey only — these are customer projects, never write to them.
Combine with the scratchpad probe technique in [[proving-regression-tests-safely]].

**Heal detectors (exact-match heals, 2026-10-25).** For a heal that only rewrites a file when it is
byte-identical to what an earlier CLI wrote, survey the real files the same way:
`find . -maxdepth 7 -path '*/migrations-utils/ts-compiler.js' -not -path '*/node_modules/*'` from
`~/code`, then compare each (skip `dist/`) against the exported legacy constant via a
`ts-node --skipProject` probe. That run found 16 vendored copies byte-identical to
`LEGACY_VENDOR_TS_COMPILER` and 4 deliberately edited ones (a `dotenv` preload, an extracted
options module), which settles "does a formatter break the exact match?" with data, not a guess.

**Vendor migration stores (2026-10-26, convert-esm review).** `find . -maxdepth 7 -path
'*/migrations-utils/migrate.js'` from `~/code` found 49 stores; 20 vendored ones contain
`require('./ts-compiler')`. Only 7 of those call `resolveMongoUri()`; 13 read the URI themselves
(`config.default.mongoose.uri`, `process.env.NSC__MONGOOSE__URI || …`), and 4 (volksbank/imo plus
its ticket worktrees, lenneTech/turbo) have NO `migrations-utils/mongo-uri.js` at all. Any code that
swaps such a store for a fixed template importing `./mongo-uri.js` breaks those projects. Check the
template's imports against this survey before rating a store-replacing change.
