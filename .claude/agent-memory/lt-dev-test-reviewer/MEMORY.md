# Memory Index

- [Proving regression tests safely](proving-regression-tests-safely.md) — scratchpad A/B, whole-command A/B, mutation runs of the real jest file, stub-PATH probes
- [heal-* tests depend on .gitignore](heal-tests-depend-on-gitignore.md) — the heal helpers' git dirty-guard means their `__tests__/temp-*` fixtures only pass because that prefix is gitignored
- [Consumer corpus for trigger checks](consumer-corpus-for-trigger-checks.md) — survey real lt projects under ~/code read-only to tell observed triggers from hypothetical ones
- [git message locale dependence](git-message-locale-dependence.md) — git stderr is localized on gettext builds; Apple git hides it; Docker repro recipe
- [Proving test home isolation](proving-test-home-isolation.md) — sentinel-env jest run + mtime check proves tests never touch real ~/.claude / ~/.lenneTech; real plugin permission data paths
- [CI parity checks](ci-parity-checks.md) — Node 20 binary path, npm 10 `ci --dry-run` lockfile check, testing vendor templates against the real upstream file
