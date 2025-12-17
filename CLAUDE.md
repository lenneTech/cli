# Claude Code Instructions for lenne.tech CLI

This document provides guidelines for Claude Code when working on this CLI project. **Always read existing commands first** to understand patterns and maintain consistency.

---

## Self-Maintenance of This Document

**This CLAUDE.md is a living document.** Claude Code should proactively update it when:

### When to Update

1. **New Patterns Discovered**
   - A new coding pattern is established that should be followed
   - A better way to solve a common problem is found

2. **Bugs & Gotchas**
   - A bug reveals an important caveat or edge case
   - A mistake was made that others should avoid

3. **New Features Added**
   - New commands introduce novel patterns worth documenting
   - New configuration options are added
   - New toolbox extensions are created

4. **Clarifications Needed**
   - User feedback reveals unclear or missing information
   - A pattern was misunderstood and needs better explanation

5. **Deprecations & Changes**
   - Old patterns are replaced with better ones
   - APIs or interfaces change

### How to Update

1. Add new learnings to the appropriate section
2. If no section fits, create a new one under "Learnings & Gotchas"
3. Keep entries concise and actionable
4. Include code examples where helpful
5. Date significant learnings: `<!-- Added: 2024-01-15 -->`

### Update Checklist

Before updating this file:
- [ ] Is this learning generally applicable (not project-specific)?
- [ ] Is it actionable (can Claude Code use this to improve)?
- [ ] Is it not already documented elsewhere?
- [ ] Is the explanation clear and concise?

---

## Quick Reference

Before making changes:
1. Read 2-3 similar existing commands in `src/commands/`
2. Check `src/interfaces/lt-config.interface.ts` for config structure
3. Review `docs/commands.md` for documentation style
4. Run `npm test` after changes

## Command Structure

### File Template

```typescript
import { GluegunCommand } from 'gluegun';
// or: import { ExtendedGluegunCommand } from '../../interfaces/extended-gluegun-command';

import { ExtendedGluegunToolbox } from '../../interfaces/extended-gluegun-toolbox';

/**
 * Brief description of what the command does
 */
const NewCommand: GluegunCommand = {
  alias: ['x'],                              // Single letter alias
  description: 'Short menu description',     // MAX 30 chars, no parameter hints!
  hidden: false,
  name: 'command-name',
  run: async (toolbox: ExtendedGluegunToolbox) => {
    // Implementation

    // For tests - ALWAYS return a descriptive string
    return `action completed for ${name}`;
  },
};

export default NewCommand;
```

### Description Guidelines

The `description` property is shown in the interactive menu. Keep it:
- **Short**: Max 25-30 characters
- **Action-focused**: Start with verb (Create, Generate, Install, Show)
- **No parameters**: Never mention `--flags` or options
- **Examples**:
  - ✅ `'Create new branch'`
  - ✅ `'Show merged configuration'`
  - ❌ `'Create a new branch (use --base to set base branch)'`

## Toolbox Destructuring

Standard pattern at the start of every command:

```typescript
const {
  config,                                    // Configuration handling
  filesystem,                                // File operations
  git,                                       // Git operations (custom)
  helper,                                    // Utility methods
  parameters,                                // CLI arguments
  print: { divider, error, info, spin, success, warning },
  prompt: { ask, confirm },
  strings: { camelCase, kebabCase, pascalCase },
  system,                                    // System commands
} = toolbox;
```

Only destructure what you need.

## Configuration Handling (lt.config)

### Priority Order (highest to lowest)

1. **CLI parameters** (`parameters.options.xxx`)
2. **Command-specific config** (`ltConfig?.commands?.category?.command?.option`)
3. **Global defaults** (`config.getGlobalDefault(ltConfig, 'option')`)
4. **Interactive input** or hardcoded defaults

### Implementation Pattern

```typescript
// 1. Load configuration
const ltConfig = config.loadConfig();
const configValue = ltConfig?.commands?.git?.create?.base;

// 2. Get global default
const globalValue = config.getGlobalDefault<string>(ltConfig, 'baseBranch');

// 3. Parse CLI arguments
const cliValue = parameters.options.base;

// 4. Determine final value with priority
let value: string;
if (cliValue) {
  value = cliValue;
} else if (configValue) {
  value = configValue;
  info(`Using base from lt.config commands.git.create: ${value}`);
} else if (globalValue) {
  value = globalValue;
  info(`Using base from lt.config defaults: ${value}`);
} else {
  value = await helper.getInput(null, { name: 'base branch' });
}
```

### Helper Method for Booleans

```typescript
const skipLint = config.getValue({
  cliValue: cliSkipLint,
  configValue: configSkipLint,
  defaultValue: false,
  globalValue: globalSkipLint,
});
```

### Adding New Config Options

1. Add to `src/interfaces/lt-config.interface.ts` with JSDoc
2. Add to `schemas/lt.config.schema.json`
3. Add to `src/commands/config/validate.ts` KNOWN_KEYS
4. Update `docs/lt.config.md`

