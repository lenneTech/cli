import * as ejs from 'ejs';
import { appendFileSync, existsSync, readdirSync, readFileSync, statSync } from 'fs';
import { GluegunCommand } from 'gluegun';
import { homedir } from 'os';
import { basename, dirname, join } from 'path';

import { ExtendedGluegunToolbox } from '../interfaces/extended-gluegun-toolbox';

interface CommandInfo {
  description: string;
  hidden: boolean;
  name: string;
}

/**
 * Tree node for recursive command structure
 */
interface CommandNode {
  children: CommandNode[];
  description: string;
  name: string;
  path: string; // Full path like "git_create" for variable naming
}

/**
 * Detect user's shell
 */
function detectShell(): string {
  const shell = process.env.SHELL || '';
  if (shell.includes('zsh')) return 'zsh';
  if (shell.includes('fish')) return 'fish';
  return 'bash';
}

/**
 * Discover commands recursively as a tree structure
 * Supports arbitrary nesting depth
 */
function discoverCommandTree(dir: string = __dirname, parentPath: string = ''): CommandNode[] {
  const nodes: CommandNode[] = [];

  if (!existsSync(dir)) {
    return nodes;
  }

  const entries = readdirSync(dir);

  for (const entry of entries) {
    const entryPath = join(dir, entry);
    const stat = statSync(entryPath);

    if (stat.isDirectory()) {
      // This is a command group (git, server, config, etc.)
      const groupName = entry;
      const nodePath = parentPath ? `${parentPath}_${groupName}` : groupName;

      // Recursively get children
      const children = discoverCommandTree(entryPath, nodePath);

      // Filter out the parent command file from children
      const filteredChildren = children.filter((c) => c.name !== groupName);

      // Only add if it has visible children
      if (filteredChildren.length > 0) {
        nodes.push({
          children: filteredChildren,
          description: `${groupName.charAt(0).toUpperCase()}${groupName.slice(1)} commands`,
          name: groupName,
          path: nodePath,
        });
      }
    } else if (stat.isFile() && (entry.endsWith('.js') || entry.endsWith('.ts'))) {
      const name = basename(entry, '.js').replace('.ts', '');

      // Skip internal files (lt.ts is the main entry point)
      if (name === 'lt') continue;

      const cmdInfo = extractCommandInfo(entryPath);
      if (cmdInfo && !cmdInfo.hidden) {
        const nodePath = parentPath ? `${parentPath}_${name}` : name;
        nodes.push({
          children: [],
          description: cmdInfo.description,
          name: cmdInfo.name,
          path: nodePath,
        });
      }
    }
  }

  // Add native Gluegun commands that are not in the file system
  if (!parentPath) {
    nodes.push({
      children: [],
      description: 'Show CLI version',
      name: 'version',
      path: 'version',
    });
    nodes.push({
      children: [],
      description: 'Alias for version',
      name: 'v',
      path: 'v',
    });
    nodes.push({
      children: [],
      description: 'Show help',
      name: 'help',
      path: 'help',
    });
    nodes.push({
      children: [],
      description: 'Alias for help',
      name: 'h',
      path: 'h',
    });
  }

  return nodes.sort((a, b) => a.name.localeCompare(b.name));
}

/**
 * Extract command info from a command file
 * Uses require() for both .js and .ts files (ts-node handles .ts in dev mode)
 */
function extractCommandInfo(filePath: string): CommandInfo | null {
  try {
    const cmd = require(filePath);
    const command = cmd.default || cmd;

    // Validate that we got a proper command object
    if (!command || typeof command.name !== 'string') {
      return null;
    }

    return {
      description: command.description || '',
      hidden: command.hidden || false,
      name: command.name,
    };
  } catch {
    // Ignore errors for individual files (missing dependencies, syntax errors, etc.)
    return null;
  }
}

/**
 * Generate completion script from EJS template
 */
