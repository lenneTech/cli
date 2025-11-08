---
name: lt-cli-examples
version: 1.0.0
description: Real-world examples for Git operations and Fullstack initialization with lenne.tech CLI
---

# LT CLI Examples

⚠️ **Note**: For NestJS server examples (modules, objects, properties), see the **nest-server-generator skill** instead.

This file contains examples for:
- Git operations (`lt git get`, `lt git reset`)
- Fullstack initialization (`lt fullstack init`)

---

## Git Operations

### 1. Branch Management

#### Switching to Existing Branch
```bash
# Switch to existing branch DEV-123
lt git get DEV-123
```

**What happens:**
1. Checks if `DEV-123` exists locally
2. Switches to branch `DEV-123`

#### Creating New Branch
```bash
# Create and switch to new branch feature/new-authentication
lt git get feature/new-authentication
```

**What happens:**
1. Checks if `feature/new-authentication` exists locally (not found)
2. Checks if it exists on remote (not found)
3. Creates new branch `feature/new-authentication` from current branch
4. Switches to the new branch

#### Checking Out Remote Branch
```bash
# Checkout branch that exists on remote but not locally
lt git get DEV-456
```

**What happens:**
1. Checks if `DEV-456` exists locally (not found)
2. Checks if it exists on remote (found!)
3. Checks out `DEV-456` and sets up tracking to `origin/DEV-456`
4. Switches to the branch

#### Using Alias
```bash
# Same as "lt git get" but shorter
lt git g DEV-789
```

---

### 2. Workflow Scenarios

#### Start New Feature Development
```bash
# You're on main branch, start working on new ticket
git status  # Verify clean working tree
lt git get DEV-234  # Create and switch to new feature branch

# Do your work...
git add .
git commit -m "Implement feature"
git push -u origin DEV-234
```

#### Switch Between Tickets
```bash
# Working on DEV-123, need to switch to urgent DEV-456
git status  # Check for uncommitted changes
git stash   # Save work in progress
lt git get DEV-456  # Switch to urgent ticket

# Fix urgent issue...
git add .
git commit -m "Fix urgent bug"
git push

# Return to original work
lt git get DEV-123
git stash pop  # Restore work in progress
```

#### Sync with Remote Branch
```bash
# Someone else created branch DEV-789 on remote
lt git get DEV-789  # Automatically checks out and tracks remote branch

# Verify tracking
git status
# Output: "Your branch is up to date with 'origin/DEV-789'"
```

---

### 3. Reset Operations

#### Discard All Local Changes
```bash
# Your local changes are broken, start fresh from remote
git status  # See what will be discarded

lt git reset
# Prompts: "Reset current branch to origin/<branch>? This will discard all local changes. (y/N)"
# Type: y

# Your branch now matches remote exactly
```

**⚠️ WARNING**: This is destructive! All local commits and changes are permanently lost.

#### When to Use Reset

**Use Case 1**: Experimental work failed
```bash
# You tried something, it didn't work, want clean slate
git status  # Shows many broken changes
lt git reset  # Start over from remote
```

**Use Case 2**: Merge conflict too complex
```bash
# Merge created complex conflicts, easier to start over
git merge main  # Conflict!
# ... attempt to resolve, too complicated
git merge --abort
lt git reset  # Get clean state
# Now merge again or use different approach
```

**Use Case 3**: Accidental commits on wrong branch
```bash
# Made commits on main instead of feature branch
git log  # See unwanted commits
lt git reset  # Discard commits, return to clean main
lt git get DEV-123  # Switch to correct branch
# Re-do work properly
```

---

### 4. Common Patterns

#### Daily Development Workflow
```bash
# Morning: Start work on ticket
lt git get main          # Switch to main
git pull                 # Get latest changes
lt git get DEV-567       # Create/switch to ticket branch

# During day: Regular commits
git add .
git commit -m "Progress on feature"
git push -u origin DEV-567  # First push sets upstream

# End of day: Push progress
git add .
git commit -m "WIP: End of day checkpoint"
git push
```

