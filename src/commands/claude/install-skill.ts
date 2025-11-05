import { GluegunCommand } from 'gluegun';
import { homedir } from 'os';
import { join } from 'path';

import { ExtendedGluegunToolbox } from '../../interfaces/extended-gluegun-toolbox';

/**
 * Install LT CLI Skill to ~/.claude/skills/lt-cli/
 */
const NewCommand: GluegunCommand = {
  alias: ['skill', 'is'],
  description: 'Installs the LT CLI Skill to ~/.claude/skills/ for Claude Code integration. The skill helps Claude generate correct LT CLI commands.',
  hidden: false,
  name: 'install-skill',
  run: async (toolbox: ExtendedGluegunToolbox) => {
    // Retrieve the tools we need
    const {
      filesystem,
      print: { error, info, spin, success },
    } = toolbox;

    const installSpinner = spin('Installing LT CLI Skill to ~/.claude/skills/lt-cli/');

    try {
      // Get the CLI installation directory
      const cliRoot = join(__dirname, '..', '..');
      const templatesDir = join(cliRoot, 'templates', 'claude-skills', 'lt-cli');

      // Check if templates exist
      if (!filesystem.exists(templatesDir)) {
        installSpinner.fail();
        error('Skill templates not found in CLI installation.');
        info(`Expected location: ${templatesDir}`);
        info('Please reinstall the CLI or report this issue.');
        return;
      }

      // Create ~/.claude/skills/lt-cli directory
      const skillsDir = join(homedir(), '.claude', 'skills', 'lt-cli');
      if (!filesystem.exists(skillsDir)) {
        filesystem.dir(skillsDir);
      }

      // Copy all skill files
      const skillFiles = ['SKILL.md', 'examples.md', 'reference.md'];
      let copiedCount = 0;

      for (const file of skillFiles) {
        const sourcePath = join(templatesDir, file);
        const targetPath = join(skillsDir, file);

        if (filesystem.exists(sourcePath)) {
          const content = filesystem.read(sourcePath);
          filesystem.write(targetPath, content);
          copiedCount++;
        } else {
          info(`Warning: ${file} not found in templates, skipping...`);
        }
      }

      if (copiedCount === 0) {
        installSpinner.fail();
        error('No skill files were copied.');
        return;
      }

      installSpinner.succeed(`Successfully installed LT CLI Skill to ${skillsDir}`);
      info('');
      success('The LT CLI Skill is now available in Claude Code!');
      info('');
      info('Claude will automatically use this skill when you:');
      info('  • Create server modules, objects, or properties');
      info('  • Work with NestJS/TypeScript backend code');
      info('  • Ask for help with LT CLI commands');
      info('');
      info('Try it out by asking Claude:');
      info('  "Create a User module with email and username"');
      info('');
      info(`Files installed: ${copiedCount} of ${skillFiles.length}`);
      info(`Location: ${skillsDir}`);

    } catch (err) {
      installSpinner.fail();
      error(`Failed to install skill: ${err.message}`);
      info('');
      info('Troubleshooting:');
      info('  • Ensure ~/.claude directory exists and is writable');
      info('  • Check file permissions');
      info('  • Try running with sudo if permission issues persist');
      return;
    }

    // For tests
    return 'claude install-skill';
  },
};

export default NewCommand;