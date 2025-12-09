import { execSync, spawnSync } from 'child_process';
import { existsSync, readdirSync, readFileSync, writeFileSync } from 'fs';
import { GluegunCommand } from 'gluegun';
import { homedir } from 'os';
import { join } from 'path';

import { ExtendedGluegunToolbox } from '../../interfaces/extended-gluegun-toolbox';

/**
 * Plugin configuration
 */
const PLUGIN_CONFIG = {
  marketplaceName: 'lenne-tech',
  marketplaceRepo: 'lenneTech/claude-code',
  pluginName: 'core',
};

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
 * Find the claude CLI executable path
 */
function findClaudeCli(): null | string {
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
    // Ignore errors
  }

  return null;
}

/**
 * Recursively find all .md files in a directory
 */
function findMarkdownFiles(dir: string, basePath = ''): string[] {
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
    // Ignore errors
  }

  return results;
}

/**
 * Read plugin contents (skills, commands, hooks, permissions, mcpServers)
 */
function readPluginContents(marketplaceName: string): {
  commands: string[];
  hooks: number;
  mcpServers: string[];
  permissions: string[];
  skills: string[];
} {
  const pluginDir = join(
    homedir(),
    '.claude',
    'plugins',
    'marketplaces',
    marketplaceName,
    'plugins',
    'core'
  );

  const result = {
    commands: [] as string[],
    hooks: 0,
    mcpServers: [] as string[],
    permissions: [] as string[],
    skills: [] as string[],
  };

  // Read skills
  const skillsDir = join(pluginDir, 'skills');
  if (existsSync(skillsDir)) {
    try {
      result.skills = readdirSync(skillsDir, { withFileTypes: true })
        .filter(dirent => dirent.isDirectory())
        .map(dirent => dirent.name);
    } catch {
      // Ignore
    }
  }

  // Read commands
  const commandsDir = join(pluginDir, 'commands');
  result.commands = findMarkdownFiles(commandsDir);

  // Read hooks
  const hooksPath = join(pluginDir, 'hooks', 'hooks.json');
  if (existsSync(hooksPath)) {
    try {
      const hooksContent = JSON.parse(readFileSync(hooksPath, 'utf-8'));
      // Count hooks across all event types
      for (const eventHooks of Object.values(hooksContent.hooks || {})) {
        if (Array.isArray(eventHooks)) {
          for (const hookGroup of eventHooks) {
            if (hookGroup.hooks && Array.isArray(hookGroup.hooks)) {
              result.hooks += hookGroup.hooks.length;
            }
          }
        }
      }
    } catch {
      // Ignore
    }
  }

  // Read MCP servers
  const mcpPath = join(pluginDir, '.mcp.json');
  if (existsSync(mcpPath)) {
    try {
      const mcpContent = JSON.parse(readFileSync(mcpPath, 'utf-8'));
      if (mcpContent.mcpServers) {
        result.mcpServers = Object.keys(mcpContent.mcpServers);
      }
    } catch {
      // Ignore
    }
  }

  // Read permissions
  const permissionsPath = join(pluginDir, 'permissions.json');
  if (existsSync(permissionsPath)) {
    try {
      const content = readFileSync(permissionsPath, 'utf-8');
      const pluginPerms: PluginPermissions = JSON.parse(content);
      result.permissions = pluginPerms.permissions.map(p => p.pattern);
    } catch {
      // Ignore
    }
  }

  return result;
}

/**
 * Execute a claude CLI command
 */
function runClaudeCommand(cli: string, args: string): { output: string; success: boolean } {
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
      output: err.message,
      success: false,
    };
  }
}

/**
 * Setup permissions in settings.json
 * Only adds new permissions, does not remove existing ones
 * (User may have customized permissions that should be preserved)
 */
