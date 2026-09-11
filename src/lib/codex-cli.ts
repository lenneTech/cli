/**
 * Codex CLI utilities.
 */
import { spawnSync } from 'child_process';
import { existsSync } from 'fs';
import { homedir } from 'os';
import { join } from 'path';

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

export function findCodexCli(): null | string {
  const possiblePaths = [
    join(homedir(), '.local', 'bin', 'codex'),
    join(homedir(), '.codex', 'bin', 'codex'),
    '/usr/local/bin/codex',
    '/opt/homebrew/bin/codex',
    '/usr/bin/codex',
  ];

  for (const path of possiblePaths) {
    if (existsSync(path)) {
      return path;
    }
  }

  try {
    const result = spawnSync('which', ['codex'], { encoding: 'utf-8', stdio: ['pipe', 'pipe', 'pipe'] });
    const path = (result.stdout || '').trim();
    if (result.status === 0 && path && existsSync(path)) {
      return path;
    }
  } catch {
    // Codex CLI not found in PATH.
  }

  return null;
}

export function runCodexCommand(cli: string, args: string[]): CodexCommandResult {
  try {
    const result = spawnSync(cli, args, {
      encoding: 'utf-8',
      stdio: ['pipe', 'pipe', 'pipe'],
    });
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
