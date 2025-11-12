import { GluegunCommand } from 'gluegun';
import { homedir } from 'os';
import { join } from 'path';

import { ExtendedGluegunToolbox } from '../../interfaces/extended-gluegun-toolbox';

/**
 * Get command description from .md frontmatter
 */
function getCommandDescription(commandPath: string, filesystem: any): string {
  if (!filesystem.exists(commandPath)) {
    return 'No description available';
  }

  const content = filesystem.read(commandPath);
  const frontmatterMatch = content.match(/^---\n([\s\S]*?)\n---/);
  if (!frontmatterMatch) {
    return 'No description available';
  }

  const frontmatter = frontmatterMatch[1];
  const descMatch = frontmatter.match(/description:\s*([^\n]+)/);

  return descMatch ? descMatch[1].trim() : 'No description available';
}

/**
 * Compare semantic versions
 * Returns true if sourceVersion >= targetVersion
 */
function isVersionNewer(sourceVersion: string, targetVersion: string): boolean {
  const parseSemver = (version: string): number[] => {
    return version.split('.').map(n => parseInt(n, 10) || 0);
  };

  const source = parseSemver(sourceVersion);
  const target = parseSemver(targetVersion);

  // Compare major, minor, patch
  for (let i = 0; i < 3; i++) {
    if (source[i] > target[i]) {
      return true;
    }
    if (source[i] < target[i]) {
      return false;
    }
  }

  // Versions are equal
  return true;
}

/**
 * Parse frontmatter from markdown file and extract version
 */
function parseVersion(content: string): null | string {
  const frontmatterMatch = content.match(/^---\n([\s\S]*?)\n---/);
  if (!frontmatterMatch) {
    return null;
  }

  const frontmatter = frontmatterMatch[1];
  const versionMatch = frontmatter.match(/version:\s*([^\n]+)/);

  return versionMatch ? versionMatch[1].trim() : null;
}

/**
 * Install Claude Commands to ~/.claude/commands/ or .claude/commands/
 */
