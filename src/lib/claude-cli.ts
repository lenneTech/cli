/**
 * Claude CLI utilities
 * Handles detection and execution of Claude CLI commands
 */
import { existsSync, readFileSync } from 'fs';
import { homedir } from 'os';
import { join, posix, win32 } from 'path';

import { CliLookupOptions, findExecutable, isWindows, spawnCmdSync, windowsAppData } from './platform';

/**
 * Path to Claude plugins marketplaces directory
 */
export const CLAUDE_MARKETPLACES_DIR = join(homedir(), '.claude', 'plugins', 'marketplaces');

/**
 * Path to the Claude CLI's registry of known marketplaces (name → source).
 */
export const CLAUDE_KNOWN_MARKETPLACES_PATH = join(homedir(), '.claude', 'plugins', 'known_marketplaces.json');

/**
 * Result of a Claude CLI command execution
 */
export interface ClaudeCommandResult {
  /** Combined stdout and stderr output */
  output: string;
  /** Whether the command succeeded (exit code 0) */
  success: boolean;
}

/**
 * A single entry from known_marketplaces.json
 */
export interface KnownMarketplaceEntry {
  installLocation?: string;
  lastUpdated?: string;
  source?: { repo?: string; source?: string; url?: string };
}

/**
 * Check if a shell command exists and succeeds
 * @param command - Command to check (e.g., 'which typescript-language-server')
 * @returns true if command exits with code 0
 */
export function checkCommandExists(command: string): boolean {
  try {
    const [cmd, ...args] = command.trim().split(/\s+/);
    const result = spawnCmdSync(cmd, args, { stdio: ['pipe', 'pipe', 'pipe'] });
    return result.status === 0;
  } catch {
    return false;
  }
}

/**
 * Check if a marketplace is already installed
 * @param marketplaceName - Name of the marketplace to check
 * @returns true if marketplace directory exists
 */
export function checkMarketplaceExists(marketplaceName: string): boolean {
  return existsSync(join(CLAUDE_MARKETPLACES_DIR, marketplaceName));
}

/**
 * Find the Claude CLI executable path
 * Checks common installation locations first, then PATH
 *
 * On Windows the native installer puts `claude.exe` into `%USERPROFILE%\.local\bin`
 * and `npm i -g` a `claude.cmd` shim into `%APPDATA%\npm`. Both are checked
 * directly, because a shell opened before the install does not have them on PATH yet.
 * @returns Path to Claude CLI or null if not found
 */
export function findClaudeCli(options: CliLookupOptions = {}): null | string {
  const { env = process.env, home = homedir(), platform = process.platform } = options;
  const candidates = isWindows(platform)
    ? [win32.join(home, '.local', 'bin', 'claude.exe'), win32.join(windowsAppData(env, home), 'npm', 'claude.cmd')]
    : [posix.join(home, '.claude', 'local', 'claude'), '/usr/local/bin/claude', '/usr/bin/claude'];

  return findExecutable('claude', { ...options, candidates, env, platform });
}

/**
 * List the names of all marketplaces known to the Claude CLI.
 * @returns Array of marketplace names
 */
export function listKnownMarketplaceNames(): string[] {
  return Object.keys(readKnownMarketplaces());
}

/**
 * Read the Claude CLI's registry of known marketplaces.
 * Never throws — returns an empty object when the file is missing or invalid.
 * @returns Map of marketplace name to its registry entry
 */
export function readKnownMarketplaces(): Record<string, KnownMarketplaceEntry> {
  try {
    const parsed = JSON.parse(readFileSync(CLAUDE_KNOWN_MARKETPLACES_PATH, 'utf-8'));
    return parsed && typeof parsed === 'object' ? (parsed as Record<string, KnownMarketplaceEntry>) : {};
  } catch {
    return {};
  }
}

/**
 * Execute a Claude CLI command
 * @param cli - Path to Claude CLI executable
 * @param args - Command arguments as string (e.g., 'plugin install foo')
 * @returns Command result with output and success status
 */
export function runClaudeCommand(cli: string, args: string): ClaudeCommandResult {
  try {
    const result = spawnCmdSync(cli, args.split(' '), { stdio: ['pipe', 'pipe', 'pipe'] });
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
