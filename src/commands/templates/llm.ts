import { spawn } from 'child_process';
import { GluegunCommand } from 'gluegun';
import { join } from 'path';

import { ExtendedGluegunToolbox } from '../../interfaces/extended-gluegun-toolbox';

/**
 * Copy text to clipboard (cross-platform)
 */
async function copyToClipboard(text: string): Promise<boolean> {
  try {
    const platform = process.platform;
    if (platform === 'darwin') {
      return new Promise((resolve) => {
        const proc = spawn('pbcopy');
        proc.stdin.write(text);
        proc.stdin.end();
        proc.on('close', () => resolve(true));
        proc.on('error', () => resolve(false));
      });
    } else if (platform === 'linux') {
      try {
        return new Promise((resolve) => {
          const proc = spawn('xclip', ['-selection', 'clipboard']);
          proc.stdin.write(text);
          proc.stdin.end();
          proc.on('close', () => resolve(true));
          proc.on('error', () => resolve(false));
        });
      } catch {
        return false;
      }
    } else if (platform === 'win32') {
      return new Promise((resolve) => {
        const proc = spawn('clip');
        proc.stdin.write(text);
        proc.stdin.end();
        proc.on('close', () => resolve(true));
        proc.on('error', () => resolve(false));
      });
    }
    return false;
  } catch {
    return false;
  }
}

/**
 * Extract prompt content (everything after frontmatter)
 */
function getPromptContent(promptPath: string, filesystem: any): string {
  const content = filesystem.read(promptPath);
  // Remove frontmatter if present
  const withoutFrontmatter = content.replace(/^---\n[\s\S]*?\n---\n*/, '');
  return withoutFrontmatter.trim();
}

/**
 * Get prompt metadata from .md frontmatter
 */
function getPromptMetadata(promptPath: string, filesystem: any): { description: string; name: string } {
  if (!filesystem.exists(promptPath)) {
    return { description: 'No description available', name: '' };
  }

  const content = filesystem.read(promptPath);
  const frontmatterMatch = content.match(/^---\n([\s\S]*?)\n---/);
  if (!frontmatterMatch) {
    return { description: 'No description available', name: '' };
  }

  const frontmatter = frontmatterMatch[1];
  const descMatch = frontmatter.match(/description:\s*([^\n]+)/);
  const nameMatch = frontmatter.match(/name:\s*([^\n]+)/);

  return {
    description: descMatch ? descMatch[1].trim() : 'No description available',
    name: nameMatch ? nameMatch[1].trim() : '',
  };
}

/**
 * LLM Prompt Templates - Get prompts for various LLMs
 */