const NewCommand: GluegunCommand = {
  alias: ['commands', 'ic'],
  description: 'Installs Claude Custom Commands to ~/.claude/commands/ or .claude/commands/ for Claude Code integration. Use --global for global installation, --project for project-specific installation.',
  hidden: false,
  name: 'install-commands',
  run: async (toolbox: ExtendedGluegunToolbox) => {
    // Retrieve the tools we need
    const {
      filesystem,
      parameters,
      print: { error, info, spin, success },
      prompt,
    } = toolbox;

    try {
      // Get the CLI installation directory
      const cliRoot = join(__dirname, '..', '..');
      const commandsTemplateDir = join(cliRoot, 'templates', 'claude-commands');

      // Check if claude-commands directory exists
      if (!filesystem.exists(commandsTemplateDir)) {
        error('Claude commands directory not found in CLI installation.');
        info(`Expected location: ${commandsTemplateDir}`);
        info('Please reinstall the CLI or report this issue.');
        return;
      }

      // Get all available commands (*.md files, excluding README.md)
      const allFiles = filesystem.list(commandsTemplateDir) || [];
      const availableCommands = allFiles.filter(file =>
        file.endsWith('.md') && file !== 'README.md'
      );

      if (availableCommands.length === 0) {
        error('No commands found in CLI installation.');
        return;
      }

      // Determine installation scope
      const cwd = filesystem.cwd();
      let scope: 'global' | 'project' = 'global';
      let commandsDir = join(homedir(), '.claude', 'commands');
      const skipInteractive = parameters.options.y || parameters.options.yes || parameters.options['no-interactive'];

      // Check if user specified scope
      if (parameters.options.global) {
        scope = 'global';
        commandsDir = join(homedir(), '.claude', 'commands');
      } else if (parameters.options.project) {
        scope = 'project';
        commandsDir = join(cwd, '.claude', 'commands');
      } else {
        // Detect if we're in a project
        let packageJsonPath = null;
        let searchDir = cwd;

        // Search up to 3 levels for package.json
        for (let i = 0; i < 3; i++) {
          const testPath = join(searchDir, 'package.json');
          if (filesystem.exists(testPath)) {
            packageJsonPath = testPath;
            break;
          }
          const parent = join(searchDir, '..');
          if (parent === searchDir) break; // Reached root
          searchDir = parent;
        }

        // If in a project, ask where to install
        if (packageJsonPath && !skipInteractive) {
          info('');
          info(`Detected project at: ${searchDir}`);
          const installToProject = await prompt.confirm(
            'Install commands to this project only? (No = install globally for all projects)',
            true
          );

          scope = installToProject ? 'project' : 'global';

          if (scope === 'project') {
            commandsDir = join(searchDir, '.claude', 'commands');
          }
        } else if (packageJsonPath && skipInteractive) {
          // In non-interactive mode with project detected, default to global
          scope = 'global';
        }
      }

      // Create commands directory if it doesn't exist
      if (!filesystem.exists(commandsDir)) {
        filesystem.dir(commandsDir);
      }

      info('');
      info('Available commands:');
      info('');

      // Show all available commands with descriptions
      availableCommands.forEach(cmd => {
        const cmdPath = join(commandsTemplateDir, cmd);
        const desc = getCommandDescription(cmdPath, filesystem);
        const cmdName = cmd.replace('.md', '');
        info(`  • /${cmdName}`);
        info(`    ${desc}`);
        info('');
      });

      let commandsToInstall: string[] = [];

      // Check if specific commands provided as parameters
      if (parameters.first && parameters.first !== 'all') {
        // Non-interactive mode: install specific command(s)
        const requestedCommands = parameters.array || [parameters.first];

        // Add .md extension if not present
        const requestedWithExt = requestedCommands.map(c =>
          c.endsWith('.md') ? c : `${c}.md`
        );

        // Validate requested commands
        const invalidCommands = requestedWithExt.filter(c => !availableCommands.includes(c));
        if (invalidCommands.length > 0) {
          error(`Invalid command(s): ${invalidCommands.map(c => c.replace('.md', '')).join(', ')}`);
          info('');
          info('Available commands:');
          availableCommands.forEach(c => {
            const cmdName = c.replace('.md', '');
            info(`  • ${cmdName}`);
          });
          return;
        }

        commandsToInstall = requestedWithExt;
      } else if (parameters.first === 'all' || skipInteractive) {
        // Install all commands without prompting
        commandsToInstall = availableCommands;
        if (skipInteractive) {
          info('Installing all commands (non-interactive mode)...');
        }
      } else {
        // Interactive mode: ask if user wants all or select individually
        const installAll = await prompt.confirm('Install all commands?', true);

        if (installAll) {
          commandsToInstall = availableCommands;
        } else {
          // Ask for each command
          info('');
          info('Select which commands to install:');
          info('');

          for (const cmd of availableCommands) {
            const cmdName = cmd.replace('.md', '');
            const shouldInstall = await prompt.confirm(`Install /${cmdName}?`, true);
            if (shouldInstall) {
              commandsToInstall.push(cmd);
            }
          }

          if (commandsToInstall.length === 0) {
            info('No commands selected. Installation cancelled.');
            return;
          }
        }
      }

      const installSpinner = spin(`Installing ${commandsToInstall.length} command(s) to ${scope === 'global' ? '~/.claude/commands/' : '.claude/commands/'}...`);

      let copiedCount = 0;
      let skippedCount = 0;
      let updatedCount = 0;
      const skippedFiles: Array<{ file: string; reason: string }> = [];

      // Install each command
      for (const cmd of commandsToInstall) {
        const sourcePath = join(commandsTemplateDir, cmd);
        const targetPath = join(commandsDir, cmd);

        const sourceContent = filesystem.read(sourcePath);

        // Check if target file exists
        if (filesystem.exists(targetPath)) {
          const targetContent = filesystem.read(targetPath);

          // Parse versions from both files
          const sourceVersion = parseVersion(sourceContent);
          const targetVersion = parseVersion(targetContent);

          // If both have versions, compare them
          if (sourceVersion && targetVersion) {
            if (isVersionNewer(sourceVersion, targetVersion)) {
              // Source is newer or equal, update
              filesystem.write(targetPath, sourceContent);
              updatedCount++;
              copiedCount++;
            } else {
              // Target is newer, skip
              skippedCount++;
              const reason = `local version ${targetVersion} is newer than ${sourceVersion}`;
              skippedFiles.push({ file: cmd, reason });
            }
          } else if (sourceVersion && !targetVersion) {
            // Source has version, target doesn't - update
            filesystem.write(targetPath, sourceContent);
            updatedCount++;
            copiedCount++;
          } else {
            // No version info, always update (backward compatibility)
            filesystem.write(targetPath, sourceContent);
            updatedCount++;
            copiedCount++;
          }
        } else {
          // Target doesn't exist, create new
          filesystem.write(targetPath, sourceContent);
          copiedCount++;
        }
      }

      if (copiedCount === 0 && skippedCount === 0) {
        installSpinner.fail();
        error('No command files were processed.');
        return;
      }

      if (copiedCount === 0 && skippedCount > 0) {
        installSpinner.succeed('All selected commands are already up to date!');
        info('');
        info(`Skipped: ${skippedCount} file(s)`);
        info(`Location: ${commandsDir}`);
        return;
      }

      installSpinner.succeed(`Successfully installed ${commandsToInstall.length} command(s)!`);
      info('');

      if (updatedCount > 0 && skippedCount > 0) {
        success(`Updated ${updatedCount} file(s), skipped ${skippedCount} file(s)`);
      } else if (updatedCount > 0) {
        success(`Updated ${updatedCount} file(s)`);
      } else {
        success(`Created ${copiedCount} file(s)`);
      }

      info('');
      info('Installed commands:');
      commandsToInstall.forEach(cmd => {
        const cmdPath = join(commandsTemplateDir, cmd);
        const desc = getCommandDescription(cmdPath, filesystem);
        const cmdName = cmd.replace('.md', '');
        info(`  • /${cmdName}`);
        info(`    ${desc.substring(0, 80)}${desc.length > 80 ? '...' : ''}`);
      });

      info('');
      info('These commands are now available in Claude Code!');

      // Show first installed command as example
      const firstCmd = commandsToInstall[0]?.replace('.md', '');
      info(`Use them by typing the command name with a leading slash, e.g., /${firstCmd || 'command-name'}`);
      info('');
      info('Examples:');

      // Show up to 5 commands as examples (or all if less than 5)
      const exampleCount = Math.min(commandsToInstall.length, 5);
      for (let i = 0; i < exampleCount; i++) {
        const cmd = commandsToInstall[i];
        const cmdPath = join(commandsTemplateDir, cmd);
        const desc = getCommandDescription(cmdPath, filesystem);
        const cmdName = cmd.replace('.md', '');
        info(`  • /${cmdName} - ${desc}`);
      }

      info('');
      info(`Location: ${commandsDir}`);
      info(`Scope: ${scope === 'global' ? 'Global (all projects)' : 'Project-specific'}`);

      if (skippedCount > 0) {
        info('');
        info(`Note: ${skippedCount} file(s) were skipped because your local versions are newer:`);
        skippedFiles.forEach(({ file, reason }) => {
          info(`  • ${file} (${reason})`);
        });
        info('');
        info('To force update, manually delete the files and run this command again.');
      }

    } catch (err) {
      error(`Failed to install command(s): ${err.message}`);
      info('');
      info('Troubleshooting:');
      info('  • Ensure .claude directory exists and is writable');
      info('  • Check file permissions');
      info('  • Try running with sudo if permission issues persist');
      return;
    }

    // For tests
    return `claude install-commands`;
  },
};

export default NewCommand;
