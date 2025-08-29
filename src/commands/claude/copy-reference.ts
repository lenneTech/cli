import { GluegunCommand } from 'gluegun';
import { homedir } from 'os';
import { join } from 'path';

import { ExtendedGluegunToolbox } from '../../interfaces/extended-gluegun-toolbox';

/**
 * Copy LT-CLI-Reference.md to ~/.claude/CLAUDE.md
 */
const NewCommand: GluegunCommand = {
  alias: ['copy-ref', 'cr'],
  description: 'Copies LT-CLI-Reference.md to ~/.claude/CLAUDE.md for Claude Code integration',
  hidden: false,
  name: 'copy-reference',
  run: async (toolbox: ExtendedGluegunToolbox) => {
    // Retrieve the tools we need
    const {
      filesystem,
      http,
      print: { error, info, spin, success },
    } = toolbox;

    const copySpinner = spin('Downloading LT-CLI-Reference.md and copying to ~/.claude/CLAUDE.md');

    let referenceContent: string;

    try {
      // First try to download the latest version from GitHub
      const referenceUrl = 'https://raw.githubusercontent.com/lenneTech/cli/refs/heads/main/LT-CLI-Reference.md';
      const response = await http.create({ baseURL: '' }).get(referenceUrl);

      if (response.ok) {
        referenceContent = response.data as string;
        copySpinner.text = 'Downloaded latest reference from GitHub, copying to ~/.claude/CLAUDE.md';
      } else {
        throw new Error(`GitHub download failed: ${response.status}`);
      }
    } catch (downloadError) {
      // Fallback to locally stored version
      copySpinner.text = 'GitHub download failed, trying local version...';
      
      try {
        // Get the CLI installation directory using relative paths from __dirname
        const cliRoot = join(__dirname, '..', '..', '..');
        const localSourceFile = join(cliRoot, 'LT-CLI-Reference.md');
        
        if (filesystem.exists(localSourceFile)) {
          referenceContent = filesystem.read(localSourceFile);
          copySpinner.text = 'Using local reference file, copying to ~/.claude/CLAUDE.md';
        } else {
          throw new Error('Local reference file not found');
        }
      } catch (localError) {
        copySpinner.fail();
        error('Failed to download from GitHub and local file not found.');
        info(`GitHub error: ${downloadError.message}`);
        info(`Local error: ${localError.message}`);
        info('Please check your internet connection or reinstall the CLI.');
        return;
      }
    }

    try {

      // Create ~/.claude directory if it doesn't exist
      const claudeDir = join(homedir(), '.claude');
      if (!filesystem.exists(claudeDir)) {
        filesystem.dir(claudeDir);
      }

      // Target file path
      const targetFile = join(claudeDir, 'CLAUDE.md');

      // Write the content to the target file
      filesystem.write(targetFile, referenceContent);

      copySpinner.succeed(`Successfully copied LT-CLI-Reference.md to ${targetFile}`);
      info('');
      success('The CLI reference is now available to Claude Code!');
      info('Claude Code will automatically use this file to understand the LT CLI commands.');

    } catch (err) {
      copySpinner.fail();
      error(`Failed to download or copy file: ${err.message}`);
      return;
    }

    // For tests
    return 'claude copy-reference';
  },
};

export default NewCommand;
