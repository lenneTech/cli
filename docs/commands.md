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
- [Utility Commands](#utility-commands)
- [Database Commands](#database-commands)
- [TypeScript Commands](#typescript-commands)
- [Starter Commands](#starter-commands)
- [Claude Commands](#claude-commands)
- [Blocks & Components](#blocks--components)
- [Template Commands](#template-commands)
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

### `lt cli rename`

Renames the current CLI project.

**Usage:**
```bash
lt cli rename <new-name>
```

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
| `--branch <branch>` / `-b` | Branch of nest-server-starter to use as template |
| `--copy <path>` / `-c` | Copy from local template directory instead of cloning |
| `--link <path>` | Symlink to local template directory (fastest, changes affect original) |
| `--git` | Initialize git repository |
| `--noConfirm` | Skip confirmation prompts |

**Configuration:** `commands.server.create.*`, `defaults.author`, `defaults.noConfirm`

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
| `--noConfirm` | Skip confirmation prompts |
| `--skipLint` | Skip lint fix after creation |

**Configuration:** `commands.server.module.*`, `defaults.controller`, `defaults.skipLint`, `defaults.noConfirm`

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

### `lt server create-secret`

Creates a random secret key.

**Usage:**
```bash
lt server create-secret
```

---

### `lt server set-secrets`

Sets secrets in environment files.

**Usage:**
```bash
lt server set-secrets [options]
```

---

### `lt server test`

Runs server tests.

**Usage:**
```bash
lt server test
```

---

## Git Commands

All git commands support the `--noConfirm` flag and can be configured via `defaults.noConfirm` or `commands.git.noConfirm`.

**Commands with `--dry-run` support:** create, update, clear, force-pull, reset, undo, clean, squash, rebase, rename - preview changes without executing them.

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
| `--noConfirm` | Skip confirmation prompts |
| `--dry-run` | Preview what would be created without making changes |

**Configuration:** `commands.git.create.base`, `commands.git.baseBranch`, `defaults.baseBranch`

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
| `--dry-run` | Preview commits that would be squashed |
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
| `--dry-run` | Preview commits that would be rebased |
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
| `--dry-run` | Preview what would be discarded |

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
| `--dry-run` | Preview what would be lost |

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
| `--dry-run` | Preview what would be reset |

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
| `--dry-run` | Preview the commit that would be undone |

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
| `--dry-run` | Preview the rename operation |
| `--deleteRemote` | Delete remote branch after rename |

**Configuration:** `commands.git.rename.noConfirm`, `defaults.noConfirm`

---

### `lt git update`

Updates the current branch (fetch + pull + npm install).

**Usage:**
```bash
lt git update [options]
```

**Options:**
| Option | Description |
|--------|-------------|
| `--skipInstall` | Skip npm install after update |
| `--dry-run` | Preview incoming commits without making changes |

**Configuration:** `commands.git.update.skipInstall`, `defaults.skipInstall`

---

### `lt git clean`

Removes local merged branches.

**Usage:**
```bash
lt git clean [options]
```

**Options:**
| Option | Description |
|--------|-------------|
| `--noConfirm` | Skip confirmation prompts |
| `--dry-run` | Preview which branches would be deleted |

**Configuration:** `commands.git.clean.noConfirm`, `defaults.noConfirm`

---

### `lt git install-scripts`

Installs bash scripts for git operations to `~/.local/bin/`.

**Usage:**
```bash
lt git install-scripts
```

Installs helper scripts:
- `git-squash` - Squash commits
- `git-rebase` - Rebase branch
- `git-clear` - Clear changes
- `git-force-pull` - Force pull
- etc.

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
| `--api-branch <branch>` | Branch of nest-server-starter to use for API |
| `--api-copy <path>` | Copy API from local template directory |
| `--api-link <path>` | Symlink API to local template (fastest, changes affect original) |
| `--frontend-branch <branch>` | Branch of frontend starter to use (ng-base-starter or nuxt-base-starter) |
| `--frontend-copy <path>` | Copy frontend from local template directory |
| `--frontend-link <path>` | Symlink frontend to local template (fastest, changes affect original) |
| `--git` | Initialize git repository |
| `--git-link <url>` | Git repository URL |
| `--noConfirm` | Skip confirmation prompts |

**Note:** For Nuxt frontends with `--frontend-copy` or `--frontend-link`, specify the path to the `nuxt-base-template/` subdirectory, not the repository root.

**Configuration:** `commands.fullstack.*`, `defaults.noConfirm`

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
| `--noConfirm` | Skip confirmation prompts |

**Configuration:** `commands.deployment.*`, `defaults.domain`, `defaults.noConfirm`

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

Creates a new Angular workspace using ng-base-starter.

**Usage:**
```bash
lt frontend angular [name] [options]
```

**Options:**
| Option | Description |
|--------|-------------|
| `--branch <branch>` / `-b` | Branch of ng-base-starter to use as template |
| `--copy <path>` / `-c` | Copy from local template directory instead of cloning |
| `--link <path>` | Symlink to local template directory (fastest, changes affect original) |
| `--localize` | Enable Angular localize |
| `--noLocalize` | Disable Angular localize |
| `--gitLink <url>` | Git repository URL to link |
| `--noConfirm` / `-y` | Skip confirmation prompts |

**Configuration:** `commands.frontend.angular.*`, `defaults.noConfirm`

---

### `lt frontend nuxt`

Creates a new Nuxt workspace using nuxt-base-starter.

**Usage:**
```bash
lt frontend nuxt [options]
```

**Options:**
| Option | Description |
|--------|-------------|
| `--branch <branch>` / `-b` | Branch of nuxt-base-starter to use (uses git clone instead of create-nuxt-base) |
| `--copy <path>` / `-c` | Copy from local template directory instead of cloning |
| `--link <path>` | Symlink to local template directory (fastest, changes affect original) |

**Note:** For `--copy` and `--link`, specify the path to the `nuxt-base-template/` subdirectory, not the repository root:
```bash
lt frontend nuxt --copy /path/to/nuxt-base-starter/nuxt-base-template
```

**Configuration:** `commands.frontend.nuxt.*`

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
| `--noConfirm` | Skip confirmation prompts (overwrite existing) |

**Configuration:** `commands.config.init.noConfirm`, `defaults.noConfirm`

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

### `lt config validate`

Validates the current `lt.config` file.

**Usage:**
```bash
lt config validate
```

Reports syntax errors, type mismatches, and unknown keys.

---

## Utility Commands

### `lt status`

Shows project status and context.

**Usage:**
```bash
lt status
```

Displays:
- Project type detection (nest-server, nuxt, angular, etc.)
- Package information
- Git branch and repository status
- Configuration file status
- Available commands for the project type

---

### `lt doctor`

Diagnoses common development environment issues.

**Usage:**
```bash
lt doctor [options]
```

**Options:**
| Option | Description |
|--------|-------------|
| `--fix` | Attempt automatic fixes |

Checks:
- Node.js version
- npm version
- Git installation
- lt CLI version and updates
- Project configuration
- Dependencies installation

---

### `lt history`

Views and manages command history.

**Usage:**
```bash
lt history [count]
lt history search <pattern>
lt history clear
```

**Arguments:**
- `count` - Number of recent commands to show (default: 20)
- `search <pattern>` - Search history for matching commands
- `clear` - Clear command history

**Options:**
| Option | Description |
|--------|-------------|
| `--noConfirm` | Skip confirmation when clearing |

---

### `lt completion`

Generates and installs shell completion scripts.

**Usage:**
```bash
lt completion install         # Install completions (recommended)
lt completion <bash|zsh|fish> # Output completion script
```

**How it works:**
- Generates **static completion files** at install time (no runtime overhead)
- Completions are **auto-updated** when CLI is installed/updated
- Files are loaded once at shell startup

**Installation:**
```bash
# Automatic (recommended)
lt completion install

# Manual (if needed)
lt completion bash > ~/.local/share/lt/completions/lt.bash
lt completion zsh > ~/.local/share/lt/completions/_lt
lt completion fish > ~/.config/fish/completions/lt.fish
```

**Completion file locations:**
- Bash: `~/.local/share/lt/completions/lt.bash`
- Zsh: `~/.local/share/lt/completions/_lt`
- Fish: `~/.config/fish/completions/lt.fish`

---

### `lt templates list`

Lists available templates.

**Usage:**
```bash
lt templates list
```

Shows:
- Built-in templates
- Custom templates (~/.lt/templates)
- Project templates (./lt-templates)

---

## Database Commands

### `lt mongodb collection-export`

Exports a MongoDB collection to JSON file.

**Usage:**
```bash
lt mongodb collection-export [options]
```

**Options:**
| Option | Description |
|--------|-------------|
| `--mongoUri <uri>` | MongoDB connection URI |
| `--database <name>` | Database name |
| `--collection <name>` | Collection name |
| `--output <path>` | Output file path |

---

### `lt mongodb s3-restore`

Restores a MongoDB database from an S3 backup.

**Usage:**
```bash
lt mongodb s3-restore [options]
```

**Options:**
| Option | Description |
|--------|-------------|
| `--bucket <name>` | S3 bucket name |
| `--key <key>` | S3 access key ID |
| `--secret <secret>` | S3 secret access key |
| `--url <url>` | S3 endpoint URL |
| `--region <region>` | S3 region |
| `--folder <folder>` | S3 folder/prefix |
| `--mongoUri <uri>` | MongoDB connection URI |
| `--database <name>` | Target database name |

---

### `lt qdrant stats`

Shows statistics for Qdrant collections.

**Usage:**
```bash
lt qdrant stats
```

---

### `lt qdrant delete`

Deletes a Qdrant collection.

**Usage:**
```bash
lt qdrant delete
```

---

## TypeScript Commands

### `lt typescript create`

Creates a new TypeScript project.

**Usage:**
```bash
lt typescript create [name] [options]
```

**Options:**
| Option | Description |
|--------|-------------|
| `--author <name>` | Author name |
| `--noConfirm` | Skip confirmation prompts |
| `--updatePackages` | Update packages to latest versions |

**Configuration:** `commands.typescript.create.*`, `defaults.author`, `defaults.noConfirm`

---

### `lt typescript playground`

Opens TypeScript playground.

**Usage:**
```bash
lt typescript playground
```

---

## Starter Commands

### `lt starter chrome-extension`

Creates a Chrome extension project.

**Usage:**
```bash
lt starter chrome-extension [name]
```

---

## Claude Commands

### `lt claude plugins`

Manages Claude Code plugins.

**Usage:**
```bash
lt claude plugins
```

Lists and manages installed Claude Code plugins.

---

## Blocks & Components

### `lt blocks add`

Adds code blocks to your project from the lenne.tech component library.

**Usage:**
```bash
lt blocks add [block-name] [options]
```

**Options:**
| Option | Description |
|--------|-------------|
| `--noConfirm` | Skip confirmation prompts (auto-install dependencies) |

**Configuration:** `commands.blocks.add.noConfirm`, `defaults.noConfirm`

---

### `lt components add`

Adds components to your project from the lenne.tech component library.

**Usage:**
```bash
lt components add [component-name] [options]
```

**Options:**
| Option | Description |
|--------|-------------|
| `--noConfirm` | Skip confirmation prompts (auto-install dependencies) |

**Configuration:** `commands.components.add.noConfirm`, `defaults.noConfirm`

---

## Template Commands

### `lt templates llm`

Gets LLM prompt templates.

**Usage:**
```bash
lt templates llm [prompt-name] [options]
```

**Options:**
| Option | Description |
|--------|-------------|
| `--output <path>` / `-o` | Save to file |
| `--clipboard` / `-c` | Copy to clipboard |
| `--display` / `-d` | Display in terminal |

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

### `lt tools sha256`

Generates a SHA256 hash.

**Usage:**
```bash
lt tools sha256 [text]
```

---

### `lt tools jwt-read`

Reads and decodes a JWT token.

**Usage:**
```bash
lt tools jwt-read [token]
```

---

### `lt tools regex`

Tests regular expressions.

**Usage:**
```bash
lt tools regex [pattern] [text]
```

---

## Configuration Priority

All configurable commands follow this priority order (highest to lowest):

1. **CLI parameters** (e.g., `--noConfirm`)
2. **Command-specific config** (e.g., `commands.git.get.noConfirm`)
3. **Category-level config** (e.g., `commands.git.noConfirm`)
4. **Global defaults** (e.g., `defaults.noConfirm`)
5. **Code defaults**
6. **Interactive user input** (only if no value determined from above)

For detailed configuration options, see [lt.config.md](./lt.config.md).
