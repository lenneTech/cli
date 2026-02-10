# lenne.tech CLI

## WHAT: Project Overview

A TypeScript CLI built with [Gluegun](https://infinitered.github.io/gluegun/) for fullstack development with NestJS backends and Nuxt frontends.

```
src/
├── commands/          # CLI commands (organized by category)
├── extensions/        # Toolbox extensions (config.ts, git.ts, etc.)
├── interfaces/        # TypeScript interfaces
└── templates/         # EJS templates for code generation

schemas/               # JSON Schema for IDE support
docs/                  # Command and configuration docs
__tests__/             # Jest tests
```

## WHY: Purpose

Automates repetitive fullstack development tasks: project scaffolding, module generation, git workflows, deployment setup.

## HOW: Development Workflow

### Before Making Changes
1. Read 2-3 similar commands in `src/commands/` first
2. Check @src/interfaces/lt-config.interface.ts for config structure
3. Run `npm test` after changes

### Common Commands
```bash
npm test                    # Run all tests
npm test -- -t "pattern"    # Run specific tests
npm run lint                # Check code style
npm run build               # Compile TypeScript
```

---

## Critical Rules

**IMPORTANT: Follow these rules exactly.**

### Command Structure
- Description: MAX 30 chars, no parameter hints, start with verb
- Alias: Single letter preferred
- Return: ALWAYS return descriptive string for tests
- Exit: Use `process.exit()` only if NOT from menu

```typescript
const Command: GluegunCommand = {
  alias: ['x'],
  description: 'Short action description',  // MAX 30 chars!
  name: 'command-name',
  run: async (toolbox: ExtendedGluegunToolbox) => {
    // Implementation...

    if (!toolbox.parameters.options.fromGluegunMenu) {
      process.exit();
    }
    return `completed action for ${name}`;  // REQUIRED for tests
  },
};
```

### Config Priority (highest to lowest)
1. CLI parameters (`parameters.options.xxx`)
2. Command config (`ltConfig?.commands?.category?.command?.option`)
3. Global defaults (`config.getGlobalDefault(ltConfig, 'option')`)
4. Interactive input or hardcoded defaults

### Adding Config Options
Update ALL of these files:
1. `src/interfaces/lt-config.interface.ts`
2. `schemas/lt.config.schema.json`
3. `src/commands/config/validate.ts` KNOWN_KEYS
4. `docs/lt.config.md`

### noConfirm Pattern
```typescript
const noConfirm = config.getValue({
  cliValue: parameters.options.noConfirm,
  configValue: ltConfig?.commands?.git?.create?.noConfirm,
  defaultValue: false,
  globalValue: config.getGlobalDefault(ltConfig, 'noConfirm'),
});

if (!noConfirm && !(await confirm('Proceed?'))) return;
```

### Templates
**IMPORTANT: Use EJS templates for multi-line output**, not string arrays.
- Templates location: `src/templates/`
- See @src/templates/completion/ for examples

---

## Gotchas & Learnings

### TypeScript Strict Mode
Unused variables cause build failures. Only destructure what you use:
```typescript
// BAD: const { config, filesystem } = toolbox;
// GOOD: const { filesystem } = toolbox;
```

### ESLint Perfectionist Rules
Functions and types must be alphabetically sorted. Build fails otherwise.

### Alias Conflicts
Conflicts only occur at the **same hierarchical level**:
```
OK - different parents:
  cli/rename.ts    ['r']  → lt cli r
  npm/reinit.ts    ['r']  → lt npm r

CONFLICT - same level:
  cli/cli.ts       ['c']  → lt c
  claude/claude.ts ['c']  → lt c
```
**Rule**: Only change aliases if conflict at same level.

### Config File Priority
`lt.config.json` > `lt.config.yaml` > `lt.config`

### Test Warnings
Use `suppressWarnings: true` when creating Config instances in tests.

### Running lt CLI Commands (AI Agent Usage)
When executing `lt` commands, prefer explicit parameters over interactive prompts where possible. The CLI will show a hint in non-interactive mode, but you can avoid it by providing the required flags:
```bash
# GOOD - explicit parameters
lt fullstack init --name my-project --frontend nuxt --api-mode Rest --noConfirm
lt server create --name my-server --api-mode GraphQL --noConfirm
lt server module --name MyModule --controller auto --noConfirm

# BAD - will enter interactive mode
lt fullstack init
lt server create
lt server module
```
Key flags: `--noConfirm` skips all confirmations, `--name` sets the project/module name. See `docs/commands.md` for all available parameters per command.

---

## Quick Checklist

### New Command
- [ ] Read similar commands first
- [ ] Description max 30 chars
- [ ] Implement config priority
- [ ] Support noConfirm if has confirmations
- [ ] Return descriptive string
- [ ] Handle process.exit correctly
- [ ] Update docs/commands.md
- [ ] Run `npm test`

### New Config Option
- [ ] Update lt-config.interface.ts
- [ ] Update lt.config.schema.json
- [ ] Update validate.ts KNOWN_KEYS
- [ ] Update docs/lt.config.md

---

## Self-Maintenance

Add new learnings to "Gotchas & Learnings" when discovering patterns or fixing bugs.
Use format: `### Title <!-- Added: YYYY-MM-DD -->`
