---
title: "lt CLI"
description: "The command line tool of the lenne.tech stack: create projects, generate code, run local dev stacks and prepare deployments."
navigation:
  title: "Overview"
---

`@lenne.tech/cli` (command `lt`) is the command line tool of the lenne.tech stack. It creates fullstack projects
from [lt-monorepo](https://github.com/lenneTech/lt-monorepo) with a
[nest-server](https://github.com/lenneTech/nest-server) API and a Nuxt or Angular app, generates modules and
objects, runs several projects side by side behind HTTPS URLs (`lt dev`) and prepares deployments.

## Installation

```bash
npm install -g @lenne.tech/cli
npm install -g pnpm@11   # lt fullstack init and lt dev run on pnpm 11
```

On Windows, one command sets up a machine from zero: see [Windows](./windows.md).

## Usage

```bash
lt                                        # menu mode
lt <command> (<subcommand>) (<parameter>) # command line mode
lt help                                   # list of commands
```

A few commands to start with:

```bash
lt doctor              # check your environment
lt status              # show the project status
lt completion install  # enable shell completions
```

## Pages

| Page | What it covers |
|---|---|
| [lenne.tech Fullstack Ecosystem](./LT-ECOSYSTEM-GUIDE.md) | How the CLI and the lt-dev Claude Code plugin work together, including the vendor-mode workflows |
| [Vendor-Mode Workflow](./VENDOR-MODE-WORKFLOW.md) | Step by step from npm mode to vendor mode, updates and rollback |
| [Command Reference](./commands.md) | Every command with its options and examples |
| [lt.config](./lt.config.md) | The configuration file with defaults per project or team |
| [Plugins](./plugins.md) | Extending lt with your own commands and toolbox extensions |
| [Windows](./windows.md) | Setting up a Windows machine from zero, and what differs from macOS |

Plugin and command helpers used inside the CLI come from
[`@lenne.tech/cli-plugin-helper`](https://github.com/lenneTech/cli-plugin-helper), an internal package that has no
section of its own.
