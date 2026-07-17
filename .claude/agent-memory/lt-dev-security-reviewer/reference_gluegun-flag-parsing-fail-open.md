---
name: gluegun-flag-parsing-fail-open
description: Gluegun parses flags with yargs-parser, which does NOT coerce --flag=value to boolean — strict `=== true` checks on safety/opt-out flags fail OPEN. Audit every boolean flag guarding a destructive action.
metadata:
  type: reference
---

Gluegun's `parseParams` (`node_modules/gluegun/build/toolbox/parameter-tools.js`)
uses **`yargs-parser`** (not minimist). Consequences for every `lt` command:

- `--foo` → `{ 'foo': true, foo: true }` (camel-case-expansion gives BOTH key spellings)
- `--foo=true` → `{ foo: **'true'** }` — a **STRING**, not boolean
- `--foo true` → `{ foo: 'true' }` — string
- `--foo=false` → `{ foo: 'false' }` — string (truthy!)
- `--no-foo` → `{ foo: false }`
- Unknown flags are silently accepted, never rejected

**The trap:** `parameters.options.foo === true` is `false` for `--foo=true`.
On a flag that *prevents* a destructive action (opt-out), this **fails OPEN** —
the user explicitly asks for safety and gets destruction.

**The CLI's own convention already handles this.** Grep shows the established
pattern across the codebase:
`convert-mode.ts:95`, `fullstack/convert-mode.ts:114-117`, `nuxt.ts:105`,
`add-api.ts:100`, `add-app.ts:79`, `server/create.ts:127` all write:

```ts
const dryRun = parameters.options['dry-run'] === true || parameters.options['dry-run'] === 'true';
```

i.e. they check the **value axis** (`true` OR `'true'`). Checking only the
**key axis** (`options.fooBar === true || options['foo-bar'] === true`) is
redundant (camel-case-expansion already supplies both keys) AND misses the
string form. That exact mistake shipped in `src/commands/ticket/stop.ts:121`
(`keepDb`), where it silently drops MongoDB databases.

**How to apply during review:** for every boolean flag, ask "does this flag
ENABLE or PREVENT a destructive action?"
- ENABLES destruction (`--force`, `--drop-db`) → strict `=== true` is correct (fails safe).
- PREVENTS destruction (`--keep-db`, `--dry-run`, `--skip-*`) → strict `=== true`
  fails open. Require truthy-ish parsing: any presence of the flag counts,
  except an explicit `=false`/`--no-*` negation.

Related: [[cli-repo-review-scope]]
