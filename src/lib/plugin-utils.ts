/**
 * Plugin utilities for Claude Code plugin management
 * Handles reading plugin contents, permissions, and post-installation setup
 */
import { execSync } from 'child_process';
import { existsSync, readdirSync, readFileSync, writeFileSync } from 'fs';
import { homedir } from 'os';
import { join } from 'path';

import { checkCommandExists } from './claude-cli';
import { safeJsonParse } from './json-utils';
import {
  addEnvVarToShellConfig,
  checkEnvVarInFile,
  getPreferredShellConfig,
} from './shell-config';

/**
 * Result of handling missing environment variables
 */
export interface EnvVarsHandlingResult {
  /** Whether env vars were successfully configured */
  configured: boolean;
  /** Whether any env vars need configuration */
  needed: boolean;
}

/**
 * Plugin contents (skills, commands, hooks, agents, permissions, mcpServers)
 */
export interface PluginContents {
  agents: string[];
  commands: string[];
  hooks: number;
  mcpServers: string[];
  permissions: string[];
  skills: string[];
}

/**
 * Environment variable requirement for a plugin
 */
export interface PluginEnvVar {
  /** Description of what this env var does */
  description: string;
  /** Name of the environment variable */
  name: string;
  /** Expected value */
  value: string;
}

/**
 * Post-installation configuration for plugins that need additional setup
 */
export interface PluginPostInstall {
  /** Environment variables that should be set */
  envVars?: PluginEnvVar[];
  /** Global packages or tools that need to be installed */
  requirements?: PluginRequirement[];
}

/**
 * Post-installation requirement for a plugin
 */
export interface PluginRequirement {
  /** Command to check if requirement is already met (exit 0 = met). If not provided, installCommand always runs. */
  checkCommand?: string;
  /** Description shown when checking/installing */
  description: string;
  /** Command to install the requirement */
  installCommand: string;
}

/**
 * Result of processing post-install requirements
 */
export interface PostInstallResult {
  envVarsMissing: PluginEnvVar[];
  requirementsInstalled: string[];
  requirementsMissing: string[];
  success: boolean;
}

/**
 * Structure of the permissions.json file in the plugin
 */
interface PluginPermissions {
  description?: string;
  permissions: Array<{
    description?: string;
    pattern: string;
    usedBy?: string[];
  }>;
}

/**
 * Empty plugin contents constant (used for failed installations)
 */
export const EMPTY_PLUGIN_CONTENTS: PluginContents = {
  agents: [],
  commands: [],
  hooks: 0,
  mcpServers: [],
  permissions: [],
  skills: [],
};

/**
 * Maximum number of commands to show in plugin summary before truncating
 */
export const MAX_COMMANDS_TO_SHOW = 5;

/**
 * Post-installation configurations for specific plugins
 * These define additional setup steps needed after plugin installation
 */
export const PLUGIN_POST_INSTALL: Record<string, PluginPostInstall> = {
  'typescript-lsp': {
    envVars: [
      {
        description: 'Enable LSP tools in Claude Code (required for LSP features)',
        name: 'ENABLE_LSP_TOOL',
        value: '1',
      },
    ],
    requirements: [
      {
        checkCommand: 'which typescript-language-server',
        description: 'TypeScript language server',
        installCommand: 'npm install -g typescript-language-server typescript',
      },
    ],
  },
};

/**
 * Recursively find all .md files in a directory and convert to command names
 * @param dir - Directory to search
 * @param basePath - Base path for relative path calculation
 * @returns Array of command names (e.g., '/git:commit-message')
 */
