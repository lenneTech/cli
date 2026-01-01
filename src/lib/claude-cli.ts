/**
 * Claude CLI utilities
 * Handles detection and execution of Claude CLI commands
 */
import { execSync, spawnSync } from 'child_process';
import { existsSync } from 'fs';
import { homedir } from 'os';
import { join } from 'path';

/**
 * Path to Claude plugins marketplaces directory
 */
export const CLAUDE_MARKETPLACES_DIR = join(homedir(), '.claude', 'plugins', 'marketplaces');

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
 * Check if a shell command exists and succeeds
 * @param command - Command to check (e.g., 'which typescript-language-server')
 * @returns true if command exits with code 0
 */
export function checkCommandExists(command: string): boolean {
  try {
    execSync(command, { encoding: 'utf-8', stdio: ['pipe', 'pipe', 'pipe'] });
    return true;
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
 * Checks common installation locations and falls back to 'which'
 * @returns Path to Claude CLI or null if not found
 */
export function findClaudeCli(): null | string {
  const possiblePaths = [
    join(homedir(), '.claude', 'local', 'claude'),
    '/usr/local/bin/claude',
    '/usr/bin/claude',
  ];

  for (const p of possiblePaths) {
    if (existsSync(p)) {
      return p;
    }
  }

  try {
    const result = execSync('which claude', { encoding: 'utf-8', stdio: ['pipe', 'pipe', 'pipe'] });
    const path = result.trim();
    if (path && existsSync(path)) {
      return path;
    }
  } catch {
    // Claude CLI not found in PATH
  }

  return null;
}

/**
 * Execute a Claude CLI command
 * @param cli - Path to Claude CLI executable
 * @param args - Command arguments as string (e.g., 'plugin install foo')
 * @returns Command result with output and success status
 */
export function runClaudeCommand(cli: string, args: string): ClaudeCommandResult {
  try {
    const result = spawnSync(cli, args.split(' '), {
      encoding: 'utf-8',
      shell: true,
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
