import { execSync } from 'child_process';
import { existsSync } from 'fs';
import { GluegunCommand } from 'gluegun';
import { homedir } from 'os';
import { join } from 'path';

import { ExtendedGluegunToolbox } from '../../interfaces/extended-gluegun-toolbox';
import { getAllMcps, getMcpById, McpEntry } from '../../lib/mcp-registry';

/**
 * Find the claude CLI executable path
 * Checks common installation locations
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

  // Try to find via 'which' command
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

let claudePath: null | string = null;

/**
 * Get claude CLI path (cached)
 */
function getClaudeCli(): null | string {
  if (claudePath === null) {
    claudePath = findClaudeCli();
  }
  return claudePath;
}

/**
 * Install an MCP using claude mcp add command
 */
function installMcp(mcp: McpEntry): { error?: string; success: boolean } {
  const cli = getClaudeCli();
  if (!cli) {
    return { error: 'Claude CLI not found', success: false };
  }

  try {
    // Build the command with optional transport flag for remote MCPs
    const transportFlag = mcp.transport ? `--transport ${mcp.transport} ` : '';
    const command = `"${cli}" mcp add ${transportFlag}${mcp.command}`;
    execSync(command, { encoding: 'utf-8', shell: '/bin/bash', stdio: 'inherit' });
    return { success: true };
  } catch (err) {
    return { error: err.message, success: false };
  }
}

/**
 * Check if an MCP is already installed by checking Claude's MCP list
 */
function isMcpInstalled(mcpId: string): boolean {
  const cli = getClaudeCli();
  if (!cli) return false;

  try {
    const result = execSync(`"${cli}" mcp list`, { encoding: 'utf-8', shell: '/bin/bash', stdio: ['pipe', 'pipe', 'pipe'] });
    return result.includes(mcpId);
  } catch {
    // If command fails, assume not installed
    return false;
  }
}

/**
 * Install Claude MCPs (Model Context Protocol servers)
 */
const NewCommand: GluegunCommand = {
  alias: ['mcps', 'im'],
  description: 'Installs Claude MCPs (Model Context Protocol servers) for enhanced Claude Code capabilities. Use -y to skip interactive selection and install all MCPs.',
  hidden: false,
  name: 'install-mcps',
  run: async (toolbox: ExtendedGluegunToolbox) => {
    const {
      parameters,
      print: { error, info, spin, success, warning },
      prompt,
    } = toolbox;

    try {
      // Check if claude CLI is available
      const cli = getClaudeCli();
      if (!cli) {
        error('Claude CLI not found. Please install Claude Code first.');
        info('');
        info('Installation: https://docs.anthropic.com/en/docs/claude-code');
        return;
      }

      const availableMcps = getAllMcps();

      if (availableMcps.length === 0) {
        error('No MCPs defined in registry.');
        info('Add MCPs to src/commands/claude/mcp-registry.ts');
        return;
      }

      const skipInteractive = parameters.options.y || parameters.options.yes || parameters.options['no-interactive'];

      // Show available MCPs
      info('');
      info('Available MCPs (Model Context Protocol servers):');
      info('');

      for (const mcp of availableMcps) {
        const installed = isMcpInstalled(mcp.id);
        const statusIcon = installed ? '✓' : '○';
        const statusText = installed ? ' (installed)' : '';
        info(`  ${statusIcon} ${mcp.name}${statusText}`);
        info(`    ${mcp.description}`);
        if (mcp.category) {
          info(`    Category: ${mcp.category}`);
        }
        info('');
      }

      let mcpsToInstall: McpEntry[] = [];

      // Check if specific MCPs provided as parameters
      if (parameters.first && parameters.first !== 'all') {
        // Non-interactive mode: install specific MCP(s)
        const requestedMcps = parameters.array || [parameters.first];

        // Validate requested MCPs
        const invalidMcps: string[] = [];
        const validMcps: McpEntry[] = [];

        for (const mcpId of requestedMcps) {
          const mcp = getMcpById(mcpId);
          if (mcp) {
            validMcps.push(mcp);
          } else {
            invalidMcps.push(mcpId);
          }
        }

        if (invalidMcps.length > 0) {
          error(`Invalid MCP(s): ${invalidMcps.join(', ')}`);
          info('');
          info('Available MCPs:');
          availableMcps.forEach(m => {
            info(`  • ${m.id} - ${m.name}`);
          });
          return;
        }

        mcpsToInstall = validMcps;
      } else if (parameters.first === 'all' || skipInteractive) {
        // Install all MCPs without prompting
        mcpsToInstall = availableMcps;
        if (skipInteractive) {
          info('Installing all MCPs (non-interactive mode)...');
        }
      } else {
        // Interactive mode: ask for each MCP
        const installAll = await prompt.confirm('Install all MCPs?', true);

        if (installAll) {
          mcpsToInstall = availableMcps;
        } else {
          info('');
          info('Select which MCPs to install:');
          info('');

          for (const mcp of availableMcps) {
            const installed = isMcpInstalled(mcp.id);
            if (installed) {
              info(`  ✓ ${mcp.name} is already installed, skipping...`);
              continue;
            }

            const shouldInstall = await prompt.confirm(`Install ${mcp.name}?`, true);
            if (shouldInstall) {
              mcpsToInstall.push(mcp);
            }
          }

          if (mcpsToInstall.length === 0) {
            info('No MCPs selected. Installation cancelled.');
            return;
          }
        }
      }

      // Filter out already installed MCPs
      const notInstalled = mcpsToInstall.filter(mcp => !isMcpInstalled(mcp.id));
      const alreadyInstalled = mcpsToInstall.filter(mcp => isMcpInstalled(mcp.id));

      if (alreadyInstalled.length > 0) {
        info('');
        info('Already installed:');
        alreadyInstalled.forEach(mcp => {
          info(`  ✓ ${mcp.name}`);
        });
      }

      if (notInstalled.length === 0) {
        info('');
        success('All selected MCPs are already installed!');
        return;
      }

      info('');
      const installSpinner = spin(`Installing ${notInstalled.length} MCP(s)...`);
      installSpinner.stop();

      let installedCount = 0;
      let failedCount = 0;
      const failedMcps: Array<{ error: string; mcp: McpEntry }> = [];

      for (const mcp of notInstalled) {
        info('');
        info(`Installing ${mcp.name}...`);

        const result = installMcp(mcp);

        if (result.success) {
          success(`  ✓ ${mcp.name} installed successfully`);
          installedCount++;
        } else {
          warning(`  ✗ Failed to install ${mcp.name}`);
          failedMcps.push({ error: result.error || 'Unknown error', mcp });
          failedCount++;
        }
      }

      info('');
      if (installedCount > 0) {
        success(`Successfully installed ${installedCount} MCP(s)!`);
      }

      if (failedCount > 0) {
        warning(`Failed to install ${failedCount} MCP(s):`);
        failedMcps.forEach(({ error: err, mcp }) => {
          info(`  • ${mcp.name}: ${err}`);
        });
      }

      info('');
      info('MCPs are now available in Claude Code!');
      info('');
      info('Manage MCPs with:');
      info('  • claude mcp list     - List installed MCPs');
      info('  • claude mcp remove   - Remove an MCP');

    } catch (err) {
      error(`Failed to install MCP(s): ${err.message}`);
      info('');
      info('Troubleshooting:');
      info('  • Ensure Claude CLI is installed and configured');
      info('  • Check your internet connection');
      info('  • Try running with sudo if permission issues persist');
      process.exit(1);
    }

    process.exit(0);
  },
};

export default NewCommand;
