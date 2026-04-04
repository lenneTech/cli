---
name: TypeScript 6 build time baseline
description: TypeScript 6 pure tsc compile is ~3s (no regression vs TS5 ~9s-script). Full build script includes lint+test which accounts for the 62s total.
type: project
---

`npm run build` runs lint + test + compile + copy-templates in sequence. As of TS 6.0.2 upgrade (2026-04-04):
- Pure `tsc` compile: ~3 seconds (fast, no regression)
- Full `npm run build`: ~62 seconds (dominated by test suite at ~65s, not tsc)
- TS5 reference: pure build script was ~9s (also included lint, but test suite was faster)

**Why:** Useful for future reviews to distinguish compile-time regression from test-time growth.

**How to apply:** When reviewing TypeScript version bumps, time `tsc --noEmit` separately from `npm run build` to isolate compile cost from test cost.
