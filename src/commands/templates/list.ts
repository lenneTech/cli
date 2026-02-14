import { GluegunCommand } from 'gluegun';
import { join } from 'path';

import { ExtendedGluegunToolbox } from '../../interfaces/extended-gluegun-toolbox';

/**
 * List available templates
 */
const ListTemplatesCommand: GluegunCommand = {
  alias: ['ls'],
  description: 'List available templates',
  hidden: false,
  name: 'list',
  run: async (toolbox: ExtendedGluegunToolbox) => {
    const {
      filesystem,
      print: { colors, info, success },
      runtime,
    } = toolbox;

    info('');
    info(colors.bold('Available Templates'));
    info(colors.dim('─'.repeat(50)));

    // Built-in templates
    const builtInPath = join(__dirname, '..', '..', 'templates');
    const builtInTemplates = getTemplatesFromDirectory(filesystem, builtInPath);

    if (builtInTemplates.length > 0) {
      info('');
      info(colors.bold('Built-in Templates:'));
      builtInTemplates.forEach((template) => {
        info(`  ${colors.cyan(template.name)} ${colors.dim(`(${template.type})`)}`);
      });
    }

    // Custom templates from ~/.lt/templates
    const customPath = join(filesystem.homedir(), `.${runtime.brand}`, 'templates');
    const customTemplates = getTemplatesFromDirectory(filesystem, customPath);

    if (customTemplates.length > 0) {
      info('');
      info(colors.bold('Custom Templates:'));
      customTemplates.forEach((template) => {
        info(`  ${colors.cyan(template.name)} ${colors.dim(`(${template.type})`)}`);
      });
    } else {
      info('');
      info(colors.dim('No custom templates found.'));
      info(colors.dim(`Add templates to: ${customPath}`));
    }

    // Project templates from ./lt-templates
    const projectPath = join(filesystem.cwd(), 'lt-templates');
    const projectTemplates = getTemplatesFromDirectory(filesystem, projectPath);

    if (projectTemplates.length > 0) {
      info('');
      info(colors.bold('Project Templates:'));
      projectTemplates.forEach((template) => {
        info(`  ${colors.cyan(template.name)} ${colors.dim(`(${template.type})`)}`);
      });
    }

    info('');
    success('Template directories:');
    info(`  Built-in: ${builtInPath}`);
    info(`  Custom:   ${customPath}`);
    info(`  Project:  ${projectPath}`);
    info('');

    return {
      builtIn: builtInTemplates,
      custom: customTemplates,
      project: projectTemplates,
    };
  },
};

interface TemplateInfo {
  name: string;
  path: string;
  type: string;
}

function getTemplatesFromDirectory(filesystem: ExtendedGluegunToolbox['filesystem'], dirPath: string): TemplateInfo[] {
  const templates: TemplateInfo[] = [];

  if (!filesystem.exists(dirPath)) {
    return templates;
  }

  const entries = filesystem.list(dirPath) || [];

  for (const entry of entries) {
    const entryPath = join(dirPath, entry);
    if (filesystem.isDirectory(entryPath)) {
      // Determine template type
      let type = 'directory';
      if (filesystem.exists(join(entryPath, 'template.json'))) {
        type = 'configured';
      } else if (entry.includes('server')) {
        type = 'server';
      } else if (entry.includes('starter')) {
        type = 'starter';
      } else if (entry.includes('deployment')) {
        type = 'deployment';
      }

      templates.push({
        name: entry,
        path: entryPath,
        type,
      });
    }
  }

  return templates.sort((a, b) => a.name.localeCompare(b.name));
}

export default ListTemplatesCommand;