#### Handling Mistakes
```bash
# Scenario: Committed to wrong branch
git log -1               # See the wrong commit
git stash                # Stash any uncommitted work
lt git reset             # Reset to clean state
lt git get DEV-999       # Switch to correct branch
git stash pop            # Restore work
# Now commit on correct branch
```

#### Code Review Feedback
```bash
# Reviewer asked for changes on PR branch
lt git get DEV-333       # Switch to PR branch
git pull                 # Get latest
# Make requested changes
git add .
git commit -m "Address PR feedback"
git push
```

---

## Fullstack Project Initialization

### 1. Angular Projects

#### Production Angular App with Git
```bash
lt fullstack init \
  --name MyAngularApp \
  --frontend angular \
  --git true \
  --git-link https://github.com/myorg/my-angular-app.git
```

**Creates:**
```
MyAngularApp/
├── frontend/              # Angular 18+ application
│   ├── src/
│   ├── angular.json
│   └── package.json
├── projects/
│   └── api/              # NestJS backend (@lenne.tech/nest-server)
│       ├── src/
│       │   └── server/
│       │       ├── modules/
│       │       └── common/
│       └── package.json
├── package.json          # Root workspace config
├── .gitignore
└── .git/                 # Initialized with remote
```

**Next steps:**
```bash
cd MyAngularApp
npm install              # Install all dependencies
cd projects/api && npm start  # Start backend (port 3000)
# In another terminal:
cd frontend && npm start      # Start frontend (port 4200)
```

#### Local Development Angular App
```bash
lt fullstack init \
  --name LocalDevApp \
  --frontend angular \
  --git false
```

**Use case:** Quick prototyping, learning, no version control needed

---

### 2. Nuxt Projects

#### Production Nuxt App with Git
```bash
lt fullstack init \
  --name MyNuxtApp \
  --frontend nuxt \
  --git true \
  --git-link https://github.com/myorg/my-nuxt-app.git
```

**Creates:**
```
MyNuxtApp/
├── frontend/              # Nuxt 3 application
│   ├── pages/
│   ├── components/
│   ├── nuxt.config.ts
│   └── package.json
├── projects/
│   └── api/              # NestJS backend
│       └── ...
├── package.json
├── .gitignore
└── .git/
```

#### Nuxt App without Remote
```bash
lt fullstack init \
  --name MyNuxtProject \
  --frontend nuxt \
  --git true
  # No --git-link, git initialized but no remote
```

**Use case:** Start project locally, add remote later

**Add remote later:**
```bash
cd MyNuxtProject
git remote add origin https://github.com/myorg/my-nuxt-project.git
git push -u origin main
```

---

### 3. Project Types

#### Client Project (Angular + NestJS)
```bash
lt fullstack init \
  --name ClientPortal \
  --frontend angular \
  --git true \
  --git-link https://github.com/client/portal.git

# After creation:
cd ClientPortal/projects/api

# Add authentication module
lt server module --name User --controller Both \
  --prop-name-0 email --prop-type-0 string \
  --prop-name-1 password --prop-type-1 string

# Add business logic modules
# ... (use nest-server-generator skill for this)
```

#### Internal Tool (Nuxt + NestJS)
```bash
lt fullstack init \
  --name InternalDashboard \
  --frontend nuxt \
  --git true \
  --git-link https://github.com/company/internal-dashboard.git

# Quick setup for internal tools with Nuxt's flexibility
```

#### Learning/Tutorial Project
```bash
lt fullstack init \
  --name LearningFullstack \
  --frontend angular \
  --git false

# No git overhead, just focus on learning
```

---

### 4. Post-Creation Workflows

#### After Angular Fullstack Init
```bash
cd MyAngularApp
npm install

# Terminal 1: Start backend
cd projects/api
npm start
# API runs on http://localhost:3000

# Terminal 2: Start frontend
cd frontend
npm start
# Frontend runs on http://localhost:4200
# Auto-proxies API calls to backend

# Terminal 3: Development
cd projects/api
# Generate server modules using nest-server-generator skill
```

