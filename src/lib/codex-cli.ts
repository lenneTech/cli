/**
 * Codex CLI utilities.
 */
import { homedir } from 'os';
import { posix, win32 } from 'path';

import { CliLookupOptions, findExecutable, isWindows, spawnCmdSync, windowsAppData } from './platform';

/**
 * Codex marketplace checkout used when `lt codex plugins` gets no `--path`.
 * Defaults to the current directory, matching the command's own guidance to run it
 * from a checkout that contains the generated marketplace.
 */
export const DEFAULT_CODEX_MARKETPLACE_ROOT = process.env.LT_CODEX_MARKETPLACE_ROOT || process.cwd();

export interface CodexCommandResult {
  output: string;
  success: boolean;
}

export interface CodexMarketplaceList {
  marketplaces?: Array<{
    marketplaceSource?: {
      source?: string;
      sourceType?: string;
    };
    name: string;
    root?: string;
  }>;
}

/**
 * Find the Codex CLI executable path: common installation locations first, then PATH.
 * On Windows `npm i -g @openai/codex` leaves a `codex.cmd` shim in `%APPDATA%\npm`.
 */
export function findCodexCli(options: CliLookupOptions = {}): null | string {
  const { env = process.env, home = homedir(), platform = process.platform } = options;
  const candidates = isWindows(platform)
    ? [win32.join(windowsAppData(env, home), 'npm', 'codex.cmd')]
    : [
        posix.join(home, '.local', 'bin', 'codex'),
        posix.join(home, '.codex', 'bin', 'codex'),
        '/usr/local/bin/codex',
        '/opt/homebrew/bin/codex',
        '/usr/bin/codex',
      ];

  return findExecutable('codex', { ...options, candidates, env, platform });
}

export function runCodexCommand(cli: string, args: string[]): CodexCommandResult {
  try {
    const result = spawnCmdSync(cli, args, { stdio: ['pipe', 'pipe', 'pipe'] });
    return {
      output: result.stdout + result.stderr,
      success: result.status === 0,
    };
  } catch (err) {
    return {
      output: (err as Error).message,
      success: false,
    };
  }
}
