/**
 * Platform primitives for native Windows support.
 *
 * Two things work on macOS/Linux by accident and fail on native Windows:
 * - Looking up a binary via `which`: there is no `which` in PowerShell or cmd.exe.
 * - Spawning a binary without a shell: npm-installed tools are `.cmd` shims, and
 *   Node refuses to spawn `.cmd`/`.bat` without a shell (CVE-2024-27980, EINVAL).
 *
 * The platform, environment and file probe are injectable, so the Windows
 * branches stay assertable from a test on macOS or Linux (same approach as
 * `vscode-settings.ts#settingsPathFor`).
 */
import type { ChildProcess, SpawnOptions, SpawnSyncOptions, SpawnSyncReturns } from 'child_process';

import crossSpawn, { sync as crossSpawnSync } from 'cross-spawn';
import { accessSync, constants, statSync } from 'fs';
import { posix, win32 } from 'path';

/** Injection points for the per-tool lookups (`findClaudeCli`, `findCodexCli`). */
export interface CliLookupOptions extends Omit<FindExecutableOptions, 'candidates'> {
  /** Default: `os.homedir()`. */
  home?: string;
}

export interface FindExecutableOptions {
  /** Absolute paths checked before PATH, e.g. well-known install locations. */
  candidates?: string[];
  /** Environment to read PATH/PATHEXT from. Default: `process.env`. */
  env?: NodeJS.ProcessEnv;
  /** File probe. Default: an executable regular file on disk. */
  isExecutableFile?: (path: string) => boolean;
  /** Default: `process.platform`. */
  platform?: NodeJS.Platform;
}

const DEFAULT_PATHEXT = '.COM;.EXE;.BAT;.CMD';

/**
 * Resolve a binary the way a shell would, without spawning `which`/`where.exe`.
 *
 * `candidates` win over PATH, in order. On Windows each PATH directory is
 * probed with every PATHEXT extension; an extensionless file is never matched
 * there, because Node cannot spawn it (it is typically a Git Bash script).
 *
 * @returns Absolute path of the first match, or null
 */
export function findExecutable(name: string, options: FindExecutableOptions = {}): null | string {
  const { candidates = [], env = process.env, isExecutableFile = isExecutableFileOnDisk } = options;
  const windows = isWindows(options.platform);
  const pathApi = windows ? win32 : posix;

  for (const candidate of candidates) {
    if (isExecutableFile(candidate)) {
      return candidate;
    }
  }

  const dirs = (readEnv(env, 'PATH', windows) || '')
    .split(pathApi.delimiter)
    .map((dir) => dir.trim().replace(/^"(.*)"$/, '$1'))
    .filter(Boolean);

  const names = windows ? windowsNameVariants(name, readEnv(env, 'PATHEXT', windows)) : [name];

  for (const dir of dirs) {
    for (const variant of names) {
      const full = pathApi.join(dir, variant);
      if (isExecutableFile(full)) {
        return full;
      }
    }
  }

  return null;
}

/**
 * True for native Windows (PowerShell, cmd.exe and Git Bash alike — Node
 * reports `win32` in all three).
 */
export function isWindows(platform: NodeJS.Platform = process.platform): boolean {
  return platform === 'win32';
}

/**
 * `spawn` that also runs `.cmd`/`.bat` shims on Windows.
 *
 * The asynchronous counterpart of `spawnCmdSync`, with the same delegation and
 * the same argument limit — see there. Needed because every long-running child
 * the CLI starts (`pnpm run dev`, `pnpm start`, a Playwright run) is spawned
 * asynchronously, and `pnpm` is `pnpm.cmd` on Windows: Node refuses to exec a
 * `.cmd` directly (CVE-2024-27980, `EINVAL`), so without this nothing starts
 * there at all.
 *
 * `detached` and `stdio` pass through unchanged, so a caller keeps its process
 * group and its log-file descriptors. On Windows cross-spawn interposes
 * `cmd.exe /c`, which means the reported pid is that of `cmd.exe` — the child
 * tree, not a process group, is what a killer has to walk there.
 */
export function spawnCmd(command: string, args: readonly string[] = [], options: SpawnOptions = {}): ChildProcess {
  return crossSpawn(command, [...args], options);
}

/**
 * `spawnSync` that also runs `.cmd`/`.bat` shims on Windows.
 *
 * Delegates to cross-spawn, which is a plain `child_process.spawnSync` on
 * macOS/Linux. On Windows it resolves the shim and runs it through cmd.exe with
 * escaped arguments.
 *
 * Limit on Windows: cross-spawn escapes cmd.exe metacharacters (`& | % ^ …`) twice
 * only for shims under `node_modules\.bin`. A global npm shim such as
 * `%APPDATA%\npm\claude.cmd` re-parses its `%*`, so there a metacharacter can
 * still take effect. Pass plain arguments (names, slugs, paths), never
 * untrusted free text.
 */
export function spawnCmdSync(
  command: string,
  args: readonly string[] = [],
  options: SpawnSyncOptions = {},
): SpawnSyncReturns<string> {
  return crossSpawnSync(command, [...args], { encoding: 'utf-8', ...options }) as SpawnSyncReturns<string>;
}

/**
 * `%APPDATA%` (roaming profile), home of npm's global `.cmd` shims on Windows.
 */
export function windowsAppData(env: NodeJS.ProcessEnv, home: string): string {
  return readEnv(env, 'APPDATA', true) || win32.join(home, 'AppData', 'Roaming');
}

function isExecutableFileOnDisk(path: string): boolean {
  try {
    if (!statSync(path).isFile()) {
      return false;
    }
    // Windows has no execute bit; X_OK degrades to an existence check there
    accessSync(path, constants.X_OK);
    return true;
  } catch {
    return false;
  }
}

/**
 * Windows environment keys are case-insensitive (`Path` is the usual spelling).
 * `process.env` hides that, a plain object passed in a test does not.
 */
function readEnv(env: NodeJS.ProcessEnv, key: string, windows: boolean): string | undefined {
  if (!windows) {
    return env[key];
  }
  const match = Object.keys(env).find((k) => k.toUpperCase() === key);
  return match ? env[match] : undefined;
}

function windowsNameVariants(name: string, pathExt: string | undefined): string[] {
  const extensions = (pathExt || DEFAULT_PATHEXT)
    .split(';')
    .map((ext) => ext.trim().toLowerCase())
    .filter(Boolean);
  const ownExtension = win32.extname(name).toLowerCase();
  if (ownExtension && extensions.includes(ownExtension)) {
    return [name];
  }
  return extensions.map((ext) => `${name}${ext}`);
}
