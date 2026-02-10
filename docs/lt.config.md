# lt.config - Configuration File Documentation

The `lt.config` file allows you to configure default settings for the lenne.tech CLI (`lt`). This reduces repetitive input and ensures consistent project settings across your team.

## Table of Contents

- [File Formats](#file-formats)
- [File Location & Hierarchy](#file-location--hierarchy)
- [Configuration Structure](#configuration-structure)
- [Global Defaults Reference](#global-defaults-reference)
- [Commands Reference](#commands-reference)
- [Examples](#examples)
- [Advanced Features](#advanced-features)

## File Formats

The CLI supports three configuration file formats (in priority order):

| File | Format | Description |
|------|--------|-------------|
| `lt.config.json` | JSON | Explicit JSON format (recommended) |
| `lt.config.yaml` | YAML | Explicit YAML format |
| `lt.config` | Auto-detect | Tries JSON first, then YAML |

### Creating a Configuration File

Use the CLI to create a configuration file interactively:

```bash
lt config init
```

Or non-interactively:

```bash
lt config init --format yaml --controller Both --frontend nuxt
```

## File Location & Hierarchy

Configuration files are searched from the **current directory up to the root** (`/`). All found configurations are **merged hierarchically**, with closer configs taking precedence.

### Priority Order (lowest to highest)

1. Code default values
2. Global defaults (from `defaults` section)
3. Config from parent directories (higher up = lower priority)
4. Config from current directory (`commands` section)
5. CLI parameters
6. Interactive user input

### Example: Monorepo Structure

```
/home/user/
├── lt.config.json          # Global defaults
└── projects/
    └── my-monorepo/
        ├── lt.config.json  # Monorepo defaults
        └── projects/
            ├── api/
            │   └── lt.config.json  # API-specific settings
            └── app/
                └── lt.config.yaml  # App-specific settings
```

When running `lt server module` in `/home/user/projects/my-monorepo/projects/api/`:
1. `/home/user/lt.config.json` is loaded first
2. `/home/user/projects/my-monorepo/lt.config.json` is merged (overrides parent)
3. `/home/user/projects/my-monorepo/projects/api/lt.config.json` is merged (overrides all)

## Configuration Structure

```typescript
interface LtConfig {
  defaults?: DefaultsConfig;   // Global defaults for multiple commands
  commands?: {
    blocks?: BlocksConfig;
    cli?: CliConfig;
    components?: ComponentsConfig;
    config?: ConfigConfig;
    deployment?: DeploymentConfig;
    fullstack?: FullstackConfig;
    git?: GitConfig;
    npm?: NpmConfig;
    server?: ServerConfig;
  };
  meta?: MetaConfig;
}
```

## Global Defaults Reference

The `defaults` section contains settings that apply across multiple commands. These are overridden by command-specific settings in the `commands` section.

| Field | Type | Default | Used By |
|-------|------|---------|---------|
| `defaults.apiMode` | `'Rest'` \| `'GraphQL'` \| `'Both'` | `'Rest'` | server/create, fullstack/init |
| `defaults.author` | `string` | - | git/squash, server/create, cli/create |
| `defaults.baseBranch` | `string` | - | git/create, git/squash, git/rebase |
| `defaults.controller` | `'Rest'` \| `'GraphQL'` \| `'Both'` \| `'auto'` | `'Both'` | server/module, server/create |
| `defaults.domain` | `string` | - | deployment/create (use `{name}` as placeholder) |
| `defaults.noConfirm` | `boolean` | `false` | blocks/add, components/add, config/init, git/*, server/create, server/module, npm/reinit, cli/create, typescript/create, fullstack/init, deployment/create, frontend/angular |
| `defaults.packageManager` | `'npm'` \| `'pnpm'` \| `'yarn'` | `'npm'` | Fallback when no lockfile is found. Auto-detection from lockfiles takes precedence. Used by: all commands that run package manager operations |
| `defaults.skipInstall` | `boolean` | `false` | git/update |
| `defaults.skipLint` | `boolean` | `false` | server/module, server/object, server/addProp |

**Example:**
```json
{
  "defaults": {
    "apiMode": "Rest",
    "author": "lenne.Tech Team <info@lenne.tech>",
    "baseBranch": "develop",
    "controller": "Both",
    "domain": "{name}.lenne.tech",
    "noConfirm": false,
    "packageManager": "npm",
    "skipInstall": false,
    "skipLint": false
  }
}
```

**YAML Example:**
```yaml
defaults:
  apiMode: Rest
  author: "lenne.Tech Team <info@lenne.tech>"
  baseBranch: develop
  controller: Both
  domain: "{name}.lenne.tech"
  noConfirm: false
  packageManager: npm
  skipInstall: false
  skipLint: false
```

### Package Manager Detection

The CLI automatically detects the package manager for your project. The detection order is:

1. **Lockfile in current directory**: `pnpm-lock.yaml` -> pnpm, `yarn.lock` -> yarn, `package-lock.json` -> npm
2. **`packageManager` field in package.json** (Corepack standard): e.g., `"packageManager": "pnpm@8.15.0"`
3. **Lockfile in parent directories** (monorepo support)
4. **Config fallback**: `defaults.packageManager` from lt.config
5. **Default**: `npm`

This means all CLI commands (`lt server create`, `lt fullstack init`, `lt npm reinit`, etc.) will use the correct package manager automatically without any configuration needed.

### Global vs Command-Specific Settings

Global defaults provide a convenient way to set organization-wide preferences. Command-specific settings override these when you need different behavior for a particular command.

**Example:** You want `skipLint: true` globally, but `skipLint: false` specifically for `server/module`:

```json
{
  "defaults": {
    "skipLint": true
  },
  "commands": {
    "server": {
      "module": {
        "skipLint": false
      }
    }
  }
}
```

---

## Commands Reference

### Blocks Commands

#### `lt blocks add`

Adds code blocks from the lenne.tech component library.

| Field | Type | Default | Description |
|-------|------|---------|-------------|
| `commands.blocks.add.noConfirm` | `boolean` | `false` | Skip confirmation prompts (auto-install dependencies) |

**Example:**
```json
{
  "commands": {
    "blocks": {
      "add": {
        "noConfirm": true
      }
    }
  }
}
```

**CLI Override:**
```bash
lt blocks add MyBlock --noConfirm
```

---

### Components Commands

#### `lt components add`

Adds components from the lenne.tech component library.

| Field | Type | Default | Description |
|-------|------|---------|-------------|
| `commands.components.add.noConfirm` | `boolean` | `false` | Skip confirmation prompts (auto-install dependencies) |

**Example:**
```json
{
  "commands": {
    "components": {
      "add": {
        "noConfirm": true
      }
    }
  }
}
```

**CLI Override:**
```bash
lt components add MyComponent --noConfirm
```

---

### Config Commands

#### `lt config init`

Initializes a new lt.config file.

| Field | Type | Default | Description |
|-------|------|---------|-------------|
| `commands.config.init.noConfirm` | `boolean` | `false` | Skip confirmation prompts (overwrite existing config) |

**Example:**
```json
{
  "commands": {
    "config": {
      "init": {
        "noConfirm": true
      }
    }
  }
}
```

**CLI Override:**
```bash
lt config init --noConfirm
```

---

### CLI Commands

#### `lt cli create`

Creates a new CLI project.

| Field | Type | Default | Description |
|-------|------|---------|-------------|
| `commands.cli.create.author` | `string` | - | Default author for new CLI projects |

**Example:**
```json
{
  "commands": {
    "cli": {
      "create": {
        "author": "lenne.Tech Team <info@lenne.tech>"
      }
    }
  }
}
```

**CLI Override:**
```bash
lt cli create --author "John Doe <john@example.com>"
```

---

### Server Commands

#### `lt server module`

Creates a new server module with controller and resolver.

| Field | Type | Default | Description |
|-------|------|---------|-------------|
| `commands.server.module.controller` | `'Rest'` \| `'GraphQL'` \| `'Both'` \| `'auto'` | `'Both'` | Default controller type. `'auto'` detects from existing modules. |
| `commands.server.module.skipLint` | `boolean` | `false` | Skip lint fix after module creation |

**Example:**
```json
{
  "commands": {
    "server": {
      "module": {
        "controller": "auto",
        "skipLint": false
      }
    }
  }
}
```

**CLI Override:**
```bash
lt server module --name MyModule --controller GraphQL --skipLint
```

---

#### `lt server object`

Creates a new server object (embedded document).

| Field | Type | Default | Description |
|-------|------|---------|-------------|
| `commands.server.object.skipLint` | `boolean` | `false` | Skip lint fix after object creation |

**Example:**
```json
{
  "commands": {
    "server": {
      "object": {
        "skipLint": false
      }
    }
  }
}
```

---

#### `lt server addProp`

Adds a property to an existing module or object.

| Field | Type | Default | Description |
|-------|------|---------|-------------|
| `commands.server.addProp.skipLint` | `boolean` | `false` | Skip lint fix after adding property |

**Example:**
```json
{
  "commands": {
    "server": {
      "addProp": {
        "skipLint": true
      }
    }
  }
}
```

---

#### `lt server create`

Creates a new server project.

| Field | Type | Default | Description |
|-------|------|---------|-------------|
| `commands.server.create.apiMode` | `'Rest'` \| `'GraphQL'` \| `'Both'` | `'Rest'` | API mode for the server project. Determines which API endpoints (REST/GraphQL) are included. |
| `commands.server.create.author` | `string` | - | Default author for new projects |
| `commands.server.create.branch` | `string` | - | Branch of nest-server-starter to use as template |
| `commands.server.create.controller` | `'Rest'` \| `'GraphQL'` \| `'Both'` \| `'auto'` | `'Both'` | Default controller type for new projects |
| `commands.server.create.copy` | `string` | - | Path to local template directory to copy instead of cloning |
| `commands.server.create.description` | `string` | - | Default description (use `{name}` as placeholder) |
| `commands.server.create.git` | `boolean` | - | Initialize git repository |
| `commands.server.create.link` | `string` | - | Path to local template directory to symlink (fastest, changes affect original) |
| `commands.server.create.noConfirm` | `boolean` | `false` | Skip confirmation prompts |

**Example:**
```json
{
  "commands": {
    "server": {
      "create": {
        "controller": "Both",
        "git": true,
        "author": "lenne.Tech Team <info@lenne.tech>",
        "description": "{name} Server",
        "branch": "feature/new-auth",
        "copy": "/path/to/local/nest-server-starter"
      }
    }
  }
}
```

**CLI Override:**
```bash
lt server create --name MyServer --api-mode Rest --git true --author "John Doe" --description "My Server"
lt server create --name MyServer --api-mode GraphQL --branch feature/new-auth
lt server create --copy /path/to/local/nest-server-starter
lt server create --link /path/to/local/nest-server-starter  # Fastest, but changes affect original
```

---

### Deployment Commands

#### `lt deployment create`

Creates deployment configuration for a mono repository.

| Field | Type | Default | Description |
|-------|------|---------|-------------|
| `commands.deployment.domain` | `string` | - | Default domain (use `{name}` as placeholder) |
| `commands.deployment.gitHub` | `boolean` | - | Enable GitHub pipeline by default |
| `commands.deployment.gitLab` | `boolean` | - | Enable GitLab pipeline by default |
| `commands.deployment.testRunner` | `string` | `'docker-swarm'` | Default GitLab test runner tag |
| `commands.deployment.prodRunner` | `string` | `'docker-landing'` | Default GitLab production runner tag |

**Example:**
```json
{
  "commands": {
    "deployment": {
      "domain": "{name}.lenne.tech",
      "gitHub": false,
      "gitLab": true,
      "testRunner": "docker-swarm",
      "prodRunner": "docker-landing"
    }
  }
}
```

**CLI Override:**
```bash
lt deployment create --domain myproject.example.com --gitLab true --testRunner docker-swarm
```

---

### Frontend Commands

#### `lt frontend angular`

Creates a new Angular frontend project using ng-base-starter.

| Field | Type | Default | Description |
|-------|------|---------|-------------|
| `commands.frontend.angular.branch` | `string` | - | Branch of ng-base-starter to use as template |
| `commands.frontend.angular.copy` | `string` | - | Path to local template directory to copy instead of cloning |
| `commands.frontend.angular.link` | `string` | - | Path to local template directory to symlink (fastest, changes affect original) |
| `commands.frontend.angular.localize` | `boolean` | - | Enable Angular localize by default |
| `commands.frontend.angular.noConfirm` | `boolean` | `false` | Skip confirmation prompts |

**Example:**
```json
{
  "commands": {
    "frontend": {
      "angular": {
        "branch": "feature/new-design",
        "localize": true,
        "copy": "/path/to/local/ng-base-starter"
      }
    }
  }
}
```

**CLI Override:**
```bash
lt frontend angular --branch feature/new-design
lt frontend angular --copy /path/to/local/ng-base-starter
lt frontend angular --link /path/to/local/ng-base-starter  # Fastest, changes affect original
```

---

#### `lt frontend nuxt`

Creates a new Nuxt frontend project using nuxt-base-starter.

| Field | Type | Default | Description |
|-------|------|---------|-------------|
| `commands.frontend.nuxt.branch` | `string` | - | Branch of nuxt-base-starter to use. When specified, uses git clone instead of create-nuxt-base |
| `commands.frontend.nuxt.copy` | `string` | - | Path to the `nuxt-base-template/` subdirectory to copy |
| `commands.frontend.nuxt.link` | `string` | - | Path to the `nuxt-base-template/` subdirectory to symlink (fastest, changes affect original) |

**Note:** For `copy` and `link`, specify the path to the `nuxt-base-template/` subdirectory within the nuxt-base-starter repository, not the repository root.

**Example:**
```json
{
  "commands": {
    "frontend": {
      "nuxt": {
        "branch": "feature/new-design",
        "copy": "/path/to/nuxt-base-starter/nuxt-base-template"
      }
    }
  }
}
```

**CLI Override:**
```bash
lt frontend nuxt --branch feature/new-design
lt frontend nuxt --copy /path/to/nuxt-base-starter/nuxt-base-template
lt frontend nuxt --link /path/to/nuxt-base-starter/nuxt-base-template  # Fastest, changes affect original
```

---

### Fullstack Commands

#### `lt fullstack init`

Creates a new fullstack workspace with API and frontend.

| Field | Type | Default | Description |
|-------|------|---------|-------------|
| `commands.fullstack.apiMode` | `'Rest'` \| `'GraphQL'` \| `'Both'` | `'Rest'` | API mode for the server project |
| `commands.fullstack.apiBranch` | `string` | - | Branch of nest-server-starter to use for API |
| `commands.fullstack.apiCopy` | `string` | - | Path to local API template directory to copy instead of cloning |
| `commands.fullstack.apiLink` | `string` | - | Path to local API template directory to symlink (fastest, changes affect original) |
| `commands.fullstack.frontend` | `'angular'` \| `'nuxt'` | - | Default frontend framework |
| `commands.fullstack.frontendBranch` | `string` | - | Branch of frontend starter to use (ng-base-starter or nuxt-base-starter) |
| `commands.fullstack.frontendCopy` | `string` | - | Path to local frontend template directory to copy instead of cloning |
| `commands.fullstack.frontendLink` | `string` | - | Path to local frontend template directory to symlink (fastest, changes affect original) |
| `commands.fullstack.git` | `boolean` | - | Push initial commit to remote repository (git is always initialized with `dev` branch) |
| `commands.fullstack.gitLink` | `string` | - | Git remote repository URL (required when `git` is true) |

**Example:**
```json
{
  "commands": {
    "fullstack": {
      "frontend": "nuxt",
      "git": true,
      "gitLink": "https://github.com/myorg/myproject.git",
      "apiBranch": "feature/new-auth",
      "frontendBranch": "feature/new-design",
      "apiCopy": "/path/to/local/nest-server-starter",
      "frontendCopy": "/path/to/local/nuxt-base-starter"
    }
  }
}
```

**CLI Override:**
```bash
lt fullstack init --name MyProject --api-mode Rest --frontend nuxt
lt fullstack init --name MyProject --api-mode GraphQL --frontend angular --git true --git-link https://...
lt fullstack init --api-copy /path/to/api --frontend-copy /path/to/frontend
lt fullstack init --api-link /path/to/api --frontend-link /path/to/frontend  # Fastest, changes affect original
```

---

### Git Commands

#### `lt git create`

Creates a new branch.

| Field | Type | Default | Description |
|-------|------|---------|-------------|
| `commands.git.create.base` | `string` | - | Default base branch for new branches (command-specific) |
| `commands.git.create.noConfirm` | `boolean` | `false` | Skip confirmation prompts |
| `commands.git.baseBranch` | `string` | - | Default base branch (category-level fallback) |
| `commands.git.noConfirm` | `boolean` | `false` | Skip confirmation prompts (category-level) |

**Example:**
```json
{
  "commands": {
    "git": {
      "baseBranch": "develop",
      "create": {
        "base": "develop",
        "noConfirm": false
      }
    }
  }
}
```

**CLI Override:**
```bash
lt git create feature/my-feature --base develop
```

---

#### `lt git get`

Checks out a git branch.

| Field | Type | Default | Description |
|-------|------|---------|-------------|
| `commands.git.get.noConfirm` | `boolean` | `false` | Skip confirmation prompts |
| `commands.git.get.mode` | `'hard'` | - | Default mode for handling local commits (`'hard'` removes them) |

**Example:**
```json
{
  "commands": {
    "git": {
      "get": {
        "noConfirm": true,
        "mode": "hard"
      }
    }
  }
}
```

**CLI Override:**
```bash
lt git get feature/my-feature --noConfirm --mode hard
```

---

#### `lt git squash`

Squashes commits in a branch.

| Field | Type | Default | Description |
|-------|------|---------|-------------|
| `commands.git.squash.noConfirm` | `boolean` | `false` | Skip confirmation prompts |
| `commands.git.squash.base` | `string` | `'dev'` | Default base branch for squash |
| `commands.git.squash.author` | `string` | - | Default author for squash commits |

**Example:**
```json
{
  "commands": {
    "git": {
      "squash": {
        "noConfirm": false,
        "base": "develop",
        "author": "Team <team@lenne.tech>"
      }
    }
  }
}
```

**CLI Override:**
```bash
lt git squash develop --author "John Doe <john@example.com>" --noConfirm
```

---

#### `lt git clear`

Clears current changes (hard reset).

| Field | Type | Default | Description |
|-------|------|---------|-------------|
| `commands.git.clear.noConfirm` | `boolean` | `false` | Skip confirmation prompts |

**Example:**
```json
{
  "commands": {
    "git": {
      "clear": {
        "noConfirm": true
      }
    }
  }
}
```

**CLI Override:**
```bash
lt git clear --noConfirm
```

---

#### `lt git force-pull`

Force pulls branch (loses local changes).

| Field | Type | Default | Description |
|-------|------|---------|-------------|
| `commands.git.forcePull.noConfirm` | `boolean` | `false` | Skip confirmation prompts |

**Example:**
```json
{
  "commands": {
    "git": {
      "forcePull": {
        "noConfirm": true
      }
    }
  }
}
```

**CLI Override:**
```bash
lt git force-pull --noConfirm
```

---

#### `lt git rebase`

Rebases current branch onto another branch.

| Field | Type | Default | Description |
|-------|------|---------|-------------|
| `commands.git.rebase.noConfirm` | `boolean` | `false` | Skip confirmation prompts |
| `commands.git.rebase.base` | `string` | - | Default base branch for rebase |

**Example:**
```json
{
  "commands": {
    "git": {
      "rebase": {
        "noConfirm": false,
        "base": "develop"
      }
    }
  }
}
```

**CLI Override:**
```bash
lt git rebase --base develop --noConfirm
```

---

#### `lt git reset`

Resets current branch to remote state.

| Field | Type | Default | Description |
|-------|------|---------|-------------|
| `commands.git.reset.noConfirm` | `boolean` | `false` | Skip confirmation prompts |

**Example:**
```json
{
  "commands": {
    "git": {
      "reset": {
        "noConfirm": true
      }
    }
  }
}
```

**CLI Override:**
```bash
lt git reset --noConfirm
```

---

#### `lt git undo`

Undoes last commit (without losing files).

| Field | Type | Default | Description |
|-------|------|---------|-------------|
| `commands.git.undo.noConfirm` | `boolean` | `false` | Skip confirmation prompts |

**Example:**
```json
{
  "commands": {
    "git": {
      "undo": {
        "noConfirm": true
      }
    }
  }
}
```

**CLI Override:**
```bash
lt git undo --noConfirm
```

---

#### `lt git rename`

Renames current branch.

| Field | Type | Default | Description |
|-------|------|---------|-------------|
| `commands.git.rename.noConfirm` | `boolean` | `false` | Skip confirmation prompts |

**Example:**
```json
{
  "commands": {
    "git": {
      "rename": {
        "noConfirm": true
      }
    }
  }
}
```

**CLI Override:**
```bash
lt git rename new-name --noConfirm
```

---

#### `lt git update`

Updates current branch (fetch + pull + npm install).

| Field | Type | Default | Description |
|-------|------|---------|-------------|
| `commands.git.update.skipInstall` | `boolean` | `false` | Skip npm install after update |

**Example:**
```json
{
  "commands": {
    "git": {
      "update": {
        "skipInstall": true
      }
    }
  }
}
```

**CLI Override:**
```bash
lt git update --skipInstall
```

---

### NPM Commands

#### `lt npm reinit`

Reinitializes npm packages.

| Field | Type | Default | Description |
|-------|------|---------|-------------|
| `commands.npm.reinit.update` | `boolean` | `false` | Update package.json before reinitializing |
| `commands.npm.reinit.noConfirm` | `boolean` | `false` | Skip confirmation prompts |

**Example:**
```json
{
  "commands": {
    "npm": {
      "reinit": {
        "update": true,
        "noConfirm": false
      }
    }
  }
}
```

---

### Metadata

The `meta` section stores project information.

| Field | Type | Description |
|-------|------|-------------|
| `meta.name` | `string` | Project name |
| `meta.description` | `string` | Project description |
| `meta.version` | `string` | Configuration version |
| `meta.tags` | `string[]` | Tags for categorization |

**Example:**
```json
{
  "meta": {
    "name": "my-project",
    "description": "My awesome project",
    "version": "1.0.0",
    "tags": ["api", "nuxt", "monorepo"]
  }
}
```

## Examples

### Complete JSON Example

```json
{
  "defaults": {
    "author": "lenne.Tech Team <info@lenne.tech>",
    "baseBranch": "develop",
    "controller": "Both",
    "domain": "{name}.lenne.tech",
    "noConfirm": false,
    "packageManager": "npm",
    "skipInstall": false,
    "skipLint": false
  },
  "commands": {
    "deployment": {
      "gitHub": false,
      "gitLab": true,
      "testRunner": "docker-swarm",
      "prodRunner": "docker-landing"
    },
    "fullstack": {
      "frontend": "nuxt",
      "git": false,
      "gitLink": "https://github.com/myorg/myproject.git"
    },
    "git": {
      "defaultBranch": "develop",
      "get": {
        "mode": "hard"
      }
    },
    "npm": {
      "reinit": {
        "update": true
      }
    },
    "server": {
      "module": {
        "controller": "auto"
      }
    }
  },
  "meta": {
    "name": "my-monorepo",
    "version": "1.0.0"
  }
}
```

### Complete YAML Example

```yaml
defaults:
  author: "lenne.Tech Team <info@lenne.tech>"
  baseBranch: develop
  controller: Both
  domain: "{name}.lenne.tech"
  noConfirm: false
  packageManager: npm
  skipInstall: false
  skipLint: false

commands:
  deployment:
    gitHub: false
    gitLab: true
    testRunner: docker-swarm
    prodRunner: docker-landing

  fullstack:
    frontend: nuxt
    git: false
    gitLink: "https://github.com/myorg/myproject.git"

  git:
    defaultBranch: develop
    baseBranch: develop
    get:
      noConfirm: false
      mode: hard
    squash:
      base: develop

  npm:
    reinit:
      update: true
      noConfirm: false

  server:
    addProp:
      skipLint: false
    create:
      controller: Both
      git: true
      author: "lenne.Tech Team <info@lenne.tech>"
    module:
      controller: auto
      skipLint: false
    object:
      skipLint: false

meta:
  name: my-monorepo
  version: "1.0.0"
```

### Minimal Example (API Project)

```json
{
  "commands": {
    "server": {
      "module": {
        "controller": "GraphQL"
      }
    }
  }
}
```

## Advanced Features

### Null Values (Reset to Default)

Set a value to `null` to remove it from parent configurations and use the default:

**Parent config (`/home/user/lt.config.json`):**
```json
{
  "commands": {
    "server": {
      "module": {
        "controller": "Rest"
      }
    }
  }
}
```

**Child config (`/home/user/project/lt.config.json`):**
```json
{
  "commands": {
    "server": {
      "module": {
        "controller": null
      }
    }
  }
}
```

Result: `controller` will be unset, and the CLI will use its default (`Both`) or ask interactively.

**YAML null syntax:**
```yaml
commands:
  server:
    module:
      controller: ~  # or 'null'
```

### Array Handling

Arrays are **completely replaced**, not merged:

**Parent:**
```json
{
  "meta": {
    "tags": ["api", "backend"]
  }
}
```

**Child:**
```json
{
  "meta": {
    "tags": ["frontend"]
  }
}
```

**Result:**
```json
{
  "meta": {
    "tags": ["frontend"]
  }
}
```

### Viewing Effective Configuration

To see the merged configuration for the current directory:

```bash
lt config show
```

## Best Practices

1. **Use JSON for explicit configs** - Better IDE support and validation
2. **Place shared settings in parent directories** - E.g., monorepo root
3. **Override only what's needed** - Child configs only need to specify differences
4. **Use `auto` for controller detection** - Let the CLI detect patterns from existing code
5. **Commit lt.config to version control** - Share settings with your team

## Troubleshooting

### Config not being applied

1. Check file name spelling: `lt.config.json` (not `lt-config.json`)
2. Verify JSON/YAML syntax is valid
3. Run `lt config show` to see the effective configuration
4. Check if CLI parameter is overriding the config

### Invalid JSON/YAML warnings

The CLI will show warnings for invalid config files but continue with valid ones:

```
Warning: Could not parse config file /path/to/lt.config.json
```

Fix the JSON/YAML syntax or remove the invalid file.
