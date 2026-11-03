# lt on native Windows

The lt stack runs natively on Windows 10/11: PowerShell, no WSL. This page is the reference for setting up a
machine from zero. `scripts/windows/setup.ps1` does exactly these steps; change both together
(`__tests__/windows-setup-script.test.ts` checks that every package the script installs is named here).

Use **Windows Terminal** (preinstalled on Windows 11) with PowerShell. Both Windows PowerShell 5.1 and
PowerShell 7 work. Git Bash is not the shell for `lt`: its mintty terminal does not present a console
to Node.js (`process.stdin.isTTY` is false), so interactive prompts are unreliable there.

## Quick setup

Open PowerShell (not as administrator) and run:

```powershell
irm https://raw.githubusercontent.com/lenneTech/cli/main/scripts/windows/setup.ps1 | iex
```

`irm | iex` is not subject to the execution policy, so this works on a fresh machine where `npm` and
`lt` are still blocked. The script is idempotent: run it again at any time, it only does what is still
missing, and ends with `lt doctor`. The Git, Node.js, GitHub CLI and MongoDB installers are machine-wide, so
expect up to four UAC prompts. It asks for your name and e-mail for git commits if they are not set yet.

Then open a **new** terminal, so it picks up the new PATH.

## Manual setup

The same steps by hand, in this order.

### 1. Execution policy

A fresh Windows blocks every `.ps1` script, and `npm`, `pnpm` and `lt` are started through `.ps1`
shims. Allow local and signed scripts for your user (no admin rights needed):

```powershell
Set-ExecutionPolicy -Scope CurrentUser RemoteSigned
```

If Group Policy enforces a stricter policy, call the `.cmd` shims instead: `npm.cmd`, `pnpm.cmd`, `lt.cmd`.

### 2. Tools

```powershell
winget install --id Git.Git -e --source winget
winget install --id OpenJS.NodeJS.LTS -e --source winget
winget install --id CaddyServer.Caddy -e --source winget
winget install --id GitHub.cli -e --source winget
winget install --id MongoDB.Server -e --source winget
```

- Caddy serves the HTTPS URLs of `lt dev` (`https://<project>.localhost`). `lt dev` starts it itself.
- GitHub CLI (`gh`) is what `/lt-dev:ticket-cycle` uses to open, watch and merge pull requests. Log in
  once: `gh auth login --web --git-protocol https`. For a GitLab project install
  `winget install --id GLab.GLab -e --source winget` instead and log in with `glab auth login`.
- MongoDB installs as the Windows service "MongoDB Server" and listens on `127.0.0.1:27017`. No
  Docker is needed. Check with `Get-Service MongoDB`.

Open a new terminal afterwards: installers change PATH for new windows only.

### 3. Git settings

```powershell
git config --global core.autocrlf input
git config --global user.name "Your Name"
git config --global user.email "you@example.com"
```

- **Line endings: `input`** (in the Git installer: "Checkout as-is, commit Unix-style line endings").
  Git never converts to CRLF on checkout and normalizes to LF on commit. The lenne.tech repositories
  enforce LF through `.gitattributes` anyway; this setting protects repositories without one, where
  CRLF breaks shell scripts and formatter checks. Team decision, DEV-3320.
- **Identity:** `lt fullstack init` commits the new project and stops right after cloning when git
  has no identity. `lt doctor` checks it.

### 4. pnpm and the lt CLI

```powershell
npm install -g pnpm
npm install -g "@lenne.tech/cli"
```

Quote the package name: without quotes PowerShell reads the leading `@` as an operator.

npm may warn that install scripts are "not yet covered by allowScripts". For lt that is harmless: its
native dependency ships prebuilt binaries, and the skipped script only sets up bash/zsh completion,
which PowerShell does not use.

If `lt` is not found in a new terminal, the npm global folder is missing from PATH. `npm prefix -g`
prints it (usually `%APPDATA%\npm`); add it to the user PATH.

### 5. Claude Code

```powershell
irm https://claude.ai/install.ps1 | iex
```

### 6. Console

Turn off QuickEdit for the classic console window, or use Windows Terminal, where it does not apply:

```powershell
New-ItemProperty -Path HKCU:\Console -Name QuickEdit -Value 0 -PropertyType DWord -Force
```

With QuickEdit on, a single click into the window freezes the running command without any message,
until Enter is pressed. That looked like a hanging `lt` for days and was not one.

### 7. Check

```powershell
lt doctor
```

## First project

```powershell
lt fullstack init --name my-project --frontend nuxt --api-mode Rest --noConfirm
cd my-project
lt dev up
```

`lt fullstack init` checks git, pnpm and the git identity before it starts. `lt dev up` prints the
project's URLs (`https://my-project.localhost`, `https://api.my-project.localhost`).

## Known differences from macOS

Measured on Windows hardware during DEV-3320:

- **`curl` is not curl** in Windows PowerShell 5.1 but an alias of `Invoke-WebRequest`. Write
  `curl.exe` in instructions and scripts.
- **`*.localhost` resolves in the browser only.** Chromium resolves it internally, the system resolver
  does not. Anything that asks from Node or a shell has to use `127.0.0.1`; `lt` does that for its own
  probes.
- **Stopping is a hard kill.** `taskkill` without `/F` stops nothing and leaves the port bound, so
  `lt dev down` uses `taskkill /T /F`. Shutdown hooks of the application do not run on Windows.
- **The legacy console flickers** while moving through the `lt` menu. Windows Terminal does not.
- **Yes/no prompts** did not take the input reliably in the Windows test of 2026-10-28. Which terminal
  that was is still being narrowed down. Until then: Windows Terminal with PowerShell, and `--noConfirm`
  plus explicit flags where a command offers them.