function generateCompletionFromTemplate(shell: 'bash' | 'fish' | 'zsh', commandTree: CommandNode[]): string {
  const templateDir = getTemplateDir();
  const templatePath = join(templateDir, `${shell}.sh.ejs`);

  if (!existsSync(templatePath)) {
    throw new Error(`Template not found: ${templatePath}`);
  }

  const templateContent = readFileSync(templatePath, 'utf-8');
  const maxDepth = getMaxDepth(commandTree);

  return ejs.render(templateContent, {
    props: {
      commandTree,
      maxDepth,
    },
  });
}

/**
 * Get completion paths for static file installation
 * Uses ~/.local/share/lt/completions/ for Bash/Zsh (standard XDG location)
 * Uses ~/.config/fish/completions/ for Fish (auto-loaded by Fish)
 */
function getCompletionPaths(shell: string): {
  completionFile: string;
  configFile: null | string;
  sourceLine: null | string;
} {
  const home = homedir();
  const ltDir = join(home, '.local', 'share', 'lt', 'completions');

  switch (shell) {
    case 'fish':
      return {
        completionFile: join(home, '.config', 'fish', 'completions', 'lt.fish'),
        configFile: null, // Fish auto-loads from completions dir
        sourceLine: null,
      };
    case 'zsh':
      return {
        completionFile: join(ltDir, '_lt'),
        configFile: join(home, '.zshrc'),
        // Source the file directly - it uses compdef internally
        // This avoids calling compinit which conflicts with Powerlevel10k instant prompt
        sourceLine: `# lt CLI completion\n[ -f ~/.local/share/lt/completions/_lt ] && source ~/.local/share/lt/completions/_lt`,
      };
    case 'bash':
    default: {
      const bashProfile = join(home, '.bash_profile');
      return {
        completionFile: join(ltDir, 'lt.bash'),
        configFile: existsSync(bashProfile) ? bashProfile : join(home, '.bashrc'),
        sourceLine: `# lt CLI completion\n[ -f ~/.local/share/lt/completions/lt.bash ] && source ~/.local/share/lt/completions/lt.bash`,
      };
    }
  }
}

/**
 * Calculate maximum depth of command tree
 */
function getMaxDepth(nodes: CommandNode[], currentDepth: number = 1): number {
  let maxDepth = currentDepth;
  for (const node of nodes) {
    if (node.children.length > 0) {
      const childDepth = getMaxDepth(node.children, currentDepth + 1);
      maxDepth = Math.max(maxDepth, childDepth);
    }
  }
  return maxDepth;
}

/**
 * Get template directory path
 */
function getTemplateDir(): string {
  // In development (src), templates are in ../templates/completion
  // In production (dist), templates are in ../templates/completion
  const srcPath = join(__dirname, '..', 'templates', 'completion');
  if (existsSync(srcPath)) {
    return srcPath;
  }
  // Fallback for different directory structures
  return join(__dirname, '..', '..', 'src', 'templates', 'completion');
}

/**
 * Install completion using static files (no runtime overhead)
 * - Generates completion script to ~/.local/share/lt/completions/
 * - Adds source line to shell config (Bash/Zsh only)
 * - Fish auto-loads from ~/.config/fish/completions/
 */
