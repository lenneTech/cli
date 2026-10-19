---
name: proving-test-home-isolation
description: How to prove a CLI test cannot write to the developer's real ~/.claude or ~/.lenneTech (sentinel env run + mtime check), and where the real plugin permission data lives for trigger checks
metadata:
  type: project
---

Code under `src/lib/` that writes user-global files (Claude `settings.json`, the lt ledger
`~/.lenneTech/*.json`) resolves its paths from env vars at CALL time (`CLAUDE_CONFIG_DIR`,
`LT_CONFIG_DIR`, `LT_CLAUDE_PERMISSION_LEDGER`, `LT_MARKETPLACE_CONFIG`) unless the caller
passes explicit `options` paths. To prove a test suite never escapes its tmp dirs, do not
just read the code. Run it hostile:

```bash
stat -f '%m %z' ~/.claude/settings.json ~/.lenneTech/claude-plugin-permissions.json
CLAUDE_CONFIG_DIR=$SP/sentinel-claude LT_CONFIG_DIR=$SP/sentinel-lt \
  LT_CLAUDE_PERMISSION_LEDGER=$SP/sentinel-lt/ledger.json npx jest __tests__/<file>.test.ts
find $SP/sentinel-* -type f      # must be empty
stat -f '%m %z' ...              # must be unchanged
```

Anything written to a sentinel means some path still falls back to an env default.
`process.env` mutations inside a test file cannot leak into other files: jest-util
`createProcessObject` gives each file its own env copy (`createProcessEnv`).

**Why:** on 2026-10-18 the `lt claude plugins` permission sync started writing and
REMOVING rules in the user-wide settings.json, so a test that hit the real file would
change the developer's global Claude permissions.

**How to apply:** for trigger checks on permission sync logic, read the real plugin data
read-only: `~/code/lenneTech/claude-code/plugins/*/permissions.json` and
`~/code/lenneTech/claude-code-internal/plugins/*/permissions.json` (`permissions[].pattern`,
`formerPatterns`). On 2026-10-18 lt-dev and lt-showroom shared 17 listed rules, and no
plugin's `formerPatterns` intersected another plugin's listed rules. See also
[[consumer-corpus-for-trigger-checks]] and [[proving-regression-tests-safely]].
