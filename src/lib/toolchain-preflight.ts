/**
 * Toolchain checks shared by `lt doctor` and `lt fullstack init`.
 *
 * `lt fullstack init` used to find out about a missing pnpm by running into it: the install
 * step died after clone and setup, with the shell's own "command not found" (on Windows the
 * localized cmd.exe text) and no hint. A machine at zero (the 2026-11 Windows workshop,
 * DEV-3320) hits exactly that. These checks name the missing piece and the command that fixes
 * it, before the work starts. The git identity has its own check, `git-identity.ts`.
 *
 * The PATH lookup and the platform are injectable, so every branch runs in a test on any OS.
 */
import { tmpdir } from 'os';

import { findExecutable } from './platform';

/**
 * The pnpm major the lt-monorepo template pins (`packageManager: pnpm@11.…`). Keep in step
 * with it. Installed from npm, pnpm 11 is JavaScript run by the signed node.exe. pnpm 12 is a
 * native binary, and in a project pinned to 11 it downloads the pinned version as another
 * native binary (`@pnpm/exe`), which Windows Smart App Control blocked: CodeIntegrity event
 * 3033, "did not meet the Enterprise signing level requirements" (DEV-3320, 2026-11-04).
 */
export const PNPM_MAJOR = 11;

/** One `<manager> --version` call of `lt doctor`, and the directory it runs in. */
export interface PackageManagerProbe {
  cwd: string;
  manager: string;
}

export interface ToolchainDeps {
  /** Resolve a binary on PATH, `null` when absent. Default: {@link findExecutable}. */
  findExecutable?: (name: string) => null | string;
  /** Default: `process.platform`. */
  platform?: NodeJS.Platform;
}

/** A missing prerequisite, with the commands that fix it. */
export interface ToolchainIssue {
  /** Commands to run, one per line, in order. */
  fix: string[];
  id: 'git-missing' | 'pnpm-missing';
  /** One line: what is missing and what needs it. */
  message: string;
}

/**
 * Tools `lt fullstack init` needs on PATH before it clones anything.
 *
 * pnpm is required for the classic flow: lt-monorepo ships a `pnpm-lock.yaml` and
 * `packageManager: pnpm@…`, so the detected manager is pnpm whatever the user configured.
 * The experimental `--next` flow skips the install and leaves it to the user.
 *
 * @param needs - Which tools the caller's flow uses
 * @returns The missing ones, in the order the user should fix them
 */
export function findMissingTools(needs: { pnpm: boolean }, deps: ToolchainDeps = {}): ToolchainIssue[] {
  const lookup = deps.findExecutable ?? ((name: string) => findExecutable(name));
  const platform = deps.platform ?? process.platform;
  const issues: ToolchainIssue[] = [];
  if (!lookup('git')) {
    issues.push({
      fix: [gitInstallHint(platform)],
      id: 'git-missing',
      message: 'git is not installed (or not on PATH).',
    });
  }
  if (needs.pnpm && !lookup('pnpm')) {
    issues.push({
      fix: [pnpmInstallHint()],
      id: 'pnpm-missing',
      message: 'pnpm is not installed (or not on PATH). lt fullstack init installs the workspace with pnpm.',
    });
  }
  return issues;
}

/**
 * Install command for git on this platform. The Windows id is the one git-scm.com documents.
 */
export function gitInstallHint(platform: NodeJS.Platform = process.platform): string {
  if (platform === 'win32') {
    return 'winget install --id Git.Git -e --source winget';
  }
  if (platform === 'darwin') {
    return 'xcode-select --install';
  }
  return 'https://git-scm.com/downloads/linux';
}

/**
 * The version checks `lt doctor` runs: the current directory's package manager, in that directory,
 * and pnpm in any case (`lt fullstack init` and `lt dev` run on it).
 *
 * A pnpm that is not the project's manager runs OUTSIDE the project. Inside, corepack's pnpm
 * refuses when `packageManager` names npm or yarn (exit 1, "This project is configured to use
 * npm"), so doctor reported a working pnpm as "failed to start" (measured 2026-11-25), and any pnpm
 * would switch to a version the project pins. Outside, it reports the installed pnpm, which is what
 * {@link pnpmMajorIssue} judges; `scripts/windows/setup.ps1` asks it the same way. In a pnpm project
 * it runs in place: a switch Windows blocks there is exactly what doctor has to show.
 *
 * @param detectedPm - Package manager of the current directory
 * @param cwd - The current directory
 * @param outside - A directory outside any project. Default: the OS temp directory
 */
export function packageManagerProbes(
  detectedPm: string,
  cwd: string,
  outside: string = tmpdir(),
): PackageManagerProbe[] {
  if (detectedPm === 'pnpm') {
    return [{ cwd, manager: 'pnpm' }];
  }
  return [
    { cwd, manager: detectedPm },
    { cwd: outside, manager: 'pnpm' },
  ];
}

/**
 * Install command for pnpm. `npm install -g` needs no admin rights on any platform and puts
 * the shim next to `lt`; `corepack enable` writes next to node.exe, which on Windows sits in
 * `C:\Program Files` and needs an elevated shell. Pinned to {@link PNPM_MAJOR}.
 */
export function pnpmInstallHint(): string {
  return `npm install -g pnpm@${PNPM_MAJOR}`;
}

/**
 * Why a globally installed pnpm of another major is a problem, or `null` when it is fine
 * (or the version cannot be read). Windows only: elsewhere a version switch is harmless, and
 * on macOS/Linux a pnpm 10 that switches per project is common and works.
 * @param version - Output of `pnpm --version`
 * @param platform - Default: `process.platform`
 */
export function pnpmMajorIssue(version: string, platform: NodeJS.Platform = process.platform): null | string {
  if (platform !== 'win32') {
    return null;
  }
  const trimmed = String(version).trim();
  const major = parseInt(trimmed.split('.')[0], 10);
  if (!Number.isFinite(major) || major === PNPM_MAJOR) {
    return null;
  }
  return `pnpm ${trimmed} is not pnpm ${PNPM_MAJOR}, which lt projects pin. It switches versions per project by downloading them; on Windows, Smart App Control can block that download.`;
}