async function installCompletion(
  toolbox: ExtendedGluegunToolbox,
  shell: string,
  options: { noConfirm?: boolean; silent?: boolean } = {},
): Promise<{ configFile: string; success: boolean }> {
  const {
    filesystem,
    print: { error, info, success, warning },
    prompt: { confirm },
  } = toolbox;

  const { noConfirm = false, silent = false } = options;
  const log = silent ? () => {} : info;
  const logSuccess = silent ? () => {} : success;
  const logWarning = silent ? () => {} : warning;
  const logError = silent ? () => {} : error;

  const paths = getCompletionPaths(shell);

  // Confirm installation (skip if noConfirm or Fish)
  if (!noConfirm && paths.configFile) {
    log('This will:');
    log(`  1. Generate completion script to ${paths.completionFile}`);
    log(`  2. Add source line to ${paths.configFile}`);
    log('');

    const proceed = await confirm('Install completion?', true);
    if (!proceed) {
      log('Installation cancelled.');
      return { configFile: paths.configFile || paths.completionFile, success: false };
    }
  }

  try {
    // Ensure completion directory exists
    const completionDir = dirname(paths.completionFile);
    if (!existsSync(completionDir)) {
      filesystem.dir(completionDir);
    }

    // Generate and write completion script
    const commandTree = discoverCommandTree();
    const script = generateCompletionFromTemplate(shell as 'bash' | 'fish' | 'zsh', commandTree);
    filesystem.write(paths.completionFile, script);

    // For Bash/Zsh: add source line to config if not already present
    if (paths.configFile && paths.sourceLine) {
      if (isSourceLineInstalled(paths.configFile)) {
        logSuccess(`Completions updated: ${paths.completionFile}`);
        logWarning(`Source line already in ${paths.configFile}`);
      } else {
        appendFileSync(paths.configFile, `\n${paths.sourceLine}\n`);
        logSuccess(`Completions installed to ${paths.completionFile}`);
        log('');
        log('Run the following to activate (or restart your terminal):');
        log(`  source ${paths.configFile}`);
      }
    } else {
      // Fish: just confirm file was written
      logSuccess(`Fish completions installed to ${paths.completionFile}`);
    }

    return { configFile: paths.configFile || paths.completionFile, success: true };
  } catch (e) {
    logError(`Failed to install: ${(e as Error).message}`);
    return { configFile: paths.configFile || paths.completionFile, success: false };
  }
}

/**
 * Check if source line is already in shell config
 */
function isSourceLineInstalled(configFile: null | string): boolean {
  if (!configFile || !existsSync(configFile)) {
    return false;
  }
  const content = readFileSync(configFile, 'utf-8');
  return content.includes('lt CLI completion') || content.includes('lt/completions');
}

/**
 * Generate shell completion scripts (using EJS templates)
 */
const CompletionCommand: GluegunCommand = {
  alias: ['comp'],
  description: 'Generate shell completions',
  hidden: false,
  name: 'completion',
  run: async (toolbox: ExtendedGluegunToolbox) => {
    const {
      parameters,
      print: { error, info },
    } = toolbox;

    const action = parameters.first?.toLowerCase();

    // Handle install command
    if (action === 'install') {
      const shell = (parameters.second?.toLowerCase() as string) || detectShell();
      if (!['bash', 'fish', 'zsh'].includes(shell)) {
        error(`Unknown shell: ${shell}`);
        return 'completion: install error';
      }
      const noConfirm = parameters.options.noConfirm || parameters.options.y || false;
      const silent = parameters.options.silent || parameters.options.s || false;
      const result = await installCompletion(toolbox, shell, { noConfirm, silent });
      return result.success ? `completion: installed ${shell}` : 'completion: install cancelled';
    }

    // Show help if no valid shell specified
    if (!action || !['bash', 'fish', 'zsh'].includes(action)) {
      info('Usage: lt completion <shell|install>');
      info('');
      info('Commands:');
      info('  bash     Output Bash completion script');
      info('  zsh      Output Zsh completion script');
      info('  fish     Output Fish completion script');
      info('  install  Install completion (recommended)');
      info('');
      info('Installation (recommended):');
      info('  lt completion install');
      info('');
      info('This generates static completion files that are loaded at shell startup.');
      info('Completions are auto-updated on CLI install/update.');
      info('');
      info('Locations:');
      info('  Bash/Zsh: ~/.local/share/lt/completions/');
      info('  Fish:     ~/.config/fish/completions/lt.fish');
      return 'completion: help';
    }

    // Discover commands dynamically as tree
    const commandTree = discoverCommandTree();

    // Generate and output the appropriate script using templates
    try {
      const script = generateCompletionFromTemplate(action as 'bash' | 'fish' | 'zsh', commandTree);
      process.stdout.write(script);
      return `completion: ${action}`;
    } catch (e) {
      error(`Failed to generate completion: ${(e as Error).message}`);
      return 'completion: error';
    }
  },
};

export default CompletionCommand;