#### After Nuxt Fullstack Init
```bash
cd MyNuxtApp
npm install

# Terminal 1: Start backend
cd projects/api
npm start
# API runs on http://localhost:3000

# Terminal 2: Start frontend
cd frontend
npm run dev
# Frontend runs on http://localhost:3000 (or 3001 if 3000 taken)

# Configure proxy in nuxt.config.ts if needed
```

---

### 5. Common Initialization Patterns

#### Team Project Setup
```bash
# Lead developer initializes project
lt fullstack init \
  --name TeamProject \
  --frontend angular \
  --git true \
  --git-link https://github.com/team/team-project.git

cd TeamProject
npm install
# ... initial setup, create base modules
git add .
git commit -m "Initial project setup"
git push -u origin main

# Team members clone
# git clone https://github.com/team/team-project.git
# cd team-project
# npm install
```

#### Monorepo with Multiple Projects
```bash
# Create first project
lt fullstack init --name ProjectA --frontend angular --git true

# Create second project
lt fullstack init --name ProjectB --frontend nuxt --git true

# Each has its own git repository, npm workspace, and backend
```

#### Migration from Existing Backend
```bash
# Create fullstack project
lt fullstack init \
  --name MigratedApp \
  --frontend angular \
  --git true

cd MigratedApp/projects

# Remove generated api
rm -rf api

# Clone existing backend
git clone https://github.com/company/existing-api.git api

# Update root package.json workspace paths if needed
```

---

## Troubleshooting Examples

### Git Branch Issues

#### Branch Exists But Can't Switch
```bash
# Problem: Uncommitted changes
git status
# Output: "Changes not staged for commit..."

# Solution 1: Stash changes
git stash
lt git get DEV-123
git stash pop

# Solution 2: Commit changes
git add .
git commit -m "WIP: Save progress"
lt git get DEV-123
```

#### Reset Fails
```bash
# Problem: No remote branch
lt git reset
# Error: "Remote branch not found"

# Solution: Check remote
git branch -r  # List remote branches
git remote -v  # Verify remote URL

# If remote missing, add it
git remote add origin https://github.com/user/repo.git
git fetch origin
lt git reset  # Try again
```

### Fullstack Init Issues

#### Permission Denied
```bash
# Problem: Can't create directory
lt fullstack init --name MyApp --frontend angular --git false
# Error: "Permission denied"

# Solution: Check permissions
ls -la .
# Create in home directory or with sudo
cd ~
lt fullstack init --name MyApp --frontend angular --git false
```

#### Git Remote Already Exists
```bash
# Problem: Directory already has .git
lt fullstack init --name ExistingDir --frontend nuxt --git true
# Error: "Directory already initialized with git"

# Solution: Use different directory or remove .git
rm -rf ExistingDir/.git
lt fullstack init --name ExistingDir --frontend nuxt --git true
```

---

## Using Alias Commands

All commands have shorter aliases:

```bash
# Full commands
lt git get DEV-123
lt fullstack init --name MyApp --frontend angular --git true

# With aliases
lt git g DEV-123
lt full init --name MyApp --frontend angular --git true
```

---

## Best Practices

### Git Operations
1. **Always check status first**: `git status` before switching branches
2. **Save work before switching**: Commit or stash uncommitted changes
3. **Be cautious with reset**: It's destructive and irreversible
4. **Use meaningful branch names**: Follow team conventions (DEV-123, feature/xyz)

### Fullstack Initialization
1. **Choose frontend wisely**: Angular for enterprise, Nuxt for flexibility
2. **Enable git from start**: Use `--git true` for all real projects
3. **Follow naming conventions**: PascalCase for project names
4. **Read generated READMEs**: Each project has setup instructions
5. **Install dependencies immediately**: Run `npm install` after creation

---

## Reference

For detailed command syntax and all available options, see [reference.md](reference.md).

For NestJS server development examples, use the **nest-server-generator skill**.
