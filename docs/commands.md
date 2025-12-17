# Command Reference for lt

This document provides a comprehensive reference for all `lt` CLI commands. For configuration file options, see [lt.config.md](./lt.config.md).

## Table of Contents

- [CLI Commands](#cli-commands)
- [Server Commands](#server-commands)
- [Git Commands](#git-commands)
- [Fullstack Commands](#fullstack-commands)
- [Deployment Commands](#deployment-commands)
- [NPM Commands](#npm-commands)
- [Frontend Commands](#frontend-commands)
- [Config Commands](#config-commands)
- [Other Commands](#other-commands)

---

## CLI Commands

### `lt cli create`

Creates a new CLI project based on the lenne.Tech CLI starter.

**Usage:**
```bash
lt cli create [name] [options]
```

**Options:**
| Option | Description |
|--------|-------------|
| `--author <name>` | Author name for the CLI |
| `--link` | Link CLI globally after creation |
| `--nolink` | Skip linking |

**Configuration:** `commands.cli.create.author`, `defaults.author`

---

## Server Commands

### `lt server create`

Creates a new NestJS server project.

**Usage:**
```bash
lt server create [name] [options]
```

**Options:**
| Option | Description |
|--------|-------------|
| `--description <text>` | Project description |
| `--author <name>` | Author name |
| `--git` | Initialize git repository |

**Configuration:** `commands.server.create.*`, `defaults.author`

---

### `lt server module`

Creates a new server module with model, service, controller/resolver.

**Usage:**
```bash
lt server module [options]
```

**Options:**
| Option | Description |
|--------|-------------|
| `--name <name>` | Module name |
| `--controller <type>` | Controller type: `Rest`, `GraphQL`, `Both`, `auto` |
| `--skipLint` | Skip lint fix after creation |

**Configuration:** `commands.server.module.*`, `defaults.controller`, `defaults.skipLint`

---

### `lt server object`

Creates a new embedded object (sub-document).

**Usage:**
```bash
lt server object [options]
```

**Options:**
| Option | Description |
|--------|-------------|
| `--name <name>` | Object name |
| `--skipLint` | Skip lint fix after creation |

**Configuration:** `commands.server.object.skipLint`, `defaults.skipLint`

---

### `lt server addProp`

Adds a property to an existing module or object.

**Usage:**
```bash
lt server addProp [options]
```

**Options:**
| Option | Description |
|--------|-------------|
| `--type <type>` | Target type: `Module` or `Object` |
| `--element <name>` | Target element name |
| `--skipLint` | Skip lint fix after creation |

**Configuration:** `commands.server.addProp.skipLint`, `defaults.skipLint`

---

## Git Commands

All git commands support the `--noConfirm` flag and can be configured via `defaults.noConfirm` or `commands.git.noConfirm`.

### `lt git create`

Creates a new git branch from a base branch.

**Usage:**
```bash
lt git create <branch-name> [base-branch] [options]
```

**Options:**
| Option | Description |
|--------|-------------|
| `--base <branch>` | Base branch for the new branch |

**Configuration:** `commands.git.baseBranch`, `defaults.baseBranch`

---

### `lt git get`

Checks out a git branch (local or remote).

**Usage:**
```bash
lt git get <branch-name> [options]
```

**Options:**
| Option | Description |
|--------|-------------|
| `--noConfirm` | Skip confirmation prompts |
| `--mode hard` | Remove local commits automatically |

**Configuration:** `commands.git.get.*`, `defaults.noConfirm`

---

### `lt git squash`

Squashes all commits in the current branch.

**Usage:**
```bash
lt git squash [base-branch] [options]
```

**Options:**
| Option | Description |
|--------|-------------|
| `--noConfirm` | Skip confirmation prompts |
| `--author <name>` | Author for the squash commit |
| `--message <text>` | Commit message |

**Configuration:** `commands.git.squash.*`, `defaults.noConfirm`, `defaults.baseBranch`, `defaults.author`

---

### `lt git rebase`

Rebases the current branch onto another branch.

**Usage:**
```bash
lt git rebase [base-branch] [options]
```

**Options:**
| Option | Description |
|--------|-------------|
| `--noConfirm` | Skip confirmation prompts |
| `--base <branch>` | Base branch for rebase |

**Configuration:** `commands.git.rebase.*`, `defaults.noConfirm`, `defaults.baseBranch`

---

### `lt git clear`

Clears all current changes (hard reset).

**Usage:**
```bash
lt git clear [options]
```

**Options:**
| Option | Description |
|--------|-------------|
| `--noConfirm` | Skip confirmation prompts |

**Configuration:** `commands.git.clear.noConfirm`, `defaults.noConfirm`

---

### `lt git force-pull`

Force pulls the current branch, discarding local changes.

**Usage:**
```bash
lt git force-pull [options]
```

**Options:**
| Option | Description |
|--------|-------------|
| `--noConfirm` | Skip confirmation prompts |

**Configuration:** `commands.git.forcePull.noConfirm`, `defaults.noConfirm`

---

### `lt git reset`

Resets the current branch to match the remote.

**Usage:**
```bash
lt git reset [options]
```

**Options:**
| Option | Description |
|--------|-------------|
| `--noConfirm` | Skip confirmation prompts |

**Configuration:** `commands.git.reset.noConfirm`, `defaults.noConfirm`

---

### `lt git undo`

Undoes the last commit (keeps files).

**Usage:**
```bash
lt git undo [options]
```

**Options:**
| Option | Description |
|--------|-------------|
| `--noConfirm` | Skip confirmation prompts |

**Configuration:** `commands.git.undo.noConfirm`, `defaults.noConfirm`

---

### `lt git rename`

Renames the current branch.

**Usage:**
```bash
lt git rename <new-name> [options]
```

**Options:**
| Option | Description |
|--------|-------------|
| `--noConfirm` | Skip confirmation prompts |
| `--deleteRemote` | Delete remote branch after rename |

**Configuration:** `commands.git.rename.noConfirm`, `defaults.noConfirm`

---

### `lt git update`

Updates the current branch (fetch + pull).

**Usage:**
```bash
lt git update
```

---

### `lt git clean`

Removes local merged branches.

**Usage:**
```bash
lt git clean
```

---

## Fullstack Commands

### `lt fullstack init`

Creates a new fullstack workspace with API and frontend.

**Usage:**
```bash
lt fullstack init [options]
```

**Options:**
| Option | Description |
|--------|-------------|
| `--name <name>` | Project name |
| `--frontend <type>` | Frontend framework: `angular` or `nuxt` |
| `--git` | Initialize git repository |
| `--git-link <url>` | Git repository URL |

**Configuration:** `commands.fullstack.*`

---

## Deployment Commands

### `lt deployment create`

Creates deployment configuration for a monorepo.

**Usage:**
```bash
lt deployment create [name] [options]
```

**Options:**
| Option | Description |
|--------|-------------|
| `--domain <domain>` | Main domain for the project |
| `--gitHub` | Enable GitHub pipeline |
| `--gitLab` | Enable GitLab pipeline |
| `--testRunner <tag>` | GitLab test runner tag |
| `--prodRunner <tag>` | GitLab production runner tag |

**Configuration:** `commands.deployment.*`, `defaults.domain`

---

## NPM Commands

### `lt npm reinit`

Reinitializes npm packages (removes node_modules and reinstalls).

**Usage:**
```bash
lt npm reinit [options]
```

**Options:**
| Option | Description |
|--------|-------------|
| `--update` / `-u` | Update package.json before reinstall |
| `--noConfirm` | Skip confirmation prompts |

**Configuration:** `commands.npm.reinit.*`, `defaults.noConfirm`

---

### `lt npm update`

Updates npm packages.

**Usage:**
```bash
lt npm update
```

---

## Frontend Commands

### `lt frontend angular`

Creates a new Angular workspace.

**Usage:**
```bash
lt frontend angular [name]
```

---

### `lt frontend nuxt`

Creates a new Nuxt workspace.

**Usage:**
```bash
lt frontend nuxt
```

---

## Config Commands

### `lt config init`

Creates a new `lt.config` file interactively.

**Usage:**
```bash
lt config init [options]
```

**Options:**
| Option | Description |
|--------|-------------|
| `--format <type>` | File format: `json` or `yaml` |
| `--controller <type>` | Default controller type |
| `--frontend <type>` | Default frontend framework |
| `--interactive <bool>` | Enable/disable interactive mode |

---

### `lt config show`

Displays the merged configuration for the current directory.

**Usage:**
```bash
lt config show
```

---

### `lt config help`

Shows help for the configuration system.

**Usage:**
```bash
lt config help
```

---

## Other Commands

### `lt update`

Updates the lt CLI to the latest version.

**Usage:**
```bash
lt update
```

---

### `lt docs open`

Opens documentation in the browser.

**Usage:**
```bash
lt docs open [doc]
```

**Arguments:**
- `lenne.Tech` - lenne.Tech documentation
- `NestJS` - NestJS documentation
- `GlueGun` - GlueGun documentation

---

### `lt tools crypt`

Generates a password hash.

**Usage:**
```bash
lt tools crypt [password]
```

---

## Configuration Priority

All configurable commands follow this priority order (highest to lowest):

1. **Interactive user input** (if enabled)
2. **CLI parameters** (e.g., `--noConfirm`)
3. **Command-specific config** (e.g., `commands.git.get.noConfirm`)
4. **Category-level config** (e.g., `commands.git.noConfirm`)
5. **Global defaults** (e.g., `defaults.noConfirm`)
6. **Code defaults**

For detailed configuration options, see [lt.config.md](./lt.config.md).
