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
    cli?: CliConfig;
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
| `defaults.author` | `string` | - | git/squash, server/create, cli/create |
| `defaults.baseBranch` | `string` | - | git/create, git/squash, git/rebase |
| `defaults.controller` | `'Rest'` \| `'GraphQL'` \| `'Both'` \| `'auto'` | `'Both'` | server/module, server/create |
| `defaults.domain` | `string` | - | deployment/create (use `{name}` as placeholder) |
| `defaults.noConfirm` | `boolean` | `false` | git/get, git/squash, git/create, git/clear, git/force-pull, git/rebase, git/rename, git/reset, git/undo, npm/reinit |
| `defaults.skipLint` | `boolean` | `false` | server/module, server/object, server/addProp |

**Example:**
```json
{
  "defaults": {
    "author": "lenne.Tech Team <info@lenne.tech>",
    "baseBranch": "develop",
    "controller": "Both",
    "domain": "{name}.lenne.tech",
    "noConfirm": false,
    "skipLint": false
  }
}
```

**YAML Example:**
```yaml
defaults:
  author: "lenne.Tech Team <info@lenne.tech>"
  baseBranch: develop
  controller: Both
  domain: "{name}.lenne.tech"
  noConfirm: false
  skipLint: false
```

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
| `commands.server.create.controller` | `'Rest'` \| `'GraphQL'` \| `'Both'` \| `'auto'` | `'Both'` | Default controller type for new projects |
| `commands.server.create.git` | `boolean` | - | Initialize git repository |
| `commands.server.create.author` | `string` | - | Default author for new projects |
| `commands.server.create.description` | `string` | - | Default description (use `{name}` as placeholder) |

**Example:**
```json
{
  "commands": {
    "server": {
      "create": {
        "controller": "Both",
        "git": true,
        "author": "lenne.Tech Team <info@lenne.tech>",
        "description": "{name} Server"
      }
    }
  }
}
```

**CLI Override:**
```bash
lt server create --name MyServer --git true --author "John Doe" --description "My Server"
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

### Fullstack Commands

#### `lt fullstack init`

Creates a new fullstack workspace with API and frontend.

| Field | Type | Default | Description |
|-------|------|---------|-------------|
| `commands.fullstack.frontend` | `'angular'` \| `'nuxt'` | - | Default frontend framework |
| `commands.fullstack.git` | `boolean` | - | Initialize git repository |
| `commands.fullstack.gitLink` | `string` | - | Git repository URL |

**Example:**
```json
{
  "commands": {
    "fullstack": {
      "frontend": "nuxt",
      "git": true,
      "gitLink": "https://github.com/myorg/myproject.git"
    }
  }
}
```

**CLI Override:**
```bash
lt fullstack init --name MyProject --frontend angular --git true --git-link https://...
```

---

### Git Commands

#### `lt git create`

Creates a new branch.

| Field | Type | Default | Description |
|-------|------|---------|-------------|
| `commands.git.defaultBranch` | `string` | `'main'` | Default branch name |
| `commands.git.baseBranch` | `string` | - | Default base branch for new feature branches |
| `commands.git.noConfirm` | `boolean` | `false` | Skip confirmation prompts (global) |

**Example:**
```json
{
  "commands": {
    "git": {
      "defaultBranch": "develop",
      "baseBranch": "develop",
      "noConfirm": false
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
      "git": false
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
