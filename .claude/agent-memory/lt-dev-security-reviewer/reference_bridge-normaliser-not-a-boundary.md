---
name: bridge-normaliser-not-a-boundary
description: dev-patches.ts normaliseBridgeBlock / canonicaliseBridgeSpan leniency is self-heal, not a security boundary; known blind spot is regex-literal internals; do not re-flag
metadata:
  type: reference
---

`src/lib/dev-patches.ts#normaliseBridgeBlock` decides two things: whether `lt dev up` re-injects the
`lt-dev:bridge` block in a consumer `playwright.config.ts`, and (via `canonicaliseBridgeSpan`)
whether `dev-ticket.ts#isPristineLtDevPatch` lets `lt ticket stop` auto-discard a dirty config.

Probed empirically (1.50.3+, trailing-comma + bracket-padding rules): comment-line drops, block
comments, `if (false && …)`, dropped call args, `;`→`,`, and replaced conditions all still compare
UNEQUAL (patcher repairs). The only edits that compare equal while changing behaviour are INSIDE the
regex literal `/^([A-Z][A-Z0-9_]*)=(.*)$/` (`( .*)`, `[A-Z0-9_,]`, `[ A-Z…]`). No formatter
produces those; only a deliberate edit does.

**Why not a finding:** the only actor who can edit that block is a committer to the consumer repo,
who can already run arbitrary code anywhere in `playwright.config.ts`. No privilege boundary is
crossed; the discard path only loses a normalisation-equivalent variant of the CLI-owned block
(derived span always normalises to the genuine form, everything outside markers stays byte-exact).

**How to apply:** a future change to the normaliser only needs re-probing for whether it lets a
FORMATTER-producible or comment-based edit become inert-but-equal. Script shape: inject via
`patchPlaywrightConfig`, mutate, compare `canonicaliseBridgeSpan` + re-run the patcher.

Related: [[regex-lexing-decides-destruction]], [[cli-repo-review-scope]]