export function findMarkdownFiles(dir: string, basePath = ''): string[] {
  const results: string[] = [];
  if (!existsSync(dir)) return results;

  try {
    const entries = readdirSync(dir, { withFileTypes: true });
    for (const entry of entries) {
      const fullPath = join(dir, entry.name);
      const relativePath = basePath ? `${basePath}/${entry.name}` : entry.name;

      if (entry.isDirectory()) {
        results.push(...findMarkdownFiles(fullPath, relativePath));
      } else if (entry.isFile() && entry.name.endsWith('.md')) {
        // Convert path to command name (e.g., "git/commit-message.md" -> "/git:commit-message")
        const commandName = relativePath
          .replace(/\.md$/, '')
          .replace(/\//g, ':');
        results.push(`/${commandName}`);
      }
    }
  } catch {
    // Directory read failed, return empty results
  }

  return results;
}

/**
 * Handle missing environment variables from plugin installations
 * Checks shell config, prompts user to add missing vars, and provides manual instructions
 * @param missingEnvVars - Map of env var name to PluginEnvVar
 * @param toolbox - Toolbox with print and prompt functions
 * @returns Result indicating if vars were needed and if they were configured
 */
export async function handleMissingEnvVars(
  missingEnvVars: Map<string, PluginEnvVar>,
  toolbox: {
    print: {
      error: (msg: string) => void;
      info: (msg: string) => void;
      success: (msg: string) => void;
      warning: (msg: string) => void;
    };
    prompt: { confirm: (msg: string, initial?: boolean) => Promise<boolean> };
  },
): Promise<EnvVarsHandlingResult> {
  const {
    print: { error, info, success, warning },
    prompt,
  } = toolbox;

  const result: EnvVarsHandlingResult = {
    configured: false,
    needed: false,
  };

  if (missingEnvVars.size === 0) {
    return result;
  }

  // Get preferred shell config
  const targetConfig = getPreferredShellConfig();

  // Check which env vars are truly missing (not in file either)
  const envVarsToAdd: PluginEnvVar[] = [];
  const envVarsAlreadyInFile: PluginEnvVar[] = [];

  for (const envVar of missingEnvVars.values()) {
    if (targetConfig && checkEnvVarInFile(targetConfig.path, envVar.name, envVar.value)) {
      envVarsAlreadyInFile.push(envVar);
    } else {
      envVarsToAdd.push(envVar);
    }
  }

  // Show already configured vars
  if (envVarsAlreadyInFile.length > 0) {
    info('');
    for (const envVar of envVarsAlreadyInFile) {
      info(`${envVar.name} already configured in ${targetConfig?.path}`);
    }
    info(`Run 'source ${targetConfig?.path}' or restart your terminal to apply.`);
  }

  // Handle vars that need to be added
  if (envVarsToAdd.length > 0) {
    result.needed = true;
    info('');
    warning('Environment variables required:');
    for (const envVar of envVarsToAdd) {
      info(`  ${envVar.name}=${envVar.value}`);
      info(`    ${envVar.description}`);
    }

    if (targetConfig) {
      // Ask user if they want to add the env vars automatically
      const shouldAdd = await prompt.confirm(
        `Add ${envVarsToAdd.length > 1 ? 'these variables' : envVarsToAdd[0].name} to ${targetConfig.path}?`,
        true
      );

      if (shouldAdd) {
        let allAdded = true;

        for (const envVar of envVarsToAdd) {
          const added = addEnvVarToShellConfig(targetConfig.path, envVar.name, envVar.value);
          if (added) {
            success(`  Added ${envVar.name}=${envVar.value} to ${targetConfig.path}`);
          } else {
            error(`  Failed to add ${envVar.name} to ${targetConfig.path}`);
            allAdded = false;
          }
        }

        if (allAdded) {
          result.configured = true;
          info('');
          info(`Run 'source ${targetConfig.path}' or restart your terminal to apply changes.`);
        }
      } else {
        info('');
        info('To add manually, run:');
        for (const envVar of envVarsToAdd) {
          info(`  echo 'export ${envVar.name}=${envVar.value}' >> ${targetConfig.path}`);
        }
      }
    } else {
      info('');
      info('Add manually to your shell profile:');
      for (const envVar of envVarsToAdd) {
        info(`  export ${envVar.name}=${envVar.value}`);
      }
    }
  }

  return result;
}

/**
 * Print plugin summary with skills, commands, agents, etc.
 * @param pluginName - Name of the plugin
 * @param contents - Plugin contents
 * @param info - Info print function from toolbox
 */
export function printPluginSummary(
  pluginName: string,
  contents: PluginContents,
  info: (msg: string) => void,
): void {
  const isLspPlugin = pluginName.endsWith('-lsp');
  const hasContent = contents.skills.length > 0 || contents.commands.length > 0 || contents.agents.length > 0;

  if (hasContent || isLspPlugin) {
    info('');
    info(`${pluginName}:`);

    // Show LSP indicator for LSP plugins
    if (isLspPlugin) {
      info(`  Type: Language Server (LSP)`);
    }

    // Alphabetical order: Agents, Commands, Hooks, MCP Servers, Skills
    if (contents.agents.length > 0) {
      info(`  Agents (${contents.agents.length}): ${contents.agents.join(', ')}`);
    }
    if (contents.commands.length > 0) {
      const shown = contents.commands.slice(0, MAX_COMMANDS_TO_SHOW);
      const remaining = contents.commands.length - MAX_COMMANDS_TO_SHOW;
      const commandsStr = remaining > 0
        ? `${shown.join(', ')} and ${remaining} more`
        : shown.join(', ');
      info(`  Commands (${contents.commands.length}): ${commandsStr}`);
    }
    if (contents.hooks > 0) {
      info(`  Hooks: ${contents.hooks} auto-detection hooks`);
    }
    if (contents.mcpServers.length > 0) {
      info(`  MCP Servers (${contents.mcpServers.length}): ${contents.mcpServers.join(', ')}`);
    }
    if (contents.skills.length > 0) {
      info(`  Skills (${contents.skills.length}): ${contents.skills.join(', ')}`);
    }
  }
}

/**
 * Process post-installation requirements for a plugin
 * Checks and installs required dependencies, reports missing env vars
 * @param pluginName - Name of the plugin
 * @param toolbox - Extended Gluegun toolbox
 * @returns Post-install result with success status and details
 */
export function processPostInstall(
  pluginName: string,
  toolbox: { print: { spin: (msg: string) => { fail: (msg: string) => void; succeed: (msg: string) => void; text: string }; warning: (msg: string) => void } },
): PostInstallResult {
  const {
    print: { spin, warning },
  } = toolbox;

  const result: PostInstallResult = {
    envVarsMissing: [],
    requirementsInstalled: [],
    requirementsMissing: [],
    success: true,
  };

  const postInstall = PLUGIN_POST_INSTALL[pluginName];
  if (!postInstall) {
    return result;
  }

  // Check and install requirements
  if (postInstall.requirements) {
    for (const req of postInstall.requirements) {
      // If checkCommand is provided, verify if requirement is already met
      if (req.checkCommand) {
        const checkSpinner = spin(`Checking ${req.description}`);

        if (checkCommandExists(req.checkCommand)) {
          checkSpinner.succeed(`${req.description} already installed`);
          continue;
        }

        // Try to install
        checkSpinner.text = `Installing ${req.description}`;
        try {
          execSync(req.installCommand, {
            encoding: 'utf-8',
            stdio: ['pipe', 'pipe', 'pipe'],
          });

          // Verify installation
          if (checkCommandExists(req.checkCommand)) {
            checkSpinner.succeed(`${req.description} installed`);
            result.requirementsInstalled.push(req.description);
          } else {
            checkSpinner.fail(`${req.description} installation may have failed`);
            result.requirementsMissing.push(req.description);
            result.success = false;
          }
        } catch (err) {
          checkSpinner.fail(`Failed to install ${req.description}`);
          warning(`  Command: ${req.installCommand}`);
          warning(`  Error: ${(err as Error).message}`);
          result.requirementsMissing.push(req.description);
          result.success = false;
        }
      } else {
        // No checkCommand provided - always run installCommand
        const installSpinner = spin(`Running ${req.description}`);
        try {
          execSync(req.installCommand, {
            encoding: 'utf-8',
            stdio: ['pipe', 'pipe', 'pipe'],
          });
          installSpinner.succeed(`${req.description} completed`);
          result.requirementsInstalled.push(req.description);
        } catch (err) {
          installSpinner.fail(`Failed: ${req.description}`);
          warning(`  Command: ${req.installCommand}`);
          warning(`  Error: ${(err as Error).message}`);
          result.requirementsMissing.push(req.description);
          result.success = false;
        }
      }
    }
  }

  // Check environment variables
  if (postInstall.envVars) {
    for (const envVar of postInstall.envVars) {
      const currentValue = process.env[envVar.name];
      if (currentValue !== envVar.value) {
        result.envVarsMissing.push(envVar);
      }
    }
  }

  return result;
}

/**
 * Read plugin contents from installed plugin directory
 * @param marketplaceName - Name of the marketplace
 * @param pluginName - Name of the plugin
 * @returns Plugin contents with skills, commands, agents, hooks, etc.
 */
export function readPluginContents(marketplaceName: string, pluginName: string): PluginContents {
  const pluginDir = join(
    homedir(),
    '.claude',
    'plugins',
    'marketplaces',
    marketplaceName,
    'plugins',
    pluginName
  );

  const result: PluginContents = {
    agents: [],
    commands: [],
    hooks: 0,
    mcpServers: [],
    permissions: [],
    skills: [],
  };

  // Read skills
  const skillsDir = join(pluginDir, 'skills');
  if (existsSync(skillsDir)) {
    try {
      result.skills = readdirSync(skillsDir, { withFileTypes: true })
        .filter(dirent => dirent.isDirectory())
        .map(dirent => dirent.name);
    } catch {
      // Skills directory read failed
    }
  }

  // Read agents
  const agentsDir = join(pluginDir, 'agents');
  if (existsSync(agentsDir)) {
    try {
      result.agents = readdirSync(agentsDir, { withFileTypes: true })
        .filter(dirent => dirent.isFile() && dirent.name.endsWith('.md'))
        .map(dirent => dirent.name.replace(/\.md$/, ''));
    } catch {
      // Agents directory read failed
    }
  }

  // Read commands
  const commandsDir = join(pluginDir, 'commands');
  result.commands = findMarkdownFiles(commandsDir);

  // Read hooks
  const hooksPath = join(pluginDir, 'hooks', 'hooks.json');
  const hooksContent = safeReadJson<{ hooks?: Record<string, Array<{ hooks?: unknown[] }>> }>(hooksPath);
  if (hooksContent?.hooks) {
    // Count hooks across all event types
    for (const eventHooks of Object.values(hooksContent.hooks)) {
      if (Array.isArray(eventHooks)) {
        for (const hookGroup of eventHooks) {
          if (hookGroup.hooks && Array.isArray(hookGroup.hooks)) {
            result.hooks += hookGroup.hooks.length;
          }
        }
      }
    }
  }

  // Read MCP servers
  const mcpPath = join(pluginDir, '.mcp.json');
  const mcpContent = safeReadJson<{ mcpServers?: Record<string, unknown> }>(mcpPath);
  if (mcpContent?.mcpServers) {
    result.mcpServers = Object.keys(mcpContent.mcpServers);
  }

  // Read permissions
  const permissionsPath = join(pluginDir, 'permissions.json');
  const pluginPerms = safeReadJson<PluginPermissions>(permissionsPath);
  if (pluginPerms?.permissions) {
    result.permissions = pluginPerms.permissions.map(p => p.pattern);
  }

  return result;
}

/**
 * Setup permissions in settings.json
 * Only adds new permissions, does not remove existing ones
 * (User may have customized permissions that should be preserved)
 * @param requiredPermissions - Array of permission patterns to add
 * @param error - Error print function from toolbox
 * @returns Result with added and existing permissions
 */
export function setupPermissions(
  requiredPermissions: string[],
  error: (msg: string) => void,
): { added: string[]; existing: string[]; success: boolean } {
  const settingsPath = join(homedir(), '.claude', 'settings.json');

  try {
    // Read existing settings
    let settings: Record<string, unknown> = {};
    if (existsSync(settingsPath)) {
      const content = readFileSync(settingsPath, 'utf-8');
      const parsed = safeJsonParse<Record<string, unknown>>(content);
      if (parsed) {
        settings = parsed;
      }
    }

    // Ensure permissions.allow exists
    if (!settings.permissions) {
      settings.permissions = {};
    }
    const perms = settings.permissions as Record<string, unknown>;
    if (!perms.allow) {
      perms.allow = [];
    }

    const currentAllowList = perms.allow as string[];

    // Determine what to add
    const added: string[] = [];
    const existing: string[] = [];

    requiredPermissions.forEach(perm => {
      if (currentAllowList.includes(perm)) {
        existing.push(perm);
      } else {
        added.push(perm);
      }
    });

    // Add new permissions
    if (added.length > 0) {
      perms.allow = [...currentAllowList, ...added];
      writeFileSync(settingsPath, JSON.stringify(settings, null, 2));
    }

    return { added, existing, success: true };
  } catch (err) {
    error(`Could not configure permissions: ${(err as Error).message}`);
    return { added: [], existing: [], success: false };
  }
}

/**
 * Safely read and parse a JSON file
 * @param filePath - Path to the JSON file
 * @returns Parsed object or null if reading/parsing fails
 */
function safeReadJson<T>(filePath: string): null | T {
  try {
    if (!existsSync(filePath)) {
      return null;
    }
    const content = readFileSync(filePath, 'utf-8');
    return safeJsonParse<T>(content);
  } catch {
    return null;
  }
}