const LlmCommand: GluegunCommand = {
  alias: ['llm', 'prompts'],
  description: 'Get LLM prompt templates (e.g., for ChatGPT, Gemini, etc.)',
  hidden: false,
  name: 'llm',
  run: async (toolbox: ExtendedGluegunToolbox) => {
    const {
      filesystem,
      parameters,
      print: { error, highlight, info, success, warning },
      prompt,
    } = toolbox;

    try {
      // Get the CLI installation directory
      const cliRoot = join(__dirname, '..', '..');
      const promptsTemplateDir = join(cliRoot, 'templates', 'llm-prompts');

      // Check if llm-prompts directory exists
      if (!filesystem.exists(promptsTemplateDir)) {
        error('LLM prompts directory not found in CLI installation.');
        info(`Expected location: ${promptsTemplateDir}`);
        info('Please reinstall the CLI or report this issue.');
        return;
      }

      // Get all available prompts (*.md files)
      const allFiles = filesystem.list(promptsTemplateDir) || [];
      const availablePrompts = allFiles.filter(file => file.endsWith('.md'));

      if (availablePrompts.length === 0) {
        error('No LLM prompts found in CLI installation.');
        return;
      }

      // Show available prompts if no specific prompt requested
      let selectedPrompt: string;

      if (parameters.first) {
        // Check if the requested prompt exists
        const requestedPrompt = parameters.first.endsWith('.md')
          ? parameters.first
          : `${parameters.first}.md`;

        if (!availablePrompts.includes(requestedPrompt)) {
          error(`Prompt "${parameters.first}" not found.`);
          info('');
          info('Available prompts:');
          availablePrompts.forEach(p => {
            const promptPath = join(promptsTemplateDir, p);
            const metadata = getPromptMetadata(promptPath, filesystem);
            const promptName = p.replace('.md', '');
            info(`  • ${promptName}`);
            info(`    ${metadata.description}`);
            info('');
          });
          return;
        }
        selectedPrompt = requestedPrompt;
      } else {
        // Interactive mode: show menu
        info('');
        info('Available LLM Prompt Templates:');
        info('');

        const choices: Array<{ message: string; name: string; value: string }> = [];

        availablePrompts.forEach(p => {
          const promptPath = join(promptsTemplateDir, p);
          const metadata = getPromptMetadata(promptPath, filesystem);
          const promptName = p.replace('.md', '');
          choices.push({
            message: `${promptName} - ${metadata.description}`,
            name: promptName,
            value: p,
          });
        });

        const { selected } = await prompt.ask({
          choices: choices.map(c => c.message),
          message: 'Select a prompt template:',
          name: 'selected',
          type: 'select',
        });

        // Find the selected prompt file
        const selectedChoice = choices.find(c => c.message === selected);
        if (!selectedChoice) {
          error('Invalid selection.');
          return;
        }
        selectedPrompt = selectedChoice.value;
      }

      // Get prompt content
      const promptPath = join(promptsTemplateDir, selectedPrompt);
      const promptContent = getPromptContent(promptPath, filesystem);
      const metadata = getPromptMetadata(promptPath, filesystem);

      // Determine output method
      let outputMethod: string;

      if (parameters.options.output || parameters.options.o) {
        // Save to file
        outputMethod = 'file';
      } else if (parameters.options.clipboard || parameters.options.c) {
        // Copy to clipboard
        outputMethod = 'clipboard';
      } else if (parameters.options.display || parameters.options.d) {
        // Display only
        outputMethod = 'display';
      } else {
        // Interactive: ask user
        const { action } = await prompt.ask({
          choices: [
            'Display in terminal',
            'Copy to clipboard',
            'Save as Markdown file',
          ],
          message: 'What would you like to do with this prompt?',
          name: 'action',
          type: 'select',
        });

        if (action === 'Display in terminal') {
          outputMethod = 'display';
        } else if (action === 'Copy to clipboard') {
          outputMethod = 'clipboard';
        } else {
          outputMethod = 'file';
        }
      }

      // Execute output method
      if (outputMethod === 'clipboard') {
        const copied = await copyToClipboard(promptContent);
        if (copied) {
          success('✓ Prompt copied to clipboard!');
          info('');
          info('You can now paste it into ChatGPT, Gemini, Claude, or any other LLM.');
        } else {
          warning('Could not copy to clipboard automatically.');
          info('');
          info('The prompt will be displayed below for manual copying:');
          info('');
          info('─'.repeat(60));
          info(promptContent);
          info('─'.repeat(60));
        }
      } else if (outputMethod === 'display') {
        info('');
        info('─'.repeat(60));
        highlight(`📝 ${metadata.name || selectedPrompt.replace('.md', '')}`);
        info('─'.repeat(60));
        info('');
        info(promptContent);
        info('');
        info('─'.repeat(60));
        success('Prompt displayed above. Copy and paste into your preferred LLM.');
      } else if (outputMethod === 'file') {
        let outputPath: string;

        if (typeof parameters.options.output === 'string') {
          outputPath = parameters.options.output;
        } else if (typeof parameters.options.o === 'string') {
          outputPath = parameters.options.o;
        } else {
          // Ask for file path
          const defaultFilename = selectedPrompt;
          const { filepath } = await prompt.ask({
            initial: defaultFilename,
            message: 'Enter the file path to save:',
            name: 'filepath',
            type: 'input',
          });
          outputPath = filepath;
        }

        // Ensure .md extension
        if (!outputPath.endsWith('.md')) {
          outputPath += '.md';
        }

        // Check if file exists
        if (filesystem.exists(outputPath)) {
          const { overwrite } = await prompt.ask({
            initial: false,
            message: `File "${outputPath}" already exists. Overwrite?`,
            name: 'overwrite',
            type: 'confirm',
          });

          if (!overwrite) {
            info('Operation cancelled.');
            return;
          }
        }

        // Write file with frontmatter
        const fileContent = `---
name: ${metadata.name || selectedPrompt.replace('.md', '')}
description: ${metadata.description}
source: lenne.tech CLI (lt templates llm)
---

${promptContent}
`;

        filesystem.write(outputPath, fileContent);
        success(`✓ Prompt saved to: ${outputPath}`);
      }

      info('');

    } catch (err) {
      error(`Failed to process prompt: ${err.message}`);
      process.exit(1);
    }

    process.exit(0);
  },
};

export default LlmCommand;