function setupPermissions(
  requiredPermissions: string[],
  error: (msg: string) => void,
): { added: string[]; existing: string[]; success: boolean } {
  const settingsPath = join(homedir(), '.claude', 'settings.json');

  try {
    // Read existing settings
    let settings: Record<string, unknown> = {};
    if (existsSync(settingsPath)) {
      const content = readFileSync(settingsPath, 'utf-8');
      settings = JSON.parse(content);
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
    error(`Could not configure permissions: ${err.message}`);
    return { added: [], existing: [], success: false };
  }
}

/**
 * Install lenne.tech Claude Code Plugin
 */
const NewCommand: GluegunCommand = {
  alias: ['plugin', 'ip'],
  description: 'Installs/updates the lenne.tech Claude Code Plugin with skills, commands, and hooks',
  hidden: false,
  name: 'install-plugin',
  run: async (toolbox: ExtendedGluegunToolbox) => {
    const {
      helper,
      print: { error, info, spin, success },
      system,
    } = toolbox;

    // Start timer
    const timer = system.startTimer();

    info('Install lenne.tech Claude Code Plugin');

    // Check if claude CLI is available
    const cli = findClaudeCli();
    if (!cli) {
      error('Claude CLI not found. Please install Claude Code first.');
      info('');
      info('Installation: https://docs.anthropic.com/en/docs/claude-code');
      return process.exit(1);
    }

    // Step 1: Add marketplace
    const marketplaceSpinner = spin('Adding plugin marketplace');
    const addMarketplaceResult = runClaudeCommand(cli, `plugin marketplace add ${PLUGIN_CONFIG.marketplaceRepo}`);

    if (addMarketplaceResult.success || addMarketplaceResult.output.includes('already')) {
      marketplaceSpinner.succeed('Marketplace added');
    } else {
      marketplaceSpinner.fail('Failed to add marketplace');
      error(addMarketplaceResult.output);
      return process.exit(1);
    }

    // Step 2: Install or update plugin
    const fullPluginName = `${PLUGIN_CONFIG.pluginName}@${PLUGIN_CONFIG.marketplaceName}`;
    const pluginSpinner = spin('Installing/updating plugin');
    const installResult = runClaudeCommand(cli, `plugin install ${fullPluginName}`);

    let pluginAction = 'installed';
    if (installResult.output.includes('already') || installResult.output.includes('up to date')) {
      pluginAction = 'up to date';
    } else if (installResult.output.includes('update') || installResult.output.includes('upgrade')) {
      pluginAction = 'updated';
    }

    if (installResult.success || installResult.output.includes('already') || installResult.output.includes('up to date')) {
      pluginSpinner.succeed(`Plugin ${pluginAction}`);
    } else {
      pluginSpinner.fail('Failed to install plugin');
      error(installResult.output);
      info('');
      info('Manual installation:');
      info(`  /plugin marketplace add ${PLUGIN_CONFIG.marketplaceRepo}`);
      info(`  /plugin install ${fullPluginName}`);
      return process.exit(1);
    }

    // Step 3: Read plugin contents
    const pluginContents = readPluginContents(PLUGIN_CONFIG.marketplaceName);

    // Warn if plugin seems empty
    if (pluginContents.skills.length === 0 && pluginContents.commands.length === 0) {
      info('');
      info('Warning: No skills or commands found. Plugin may not be installed correctly.');
    }

    // Step 4: Setup permissions
    if (pluginContents.permissions.length > 0) {
      const permSpinner = spin('Configuring permissions');
      const permResult = setupPermissions(pluginContents.permissions, error);

      if (permResult.success) {
        if (permResult.added.length > 0) {
          permSpinner.succeed(`Permissions configured (${permResult.added.length} added)`);
        } else {
          permSpinner.succeed('Permissions already configured');
        }
      } else {
        permSpinner.fail('Failed to configure permissions');
        info('');
        info('Add manually to ~/.claude/settings.json:');
        info(JSON.stringify({ permissions: { allow: pluginContents.permissions } }, null, 2));
      }
    }

    // Success summary
    info('');
    success(`Plugin ${pluginAction} in ${helper.msToMinutesAndSeconds(timer())}m.`);

    if (pluginContents.skills.length > 0 || pluginContents.commands.length > 0) {
      info('');
      info('Installed:');
      if (pluginContents.skills.length > 0) {
        info(`  Skills (${pluginContents.skills.length}): ${pluginContents.skills.join(', ')}`);
      }
      if (pluginContents.commands.length > 0) {
        // Show first 5 commands, then "and X more"
        const maxShow = 5;
        const shown = pluginContents.commands.slice(0, maxShow);
        const remaining = pluginContents.commands.length - maxShow;
        const commandsStr = remaining > 0
          ? `${shown.join(', ')} and ${remaining} more`
          : shown.join(', ');
        info(`  Commands (${pluginContents.commands.length}): ${commandsStr}`);
      }
      if (pluginContents.hooks > 0) {
        info(`  Hooks: ${pluginContents.hooks} auto-detection hooks`);
      }
      if (pluginContents.mcpServers.length > 0) {
        info(`  MCP Servers (${pluginContents.mcpServers.length}): ${pluginContents.mcpServers.join(', ')}`);
      }
    }

    info('');
    info('Next:');
    info('  Restart Claude Code to activate the plugin');
    info('');

    if (!toolbox.parameters.options.fromGluegunMenu) {
      process.exit(0);
    }

    return 'plugin installed';
  },
};

export default NewCommand;
