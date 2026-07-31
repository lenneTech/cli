---
name: regex-lexing-decides-destruction
description: Regex "is this code safe?" detectors that gate a file overwrite — the guard vocabulary is always narrower than the safe-code space, so the default verdict must be KEEP
metadata:
  type: reference
---

Pattern seen in `src/lib/heal-vendor-migrate-store.ts#hasUnguardedTsNodeRequire`:
a regex scan over a user's JS file decides whether to **replace that file
wholesale**. Two structural failure modes, both verified empirically:

**1. The guard vocabulary is an allowlist of two shapes** (`try {` and
`require.resolve(`), searched anywhere BEFORE the hazard. Every other
production-safe way to write the same guard reads as "unguarded" → overwrite:
`if (fs.existsSync(compiledPath))`, `if (process.env.NODE_ENV !== 'production')`,
a ternary, or a lazy `require` inside a function that is called conditionally.
The docstring promises it will "never fix a project that solved the problem its
own way" — the implementation cannot deliver that, because safe-code space is
open-ended and the detector is a closed list.

**2. Regex comment-stripping is not lexing.** `stripComments` is
`.replace(/\/\*[\s\S]*?\*\//g,'').replace(/(^|[^:])\/\/.*$/gm,'$1')`. It has no
string/template/regex-literal state, so a `/*` or a `//` inside a string LITERAL
deletes real code — including the guard the detector is looking for. Confirmed
overwrites: `const OPEN='/*'; …guard…; const CLOSE='*/';` and
`const cdn='//cdn.x'; try { require.resolve('y') } catch {}` (the `[^:]` only
protects `scheme://`, not `'//…'` or `'a//b'`). ReDoS is NOT a concern here
(lazy + linear; 20k unterminated `/*` strips in <1ms).

**Rule:** when a content heuristic gates a destructive action, the UNCERTAIN
verdict must be the non-destructive one. Either (a) match the exact known-broken
shape as a positive allowlist (overwrite only a byte-comparable known-bad file),
or (b) match the hazard but require an explicit, narrow confirmation of
brokenness, or (c) report and let the human decide. "I could not find a guard I
recognise" is not evidence that no guard exists.

Consequence is rarely just "lost customisation": in the migrate-store case the
replacement also swapped the migration **collection name** and the Mongo **URI
source**, which makes the migration ledger read as EMPTY and re-runs every
historical migration against a production DB.

Related: [[heal-overwrite-family]], [[cli-repo-review-scope]]