## User Interaction

### Text Input

```typescript
const name = await helper.getInput(parameters.first, {
  initial: 'default-value',    // Optional default
  name: 'module name',         // Displayed prompt
  showError: true,             // Show error if empty
});
if (!name) return;             // Early exit if cancelled
```

### Selection

```typescript
const choice = await ask([{
  choices: ['Option A', 'Option B', 'Option C'],
  initial: 0,                  // Default selection index
  message: 'Select an option',
  name: 'selection',
  type: 'select',
}]);
```

### Confirmation

```typescript
const proceed = await confirm('Continue with operation?', true);  // default: true
if (!proceed) {
  info('Operation cancelled.');
  return;
}
```

### noConfirm Mode

Support skipping confirmations for automation:

```typescript
const noConfirm = config.getValue({
  cliValue: parameters.options.noConfirm,
  configValue: ltConfig?.commands?.git?.create?.noConfirm,
  defaultValue: false,
  globalValue: config.getGlobalDefault(ltConfig, 'noConfirm'),
});

if (!noConfirm && !(await confirm('Proceed?'))) {
  return;
}
```

## Output & Feedback

### Print Methods

```typescript
info('Informational message');           // Normal output
success('Operation completed!');         // Green success message
error('Something went wrong');           // Red error message
warning('This might cause issues');      // Yellow warning
divider();                               // Visual separator line
```

### Spinners for Long Operations

```typescript
const spinner = spin('Installing packages');
await system.run('npm install');
spinner.succeed('Packages installed');   // or spinner.fail('Installation failed')
```

### Timer for Performance Feedback

```typescript
const timer = system.startTimer();

// ... operations ...

success(`Completed in ${helper.msToMinutesAndSeconds(timer())}m.`);
```

### Standard Output Flow

```typescript
info('Create a new module');
info('');

// Operations with spinners...

info('');
success(`Generated ${name} in ${helper.msToMinutesAndSeconds(timer())}m.`);
info('');
info('Next steps:');
info('  npm start');
info('');
```

## Process Exit & Test Returns

### Return Value (REQUIRED)

Every command MUST return a descriptive string for tests:

```typescript
return `created module ${name}`;
return `checked out branch ${branch}`;
return 'config show';
```

### Process Exit

Only exit if NOT running from the interactive menu:

```typescript
if (!toolbox.parameters.options.fromGluegunMenu) {
  process.exit();
}

// For tests
return `result string`;
```

### Error Exit

```typescript
if (criticalError) {
  error('Critical error occurred');
  process.exit(1);
}
```

## Error Handling

### Early Return Pattern

```typescript
// Check prerequisites
if (!(await git.gitInstalled())) {
  return;
}

// Validate input
if (!name) {
  error('Name is required');
  return;
}

// Check filesystem
if (!filesystem.exists(path)) {
  error(`Path not found: ${path}`);
  return;
}
```

### Try-Catch for File Operations

```typescript
try {
  config.saveConfig(newConfig, cwd, { format });
  success('Configuration saved');
} catch (e) {
  error(`Failed to save: ${e.message}`);
  return;
}
```

## Naming Conventions

### String Transformations

```typescript
const nameCamel = camelCase(name);    // myModuleName
const nameKebab = kebabCase(name);    // my-module-name  (files/directories)
const namePascal = pascalCase(name);  // MyModuleName    (classes)
```

### Usage

- **Files/Directories**: `nameKebab` → `my-module.ts`, `my-module/`
- **Classes/Types**: `namePascal` → `MyModuleService`
- **Variables/Methods**: `nameCamel` → `myModuleService`

## Testing

### Test File Location

Tests go in `__tests__/` directory.

### Running Tests

```bash
npm test                    # Run all tests
npm test -- --watch         # Watch mode
npm test -- -t "pattern"    # Run specific tests
```

### Test Assertions

Commands return strings that can be tested:

```typescript
expect(result).toBe('created module MyModule');
```

### After Making Changes

1. Run `npm test` to verify all tests pass
2. Add new tests if adding functionality
3. Update existing tests if changing behavior

## Documentation Updates

### When to Update

Update documentation when:
- Adding new commands
- Adding new config options
- Changing command behavior
- Adding new features

### Files to Update

1. **`docs/commands.md`** - Command reference with all options
2. **`docs/lt.config.md`** - Configuration options
3. **`README.md`** - Only for major features

### Documentation Style

```markdown
### `lt category command`

Description of what the command does.

**Options:**
- `--option` - Description of the option

**Configuration:**
- `commands.category.command.option` - Description
- `defaults.option` - Global default

**Example:**
\`\`\`bash
lt category command --option value
\`\`\`
```

## Code Style

### Imports Order

1. Node.js built-ins (`path`, `fs`)
2. External packages (`gluegun`)
3. Internal interfaces
4. Internal modules

