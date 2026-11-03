# lt stack setup for native Windows (PowerShell, no WSL).
#
# Run in a normal PowerShell window (not as administrator):
#
#   irm https://raw.githubusercontent.com/lenneTech/cli/main/scripts/windows/setup.ps1 | iex
#
# `irm | iex` is not subject to the execution policy, so this works on a fresh machine where
# `npm` and `lt` are still blocked. Every step is idempotent: run it again at any time, it only
# does what is still missing. Every step is also documented for doing it by hand in
# docs/windows.md. Change both together.
#
# Compatible with Windows PowerShell 5.1 (the default on Windows 10/11): no `&&`, no `??`, no
# ternary operator. Messages are ASCII only, because PowerShell 5.1 reads a downloaded .ps1
# without BOM as ANSI. No `exit` anywhere: under `iex` it would close the user's window.

function Install-LtStack {
    # 'Continue', not 'Stop': under 5.1, 'Stop' turns any stderr line of a native command
    # (git, npm, winget) into a terminating error. Failures are checked explicitly instead.
    $ErrorActionPreference = 'Continue'
    $ProgressPreference = 'SilentlyContinue'
    [Net.ServicePointManager]::SecurityProtocol = [Net.ServicePointManager]::SecurityProtocol -bor [Net.SecurityProtocolType]::Tls12

    $problems = New-Object System.Collections.Generic.List[string]

    function Write-Step([string]$Text) { Write-Host ''; Write-Host "==> $Text" -ForegroundColor Cyan }
    function Write-Ok([string]$Text) { Write-Host "    ok    $Text" -ForegroundColor Green }
    function Write-Note([string]$Text) { Write-Host "    note  $Text" -ForegroundColor Yellow }
    function Write-Fail([string]$Text) { Write-Host "    FAIL  $Text" -ForegroundColor Red; $problems.Add($Text) }

    # winget and the installers change PATH in the registry only; this session has to re-read it.
    function Update-SessionPath {
        $machine = [Environment]::GetEnvironmentVariable('Path', 'Machine')
        $user = [Environment]::GetEnvironmentVariable('Path', 'User')
        $env:Path = (@($machine, $user) | Where-Object { $_ }) -join ';'
    }

    function Test-Command([string]$Name) { return [bool](Get-Command $Name -ErrorAction SilentlyContinue) }

    function Add-UserPath([string]$Dir) {
        $current = [Environment]::GetEnvironmentVariable('Path', 'User')
        $entries = @($current -split ';' | Where-Object { $_ } | ForEach-Object { $_.TrimEnd('\') })
        if ($entries -contains $Dir.TrimEnd('\')) { return $false }
        [Environment]::SetEnvironmentVariable('Path', ((@($current, $Dir) | Where-Object { $_ }) -join ';'), 'User')
        Update-SessionPath
        return $true
    }

    function Install-WingetPackage([string]$Id, [string]$Label, [scriptblock]$IsInstalled) {
        if (& $IsInstalled) { Write-Ok "$Label already installed"; return }
        Write-Host "    installing $Label ($Id) ..."
        & winget install --id $Id --exact --source winget --silent --accept-package-agreements --accept-source-agreements
        $code = $LASTEXITCODE
        Update-SessionPath
        if (& $IsInstalled) { Write-Ok "$Label installed" }
        else { Write-Fail "${Label}: winget exit code $code, still not found. By hand: winget install --id $Id -e" }
    }

    function Test-Port([int]$Port) {
        $client = New-Object System.Net.Sockets.TcpClient
        try { $client.Connect('127.0.0.1', $Port); return $true } catch { return $false } finally { $client.Close() }
    }

    Write-Host 'lt stack setup for Windows' -ForegroundColor Cyan
    Write-Host 'Safe to run again; every step only does what is still missing.'

    if ($env:OS -ne 'Windows_NT') { Write-Fail 'This script is for Windows. On macOS/Linux see docs/windows.md for the equivalent steps.'; return }

    # 1. Execution policy: a fresh Windows blocks every .ps1, and npm/pnpm/lt are .ps1 shims.
    Write-Step 'PowerShell execution policy'
    $allowed = @('RemoteSigned', 'Unrestricted', 'Bypass')
    if ($allowed -contains [string](Get-ExecutionPolicy)) {
        Write-Ok "effective policy is $(Get-ExecutionPolicy)"
    } else {
        try { Set-ExecutionPolicy -Scope CurrentUser -ExecutionPolicy RemoteSigned -Force -ErrorAction Stop } catch { Write-Note $_.Exception.Message }
        if ($allowed -contains [string](Get-ExecutionPolicy)) { Write-Ok 'set to RemoteSigned for the current user (no admin rights needed)' }
        else { Write-Fail "policy is still $(Get-ExecutionPolicy), probably set by Group Policy. Use npm.cmd, pnpm.cmd and lt.cmd, or ask IT." }
    }

    # 2. winget, the installer for everything below.
    Write-Step 'winget'
    if (-not (Test-Command 'winget')) {
        Write-Fail 'winget is missing. Install "App Installer" from the Microsoft Store, then run this script again.'
        return
    }
    Write-Ok 'winget available'

    # 3. Tools. Git first: the others do not need it, but everything after this script does.
    Write-Step 'Git, Node.js LTS, Caddy, MongoDB'
    Install-WingetPackage 'Git.Git' 'Git' { Test-Command 'git' }
    Install-WingetPackage 'OpenJS.NodeJS.LTS' 'Node.js LTS' { Test-Command 'node' }
    Install-WingetPackage 'CaddyServer.Caddy' 'Caddy' { Test-Command 'caddy' }
    # MongoDB installs machine-wide as a Windows service: expect a UAC prompt. mongod is not put
    # on PATH by its installer, so the service is what counts.
    Install-WingetPackage 'MongoDB.Server' 'MongoDB (Windows service)' { [bool](Get-Service -Name 'MongoDB' -ErrorAction SilentlyContinue) }
    $mongo = Get-Service -Name 'MongoDB' -ErrorAction SilentlyContinue
    if ($mongo) {
        if ($mongo.Status -ne 'Running') {
            try { Start-Service -Name 'MongoDB' -ErrorAction Stop } catch { Write-Note "could not start the MongoDB service: $($_.Exception.Message)" }
        }
        if (Test-Port 27017) { Write-Ok 'MongoDB answers on 127.0.0.1:27017' }
        else { Write-Fail 'MongoDB service exists but nothing listens on 27017. Start it in services.msc (MongoDB Server).' }
    }

    # 4. Git settings: line endings and identity.
    Write-Step 'Git settings'
    if (Test-Command 'git') {
        # Team decision (DEV-3320): never CRLF on checkout, LF on commit. Our repos enforce LF via
        # .gitattributes anyway; this protects repositories without one (.sh files break on CRLF).
        $autocrlf = (& git config --global --get core.autocrlf)
        if (-not $autocrlf) {
            & git config --global core.autocrlf input
            Write-Ok 'core.autocrlf = input (checkout as-is, commit LF)'
        } elseif ($autocrlf -eq 'input') {
            Write-Ok 'core.autocrlf = input'
        } else {
            Write-Note "core.autocrlf = $autocrlf is kept (you set it). The team recommendation is 'input'."
        }
        foreach ($key in @('user.name', 'user.email')) {
            $value = (& git config --global --get $key)
            if ($value) { Write-Ok "$key = $value"; continue }
            $prompt = if ($key -eq 'user.name') { '    Your name for git commits (e.g. Jane Doe)' } else { '    Your e-mail for git commits' }
            $value = Read-Host $prompt
            if ($value) { & git config --global $key $value; Write-Ok "$key = $value" }
            else { Write-Fail "$key is not set. lt fullstack init cannot commit without it: git config --global $key ""...""" }
        }
    } else {
        Write-Fail 'git is not on PATH, git settings skipped.'
    }

    # 5. pnpm and the lt CLI, through npm.cmd: npm.ps1 is still blocked if step 1 failed.
    Write-Step 'pnpm and lt CLI'
    if (Test-Command 'npm.cmd') {
        $prefix = (& npm.cmd prefix -g | Select-Object -Last 1)
        if ($prefix) {
            if (Add-UserPath $prefix) { Write-Ok "added the npm global folder to PATH: $prefix" }
            else { Write-Ok "npm global folder is on PATH: $prefix" }
        }
        if (Test-Command 'pnpm') { Write-Ok 'pnpm already installed' }
        else {
            & npm.cmd install -g pnpm
            if (Test-Command 'pnpm') { Write-Ok 'pnpm installed' } else { Write-Fail 'pnpm could not be installed: npm install -g pnpm' }
        }
        # Quoted: without quotes PowerShell reads the leading @ as an operator.
        & npm.cmd install -g '@lenne.tech/cli@latest'
        if (Test-Command 'lt') { Write-Ok 'lt CLI installed (latest)' } else { Write-Fail 'lt could not be installed: npm install -g "@lenne.tech/cli"' }
        # npm no longer runs install scripts by default. For the CLI that only skips the bash/zsh
        # completion setup, which PowerShell does not use. The warning about it is harmless.
    } else {
        Write-Fail 'npm not found (Node.js missing?). pnpm and lt skipped.'
    }

    # 6. Claude Code, through its official installer, in a child process: that installer ends
    # with `exit`, which under `iex` would close this window.
    Write-Step 'Claude Code'
    if (Test-Command 'claude') {
        Write-Ok 'Claude Code already installed'
    } else {
        & powershell.exe -NoProfile -ExecutionPolicy Bypass -Command 'irm https://claude.ai/install.ps1 | iex'
        Update-SessionPath
        $claudeDir = Join-Path $env:USERPROFILE '.local\bin'
        if (-not (Test-Command 'claude') -and (Test-Path (Join-Path $claudeDir 'claude.exe'))) { [void](Add-UserPath $claudeDir) }
        if (Test-Command 'claude') { Write-Ok 'Claude Code installed' } else { Write-Fail 'Claude Code could not be installed: irm https://claude.ai/install.ps1 | iex' }
    }

    # 7. Console: QuickEdit freezes a running command on a single click, without any message.
    Write-Step 'Console'
    $quickEdit = (Get-ItemProperty -Path 'HKCU:\Console' -Name 'QuickEdit' -ErrorAction SilentlyContinue).QuickEdit
    if ($quickEdit -eq 0) { Write-Ok 'QuickEdit is off' }
    else {
        New-ItemProperty -Path 'HKCU:\Console' -Name 'QuickEdit' -Value 0 -PropertyType DWord -Force | Out-Null
        Write-Ok 'QuickEdit turned off for new console windows (this window keeps it until closed)'
    }
    if (Test-Command 'wt') { Write-Ok 'Windows Terminal available (recommended for lt)' }
    else { Write-Note 'Windows Terminal is recommended for lt: winget install --id Microsoft.WindowsTerminal -e' }

    # 8. Summary and check.
    Write-Step 'Check'
    if (Test-Command 'lt') { & lt.cmd doctor --offline }

    Write-Host ''
    if ($problems.Count -eq 0) {
        Write-Host 'Setup complete.' -ForegroundColor Green
    } else {
        Write-Host "Setup finished with $($problems.Count) problem(s):" -ForegroundColor Red
        foreach ($problem in $problems) { Write-Host "  - $problem" -ForegroundColor Red }
        Write-Host 'Fix them and run this script again.'
    }
    Write-Host ''
    Write-Host 'Next: open a NEW terminal (Windows Terminal), so it picks up PATH, then:'
    Write-Host '  lt fullstack init --name my-project --frontend nuxt --api-mode Rest --noConfirm'
    Write-Host '  cd my-project'
    Write-Host '  lt dev up'
}

Install-LtStack
