import { GluegunCommand } from 'gluegun';
import { join } from 'path';

import { ExtendedGluegunToolbox } from '../interfaces/extended-gluegun-toolbox';

interface ProjectInfo {
  configFiles: string[];
  gitBranch: null | string;
  gitRoot: null | string;
  hasGit: boolean;
  hasLtConfig: boolean;
  hasPackageJson: boolean;
  nodeVersion: null | string;
  npmVersion: null | string;
  packageName: null | string;
  packageVersion: null | string;
  projectType: string;
}

/**
 * Show project status and context
 */
const StatusCommand: GluegunCommand = {
  alias: ['st'],
  description: 'Show project status',
  hidden: false,
  name: 'status',
  run: async (toolbox: ExtendedGluegunToolbox) => {
    const {
      filesystem,
      print: { colors, info, success, warning },
      system,
    } = toolbox;

    const cwd = filesystem.cwd();

    info('');
    info(colors.bold('Project Status'));
    info(colors.dim('─'.repeat(50)));

    const projectInfo: ProjectInfo = {
      configFiles: [],
      gitBranch: null,
      gitRoot: null,
      hasGit: false,
      hasLtConfig: false,
      hasPackageJson: false,
      nodeVersion: null,
      npmVersion: null,
      packageName: null,
      packageVersion: null,
      projectType: 'unknown',
    };

    // Check for lt.config
    const ltConfigFiles = ['lt.config.json', 'lt.config.yaml', 'lt.config'];
    for (const configFile of ltConfigFiles) {
      if (filesystem.exists(join(cwd, configFile))) {
        projectInfo.hasLtConfig = true;
        projectInfo.configFiles.push(configFile);
      }
    }

    // Check for package.json
    const packageJsonPath = join(cwd, 'package.json');
    if (filesystem.exists(packageJsonPath)) {
      projectInfo.hasPackageJson = true;
      try {
        const packageJson = JSON.parse(filesystem.read(packageJsonPath) || '{}');
        projectInfo.packageName = packageJson.name || null;
        projectInfo.packageVersion = packageJson.version || null;

        // Detect project type
        const deps = { ...packageJson.dependencies, ...packageJson.devDependencies };
        if (deps['@lenne.tech/nest-server']) {
          projectInfo.projectType = 'nest-server';
        } else if (deps['@nestjs/core']) {
          projectInfo.projectType = 'nestjs';
        } else if (deps['nuxt']) {
          projectInfo.projectType = 'nuxt';
        } else if (deps['@angular/core']) {
          projectInfo.projectType = 'angular';
        } else if (deps['react']) {
          projectInfo.projectType = 'react';
        } else if (deps['vue']) {
          projectInfo.projectType = 'vue';
        } else if (deps['typescript']) {
          projectInfo.projectType = 'typescript';
        } else if (packageJson.name) {
          projectInfo.projectType = 'node';
        }
      } catch {
        // Ignore parse errors
      }
    }

    // Check for git
    try {
      const gitRoot = await system.run('git rev-parse --show-toplevel 2>/dev/null');
      if (gitRoot?.trim()) {
        projectInfo.hasGit = true;
        projectInfo.gitRoot = gitRoot.trim();
        const branch = await system.run('git rev-parse --abbrev-ref HEAD 2>/dev/null');
        projectInfo.gitBranch = branch?.trim() || null;
      }
    } catch {
      // Not a git repository
    }

    // Get Node/npm versions
    try {
      projectInfo.nodeVersion = (await system.run('node --version 2>/dev/null'))?.trim() || null;
      projectInfo.npmVersion = (await system.run('npm --version 2>/dev/null'))?.trim() || null;
    } catch {
      // Ignore errors
    }

    // Display project info
    info('');
    info(colors.bold('Directory:'));
    info(`  ${cwd}`);

    if (projectInfo.hasPackageJson) {
      info('');
      info(colors.bold('Package:'));
      if (projectInfo.packageName) {
        info(`  Name:    ${projectInfo.packageName}`);
      }
      if (projectInfo.packageVersion) {
        info(`  Version: ${projectInfo.packageVersion}`);
      }
      info(`  Type:    ${formatProjectType(projectInfo.projectType)}`);
    }

    if (projectInfo.hasGit) {
      info('');
      info(colors.bold('Git:'));
      info(`  Branch: ${projectInfo.gitBranch || 'unknown'}`);
      if (projectInfo.gitRoot !== cwd) {
        info(`  Root:   ${projectInfo.gitRoot}`);
      }
    }

    info('');
    info(colors.bold('Configuration:'));
    if (projectInfo.hasLtConfig) {
      success(`  lt.config: ${projectInfo.configFiles.join(', ')}`);
    } else {
      warning('  lt.config: Not found');
      info(colors.dim('  Run "lt config init" to create one'));
    }

    info('');
    info(colors.bold('Environment:'));
    if (projectInfo.nodeVersion) {
      info(`  Node:            ${projectInfo.nodeVersion}`);
    }
    if (projectInfo.npmVersion) {
      info(`  npm:             v${projectInfo.npmVersion}`);
    }
    const detectedPm = toolbox.pm.detect();
    info(`  Package Manager: ${detectedPm}`);

    // Show available commands based on project type
    info('');
    info(colors.bold('Available Commands:'));
    const commands = getAvailableCommands(projectInfo.projectType);
    commands.forEach(cmd => info(`  ${colors.cyan(cmd.command)} - ${cmd.description}`));

    info('');

    // For tests
    return `status ${projectInfo.projectType}`;
  },
};

function formatProjectType(type: string): string {
  const typeMap: Record<string, string> = {
    'angular': 'Angular',
    'nest-server': 'lenne.tech Nest Server',
    'nestjs': 'NestJS',
    'node': 'Node.js',
    'nuxt': 'Nuxt',
    'react': 'React',
    'typescript': 'TypeScript',
    'unknown': 'Unknown',
    'vue': 'Vue',
  };
  return typeMap[type] || type;
}

function getAvailableCommands(projectType: string): Array<{ command: string; description: string }> {
  const commonCommands = [
    { command: 'lt git', description: 'Git workflow commands' },
    { command: 'lt config', description: 'Configuration management' },
    { command: 'lt npm', description: 'NPM utilities' },
  ];

  const typeCommands: Record<string, Array<{ command: string; description: string }>> = {
    'angular': [
      { command: 'lt frontend angular', description: 'Angular tools' },
    ],
    'nest-server': [
      { command: 'lt server module', description: 'Create server module' },
      { command: 'lt server object', description: 'Create object type' },
      { command: 'lt server add-property', description: 'Add property to module' },
    ],
    'nestjs': [
      { command: 'lt server', description: 'NestJS server tools' },
    ],
    'nuxt': [
      { command: 'lt frontend nuxt', description: 'Nuxt tools' },
    ],
  };

  return [...commonCommands, ...(typeCommands[projectType] || [])];
}

export default StatusCommand;
