/**
 * Shell configuration utilities for CLI commands
 * Handles detection and modification of shell config files (.zshrc, .bashrc, etc.)
 */
import { appendFileSync, existsSync, readFileSync } from 'fs';
import { homedir } from 'os';
import { basename, join } from 'path';

/**
 * Shell alias definition
 */
export interface ShellAlias {
  /** Alias command (what you type) */
  alias: string;
  /** Full command that the alias expands to */
  command: string;
  /** Description of what this alias does */
  description: string;
}

/**
 * Shell configuration file info
 */
export interface ShellConfigFile {
  /** Whether the file exists */
  exists: boolean;
  /** Full path to the config file */
  path: string;
  /** Shell name (bash, zsh, etc.) */
  shell: string;
}

/**
 * Known shell configuration files in order of preference
 */
const SHELL_CONFIG_FILES: Array<{ file: string; shell: string }> = [
  { file: '.zshrc', shell: 'zsh' },
  { file: '.bashrc', shell: 'bash' },
  { file: '.bash_profile', shell: 'bash' },
  { file: '.profile', shell: 'sh' },
];

/**
 * Add multiple aliases to a shell config file as a block
 * @param configPath - Full path to the shell config file
 * @param aliases - Array of alias definitions
 * @param blockComment - Comment header for the block
 * @returns true if successful, false otherwise
 */
export function addAliasBlockToShellConfig(
  configPath: string,
  aliases: ShellAlias[],
  blockComment = 'Claude Code shortcuts - Added by lenne.tech CLI',
): boolean {
  try {
    const lines = [`\n# ${blockComment}`];
    for (const { alias, command } of aliases) {
      lines.push(`alias ${alias}='${command}'`);
    }
    lines.push('');
    appendFileSync(configPath, lines.join('\n'), 'utf-8');
    return true;
  } catch {
    return false;
  }
}

/**
 * Add an alias to a shell config file
 * @param configPath - Full path to the shell config file
 * @param alias - Alias name
 * @param command - Command the alias expands to
 * @param comment - Optional comment to add before the alias
 * @returns true if successful, false otherwise
 */
export function addAliasToShellConfig(
  configPath: string,
  alias: string,
  command: string,
  comment = 'Added by lenne.tech CLI',
): boolean {
  try {
    const lineToAdd = `\n# ${comment}\nalias ${alias}='${command}'\n`;
    appendFileSync(configPath, lineToAdd, 'utf-8');
    return true;
  } catch {
    return false;
  }
}

/**
 * Add an environment variable export to a shell config file
 * @param configPath - Full path to the shell config file
 * @param envName - Name of the environment variable
 * @param envValue - Value to set
 * @param comment - Optional comment to add before the export
 * @returns true if successful, false otherwise
 */
export function addEnvVarToShellConfig(
  configPath: string,
  envName: string,
  envValue: string,
  comment = 'Added by lenne.tech CLI',
): boolean {
  try {
    const lineToAdd = `\n# ${comment}\nexport ${envName}=${envValue}\n`;
    appendFileSync(configPath, lineToAdd, 'utf-8');
    return true;
  } catch {
    return false;
  }
}

/**
 * Check if an alias is already defined in a shell config file
 * @param configPath - Full path to the shell config file
 * @param alias - Alias name to check
 * @returns true if the alias exists in the file
 */
export function checkAliasInFile(configPath: string, alias: string): boolean {
  try {
    if (!existsSync(configPath)) {
      return false;
    }
    const content = readFileSync(configPath, 'utf-8');
    // Check for alias definition (with single or double quotes)
    const patterns = [
      `alias ${alias}=`,
      `alias ${alias} =`,
    ];
    return patterns.some(p => content.includes(p));
  } catch {
    return false;
  }
}

/**
 * Check if an environment variable is already set in a shell config file
 * Checks for common export formats (with/without quotes)
 * @param configPath - Full path to the shell config file
 * @param envName - Name of the environment variable
 * @param envValue - Expected value
 * @returns true if the export exists in the file
 */
export function checkEnvVarInFile(configPath: string, envName: string, envValue: string): boolean {
  try {
    if (!existsSync(configPath)) {
      return false;
    }
    const content = readFileSync(configPath, 'utf-8');
    // Check for existing export (with or without quotes)
    const patterns = [
      `export ${envName}=${envValue}`,
      `export ${envName}="${envValue}"`,
      `export ${envName}='${envValue}'`,
    ];
    return patterns.some(p => content.includes(p));
  } catch {
    return false;
  }
}

/**
 * Detect available shell configuration files for the current user
 * Prioritizes the current shell's config file
 * @returns Array of shell config file info, sorted by preference
 */
export function detectShellConfigs(): ShellConfigFile[] {
  const home = homedir();
  const configs: ShellConfigFile[] = [];

  // Check current shell from environment
  const currentShell = process.env.SHELL ? basename(process.env.SHELL) : null;

  for (const { file, shell } of SHELL_CONFIG_FILES) {
    const fullPath = join(home, file);
    const fileExists = existsSync(fullPath);

    // Prioritize current shell's config
    if (fileExists || (currentShell && currentShell === shell)) {
      configs.push({
        exists: fileExists,
        path: fullPath,
        shell,
      });
    }
  }

  // If no configs found, suggest creating .zshrc or .bashrc based on current shell
  if (configs.length === 0) {
    const defaultShell = currentShell || 'zsh';
    const defaultFile = defaultShell === 'bash' ? '.bashrc' : '.zshrc';
    configs.push({
      exists: false,
      path: join(home, defaultFile),
      shell: defaultShell,
    });
  }

  return configs;
}

/**
 * Get the preferred shell config file for the current user
 * Returns the first existing config, or suggests a default
 * @returns The preferred shell config file info, or null if none found
 */
export function getPreferredShellConfig(): null | ShellConfigFile {
  const configs = detectShellConfigs();
  return configs.find(c => c.exists) || configs[0] || null;
}