### Async/Await

Always use async/await, never .then():

```typescript
// ✅ Good
const result = await system.run('command');

// ❌ Bad
system.run('command').then(result => {});
```

### Optional Chaining

Use for safe property access:

```typescript
const value = ltConfig?.commands?.server?.module?.controller;
```

## Checklist for New Commands

- [ ] Follow file template structure
- [ ] Short description (max 30 chars, no params)
- [ ] Single-letter alias
- [ ] Destructure only needed toolbox items
- [ ] Implement config priority (CLI > config > global > interactive)
- [ ] Log when using config values
- [ ] Support noConfirm mode if has confirmations
- [ ] Use spinners for long operations
- [ ] Return descriptive string for tests
- [ ] Handle process.exit correctly
- [ ] Add to `docs/commands.md`
- [ ] If new config options:
  - [ ] Update `src/interfaces/lt-config.interface.ts`
  - [ ] Update `schemas/lt.config.schema.json`
  - [ ] Update `src/commands/config/validate.ts` KNOWN_KEYS
  - [ ] Update `docs/lt.config.md`
- [ ] Run `npm test`

## Checklist for Modifying Commands

- [ ] Read the existing command thoroughly first
- [ ] Maintain existing code style
- [ ] Don't break existing functionality
- [ ] Update tests if behavior changes
- [ ] Update documentation if interface changes
- [ ] If config options changed:
  - [ ] Update `src/interfaces/lt-config.interface.ts`
  - [ ] Update `schemas/lt.config.schema.json`
  - [ ] Update `src/commands/config/validate.ts` KNOWN_KEYS
  - [ ] Update `docs/lt.config.md`
- [ ] Run `npm test`

## Common Patterns Reference

### Directory Check

```typescript
const cwd = filesystem.cwd();
const path = cwd.substr(0, cwd.lastIndexOf('src'));
if (!filesystem.exists(join(path, 'src'))) {
  error(`No src directory found`);
  return;
}
```

### Git Check

```typescript
if (!(await git.gitInstalled())) {
  return;
}
```

### System Command

```typescript
await system.run(`cd ${dir} && npm install`);
```

### Template Generation

```typescript
await template.generate({
  props: { name, description },
  target: join(directory, 'README.md'),
  template: 'template-name/README.md.ejs',
});
```

## Files Overview

```
src/
├── commands/           # All CLI commands
│   ├── cli/           # CLI-related commands
│   ├── config/        # Configuration commands
│   ├── deployment/    # Deployment commands
│   ├── fullstack/     # Fullstack commands
│   ├── git/           # Git commands
│   ├── npm/           # NPM commands
│   ├── server/        # Server commands
│   └── ...
├── extensions/         # Toolbox extensions
│   └── config.ts      # Configuration handling
├── interfaces/         # TypeScript interfaces
│   └── lt-config.interface.ts
└── templates/          # EJS templates

schemas/
└── lt.config.schema.json   # JSON Schema for IDE support

docs/
├── commands.md        # Command reference
├── lt.config.md       # Configuration guide
└── plugins.md         # Plugin guide

__tests__/
├── cli-integration.test.ts
└── config.test.ts
```

---

## Learnings & Gotchas

This section captures important learnings discovered during development. **Claude Code should add new entries here when discovering important patterns or fixing bugs.**

### TypeScript Strict Mode <!-- Added: 2024-12-17 -->

Unused variables cause build failures. If you destructure something from toolbox but don't use it, remove it:

```typescript
// ❌ Will fail: 'config' is declared but never used
const { config, filesystem } = toolbox;

// ✅ Good: Only destructure what you need
const { filesystem } = toolbox;
```

### Config Extension suppressWarnings <!-- Added: 2024-12-17 -->

When creating `Config` instances in tests, use `suppressWarnings: true` to avoid console spam:

```typescript
// In tests
const config = new Config(filesystem, { suppressWarnings: true });
```

### Multiple Config Files Warning <!-- Added: 2024-12-17 -->

The config system warns when multiple config file variants exist in the same directory. Only the highest priority file is used:
- Priority: `lt.config.json` > `lt.config.yaml` > `lt.config`

### loadConfigWithOrigins for Debugging <!-- Added: 2024-12-17 -->

Use `config.loadConfigWithOrigins()` instead of `config.loadConfig()` when you need to know where each value came from:

```typescript
const { config: mergedConfig, origins, files } = config.loadConfigWithOrigins();
// origins is a Map<keyPath, filePath>
```

### JSON Schema for IDE Support <!-- Added: 2024-12-17 -->

The schema at `schemas/lt.config.schema.json` provides IDE autocomplete. When adding new config options:
1. Update `src/interfaces/lt-config.interface.ts`
2. Update `schemas/lt.config.schema.json`
3. Update `src/commands/config/validate.ts` KNOWN_KEYS

---

*Add new learnings above this line*
