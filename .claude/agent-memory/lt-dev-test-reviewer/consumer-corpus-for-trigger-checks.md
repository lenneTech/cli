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
