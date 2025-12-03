---
name: lt-cli-reference
version: 1.0.0
description: Quick reference for Git operations and Fullstack initialization commands
---

# LT CLI Quick Reference

⚠️ **Note**: For NestJS server command reference (modules, objects, properties), see the **nest-server-generator skill** instead.

## Table of Contents
- [Command Cheat Sheet](#command-cheat-sheet)
- [Git Commands Reference](#git-commands-reference)
- [Fullstack Commands Reference](#fullstack-commands-reference)
- [Common Patterns](#common-patterns)
- [Troubleshooting](#troubleshooting)
- [Best Practices](#best-practices)
- [Quick Tips](#quick-tips)
- [Related Commands](#related-commands)
- [References](#references)

---

## Command Cheat Sheet

### Git Commands

#### Get Branch (Checkout/Create)
```bash
# Interactive (prompts for branch name)
lt git get
lt git g

# Non-interactive
lt git get <branch-name>
lt git g <branch-name>
```

**Parameters:**
- `<branch-name>`: Branch name to checkout/create

**What it does:**
1. Checks if branch exists locally → switches to it
2. If not local, checks remote → checks out and tracks
3. If neither exists → creates new branch from current

**Examples:**
```bash
lt git get DEV-123
lt git get feature/new-auth
lt git g main
```

#### Reset to Remote
```bash
# Interactive (prompts for confirmation)
lt git reset

# Prompts: "Reset current branch to origin/<branch>? (y/N)"
```

**What it does:**
1. Fetches latest from remote
2. Resets current branch to `origin/<current-branch>`
3. Discards ALL local changes and commits

**⚠️ WARNING**: Destructive operation - cannot be undone!

---

### Fullstack Commands

#### Initialize Fullstack Workspace
```bash
# Interactive (prompts for all options)
lt fullstack init
lt full init

# Non-interactive
lt fullstack init \
  --name <WorkspaceName> \
  --frontend <angular|nuxt> \
  --git <true|false> \
  [--git-link <GitURL>]
```

**Required Parameters:**
- `--name`: Workspace/project name (PascalCase recommended)
- `--frontend`: Frontend framework (`angular` or `nuxt`)
- `--git`: Initialize git repository (`true` or `false`)

**Optional Parameters:**
- `--git-link`: Git repository URL (only when `--git true`)

**Examples:**
```bash
# With git and remote
lt fullstack init \
  --name MyApp \
  --frontend angular \
  --git true \
  --git-link https://github.com/user/myapp.git

# Without git
lt fullstack init \
  --name TestProject \
  --frontend nuxt \
  --git false

# With git but no remote (add later)
lt fullstack init \
  --name LocalProject \
  --frontend angular \
  --git true
```

---

## Git Commands Reference

### lt git get

**Syntax:**
```bash
lt git get [branch-name]
```

**Aliases:**
- `lt git g`

**Behavior:**

| Scenario | Action |
|----------|--------|
| Branch exists locally | Switches to branch |
| Branch exists on remote only | Checks out and tracks remote branch |
| Branch doesn't exist anywhere | Creates new branch from current |

**Common Usage:**
```bash
# Start new feature
lt git get DEV-456           # Creates if doesn't exist

# Switch to existing branch
lt git get main              # Switches to main

# Checkout teammate's branch
lt git get feature/auth      # Checks out from remote if exists

# Short alias
lt git g DEV-789             # Same as "lt git get DEV-789"
```

**Equivalent Standard Git:**
```bash
# lt git get DEV-123 does:
git checkout DEV-123 2>/dev/null || \
  git checkout -b DEV-123 --track origin/DEV-123 2>/dev/null || \
  git checkout -b DEV-123
```

---

### lt git reset

**Syntax:**
```bash
lt git reset
```

**No parameters accepted** - always operates on current branch.

**Interactive Prompt:**
```
Reset current branch to origin/<branch>?
This will discard all local changes. (y/N)
```

**What Gets Discarded:**
- All uncommitted changes (staged and unstaged)
- All local commits not pushed to remote
- All untracked files (if any were added)

**When to Use:**
- Experimental work failed, want clean slate
- Merge conflicts too complex
- Accidentally committed to wrong branch
- Local branch corrupted

**When NOT to Use:**
- You want to keep any local changes
- You haven't pushed but commits are valuable
- Branch has no remote tracking

**Equivalent Standard Git:**
```bash
# lt git reset does:
git fetch origin
git reset --hard origin/<current-branch>
```

**Recovery (if you made a mistake):**
```bash
# IMMEDIATELY after reset, if you change your mind:
git reflog                   # Find commit before reset
git reset --hard HEAD@{1}    # Restore to that commit
```

---

## Fullstack Commands Reference

### lt fullstack init

**Syntax:**
```bash
lt fullstack init \
  --name <WorkspaceName> \
  --frontend <angular|nuxt> \
  --git <true|false> \
  [--git-link <GitURL>]
```

**Aliases:**
- `lt full init`

**Parameters:**

| Parameter | Type | Required | Options | Description |
|-----------|------|----------|---------|-------------|
| `--name` | string | Yes | - | Project name (PascalCase) |
| `--frontend` | string | Yes | `angular`, `nuxt` | Frontend framework |
| `--git` | boolean | Yes | `true`, `false` | Initialize git |
| `--git-link` | string | No | URL | Git repository URL |

**Created Structure:**
```
<workspace-name>/
├── frontend/              # Angular or Nuxt app
│   ├── src/              # (Angular) or pages/ (Nuxt)
│   ├── package.json
│   └── ...
├── projects/
│   └── api/              # NestJS backend (@lenne.tech/nest-server)
│       ├── src/
│       │   └── server/
│       │       ├── modules/
│       │       └── common/
│       ├── package.json
│       └── ...
├── package.json          # Root workspace config
├── .gitignore           # (if --git true)
└── .git/                # (if --git true)
```

**Post-Creation Setup:**
```bash
cd <workspace-name>
npm install                        # Install dependencies

# Terminal 1: Start backend
cd projects/api && npm start       # Runs on port 3000

# Terminal 2: Start frontend
cd frontend && npm start           # Angular: 4200, Nuxt: 3000/3001
```

**Git Remote Configuration:**

With `--git-link`:
```bash
# Remote automatically configured
git remote -v
# origin  https://github.com/user/repo.git (fetch)
# origin  https://github.com/user/repo.git (push)
```

Without `--git-link` (add later):
```bash
cd <workspace-name>
git remote add origin https://github.com/user/repo.git
git push -u origin main
```

---

## Common Patterns

### Git Workflows

#### Feature Development
```bash
# Start new feature
git checkout main
git pull
lt git get DEV-123

# Work...
git add .
git commit -m "Implement feature"
git push -u origin DEV-123
```

#### Switch Between Branches
```bash
# Save current work
git stash

# Switch branch
lt git get DEV-456

# Do urgent work...

# Return to original work
lt git get DEV-123
git stash pop
```

#### Discard Failed Work
```bash
# Work didn't go well
git status                  # See mess

# Start over from remote
lt git reset               # Clean slate
```

### Fullstack Initialization

#### Production Project
```bash
lt fullstack init \
  --name ProductionApp \
  --frontend angular \
  --git true \
  --git-link https://github.com/company/production-app.git

cd ProductionApp
npm install
# ... setup, create modules, commit, push
```

#### Local Development
```bash
lt fullstack init \
  --name LocalTest \
  --frontend nuxt \
  --git false

cd LocalTest
npm install
# ... quick testing without git overhead
```

---

## Troubleshooting

### Git Commands

#### "Branch not found" Error
```bash
# Problem: Typo in branch name
lt git get DEV-12345
# Error: Branch not found

# Solution: Check available branches
git branch -a               # List all branches
lt git get DEV-123          # Correct name
```

#### "Cannot reset" Error
```bash
# Problem: No remote tracking
lt git reset
# Error: No remote tracking branch

# Solution: Set up tracking
git branch -u origin/main   # Or appropriate branch
git fetch origin
lt git reset
```

#### Uncommitted Changes Block Switch
```bash
# Problem: Changes prevent switching
lt git get DEV-456
# Error: Your local changes... would be overwritten

# Solution 1: Stash
git stash
lt git get DEV-456
git stash pop

# Solution 2: Commit
git add .
git commit -m "WIP"
lt git get DEV-456
```

### Fullstack Init

#### Permission Denied
```bash
# Problem: No write permissions
lt fullstack init --name MyApp --frontend angular --git false
# Error: Permission denied

# Solution: Use writable directory
cd ~/projects
lt fullstack init --name MyApp --frontend angular --git false
```

#### Directory Already Exists
```bash
# Problem: Project name already used
lt fullstack init --name MyApp --frontend angular --git false
# Error: Directory already exists

# Solution: Use different name or remove directory
rm -rf MyApp
lt fullstack init --name MyApp --frontend angular --git false
```

#### Git Link Invalid
```bash
# Problem: Invalid git URL
lt fullstack init \
  --name MyApp \
  --frontend angular \
  --git true \
  --git-link invalid-url

# Solution: Use valid HTTPS or SSH URL
lt fullstack init \
  --name MyApp \
  --frontend angular \
  --git true \
  --git-link https://github.com/user/repo.git
```

---

## Best Practices

### Git Operations

**Branch Management:**
- ✅ Always run `git status` before switching branches
- ✅ Commit or stash changes before switching
- ✅ Use meaningful branch names (DEV-123, feature/xyz)
- ✅ Pull latest before creating feature branches
- ❌ Don't leave uncommitted changes when switching

**Reset Operations:**
- ✅ Verify what will be discarded with `git status` first
- ✅ Only reset when you're certain you want to discard everything
- ✅ Know that reset is irreversible (unless using reflog immediately)
- ❌ Don't reset if you have valuable local commits
- ❌ Don't reset without checking remote exists

### Fullstack Initialization

**Project Setup:**
- ✅ Use PascalCase for project names (MyProject, not my-project)
- ✅ Enable git for all real projects (`--git true`)
- ✅ Add git remote URL immediately with `--git-link`
- ✅ Run `npm install` right after creation
- ✅ Choose Angular for enterprise, Nuxt for flexibility
- ❌ Don't use git for quick throwaway tests
- ❌ Don't use spaces in project names

**Post-Creation:**
- ✅ Read generated README.md files
- ✅ Commit initial setup before making changes
- ✅ Set up CI/CD early
- ✅ Configure environment variables
- ❌ Don't commit .env files
- ❌ Don't modify generated structure without understanding it

---

## Quick Tips

1. **Use aliases**: `lt git g` instead of `lt git get`
2. **Stash is your friend**: `git stash` before branch switches
3. **Check status often**: `git status` before any git operation
4. **Reset is destructive**: Only use when certain
5. **PascalCase names**: `MyProject`, not `my_project` or `myproject`
6. **Git from start**: Use `--git true` for all real projects
7. **Track branches**: Let `lt git get` handle remote tracking
8. **Install immediately**: Run `npm install` after init
9. **Commit often**: Save work after each logical step
10. **Read READMEs**: Each generated project has setup instructions

---

## Related Commands

For NestJS server development commands, use the **nest-server-generator skill**:
- `lt server module` - Create modules
- `lt server object` - Create objects
- `lt server addProp` - Add properties

---

## References

- [lenne.tech CLI Documentation](https://github.com/lenneTech/cli)
- [Git Documentation](https://git-scm.com/doc)
- [NestJS Documentation](https://docs.nestjs.com)
- [Angular Documentation](https://angular.io/docs)
- [Nuxt Documentation](https://nuxt.com/docs)
