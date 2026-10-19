---
name: claude-code-bash-rule-matching
description: How Claude Code actually matches Bash allow rules (`*` = `.*` crossing `/` and `..`, `:*` = literal prefix, auto mode strips only bare interpreter rules) — needed to judge any rule lt writes into settings.json
metadata:
  type: reference
---

Verified 2026-10-18 against the installed Claude Code 2.1.302 binary
(`~/.local/share/claude/versions/<v>`, Bun-compiled; `strings -n 20` then search for `function Ene(`,
`function f8(`, `function lzn(`, `azn=[`). Re-verify on a newer version before relying on it.

- **Wildcard rule** (contains an unescaped `*`, does NOT end in `:*`): every `*` compiles to `.*`
  with the dotall flag, anchored `^…$`. It crosses `/`, `..`, spaces and quotes. Only a single
  trailing ` *` becomes `( .*)?`. So `Bash(node /abs/plugin/*/scripts/*)` matches
  `node /abs/plugin/../../../../any/where/scripts/x.js`, and the shell resolves the `..` physically.
- **Prefix rule** (`…:*` at the end, regex `^(.+):\*$`): plain case-sensitive `startsWith` — any
  `*` inside the prefix is a LITERAL character, so such a rule with a mid-path `*` never matches.
- Compound commands (`&&`, `;`, `|`) never match a prefix/wildcard allow rule (`f8` checks the
  split length first) — not a vector.
- **Auto mode** strips (ignores) allow rules only for bare interpreter/shell/wrapper forms:
  `node`, `node *`, `node:*`, `node*`, `node -…*` (list `azn` + zsh/fish/eval/exec/env/xargs/sudo).
  `node /abs/path/*` or `bash /abs/path/*` is NOT stripped, so it bypasses the classifier.
- No `..`/path-traversal check applies to a rule-matched Bash command.

**How to apply:** when lt (`plugin-permissions.ts`, `setupPermissions`) writes or resolves a rule,
a `*` anywhere after a fixed directory makes the rule cover every file on disk reachable by `..`.
See [[cli-generated-file-injection]] for the other places lt writes into user config.
