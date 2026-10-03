# Memory Index

- [Proving regression tests safely](proving-regression-tests-safely.md) — A/B old vs new impl in an isolated scratchpad harness; never git stash or drop files into `__tests__/` during a concurrent `npm run check`
- [heal-* tests depend on .gitignore](heal-tests-depend-on-gitignore.md) — the heal helpers' git dirty-guard means their `__tests__/temp-*` fixtures only pass because that prefix is gitignored
- [Consumer corpus for trigger checks](consumer-corpus-for-trigger-checks.md) — survey real lt projects under ~/code read-only to tell observed triggers from hypothetical ones
