import { GluegunCommand } from 'gluegun';
import { join } from 'path';

import { ExtendedGluegunToolbox } from '../interfaces/extended-gluegun-toolbox';
import { detectFrameworkMode, FrameworkMode, isVendoredProject } from '../lib/framework-detection';
import {
  detectFrontendFrameworkMode,
  FrontendFrameworkMode,
  isVendoredAppProject,
} from '../lib/frontend-framework-detection';

interface MonorepoSubproject {
  frameworkMode: FrameworkMode | FrontendFrameworkMode | null;
  kind: 'backend' | 'frontend';
  path: string;
}

interface ProjectInfo {
  configFiles: string[];
  frameworkMode: FrameworkMode | null;
  frontendFrameworkMode: FrontendFrameworkMode | null;
  gitBranch: null | string;
  gitRoot: null | string;
  hasGit: boolean;
  hasLtConfig: boolean;
  hasPackageJson: boolean;
  monorepoSubprojects: MonorepoSubproject[];
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
      frameworkMode: null,
      frontendFrameworkMode: null,
      gitBranch: null,
      gitRoot: null,
      hasGit: false,
      hasLtConfig: false,
      hasPackageJson: false,
      monorepoSubprojects: [],
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
        // A project is a nest-server project if it EITHER has the npm dep
        // (classic) OR has vendored the core/ directory. The frameworkMode
        // field records which of the two modes this project runs in.
        if (deps['@lenne.tech/nest-server'] || isVendoredProject(cwd)) {
          projectInfo.projectType = 'nest-server';
          projectInfo.frameworkMode = detectFrameworkMode(cwd);
        } else if (deps['@nestjs/core']) {
          projectInfo.projectType = 'nestjs';
        } else if (deps['nuxt']) {
          projectInfo.projectType = 'nuxt';
          // Detect frontend framework mode if nuxt-extensions is present
          if (deps['@lenne.tech/nuxt-extensions'] || isVendoredAppProject(cwd)) {
            projectInfo.frontendFrameworkMode = detectFrontendFrameworkMode(cwd);
          }
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

    // Monorepo subproject detection: scan projects/api and projects/app for
    // framework modes so that `lt status` at the monorepo root surfaces
    // backend + frontend framework consumption modes even when the root
    // itself is not a Nest/Nuxt project.
    const monorepoCandidates: Array<{ kind: 'backend' | 'frontend'; path: string }> = [
      { kind: 'backend', path: join(cwd, 'projects', 'api') },
      { kind: 'backend', path: join(cwd, 'packages', 'api') },
      { kind: 'frontend', path: join(cwd, 'projects', 'app') },
      { kind: 'frontend', path: join(cwd, 'packages', 'app') },
    ];
    for (const candidate of monorepoCandidates) {
      if (!filesystem.exists(join(candidate.path, 'package.json'))) continue;
      if (candidate.kind === 'backend') {
        try {
          const subPkg = JSON.parse(filesystem.read(join(candidate.path, 'package.json')) || '{}');
          const subDeps = { ...subPkg.dependencies, ...subPkg.devDependencies };
          if (subDeps['@lenne.tech/nest-server'] || isVendoredProject(candidate.path)) {
            projectInfo.monorepoSubprojects.push({
              frameworkMode: detectFrameworkMode(candidate.path),
              kind: 'backend',
              path: candidate.path,
            });
          }
        } catch {
          // ignore
        }
      } else {
        try {
          const subPkg = JSON.parse(filesystem.read(join(candidate.path, 'package.json')) || '{}');
          const subDeps = { ...subPkg.dependencies, ...subPkg.devDependencies };
          if (subDeps['@lenne.tech/nuxt-extensions'] || isVendoredAppProject(candidate.path)) {
            projectInfo.monorepoSubprojects.push({
              frameworkMode: detectFrontendFrameworkMode(candidate.path),
              kind: 'frontend',
              path: candidate.path,
            });
          }
        } catch {
          // ignore
        }
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
      if (projectInfo.frameworkMode) {
        const modeLabel =
          projectInfo.frameworkMode === 'vendor'
            ? 'vendor (src/core/, VENDOR.md)'
            : 'npm (@lenne.tech/nest-server dependency)';
        info(`  Framework: ${modeLabel}`);
      }
      if (projectInfo.frontendFrameworkMode) {
        const frontendModeLabel =
          projectInfo.frontendFrameworkMode === 'vendor'
            ? 'vendor (app/core/, VENDOR.md)'
            : 'npm (@lenne.tech/nuxt-extensions dependency)';
        info(`  Frontend Framework: ${frontendModeLabel}`);
      }
    }

    // Show monorepo subprojects if we detected any (typically at monorepo root)
    if (projectInfo.monorepoSubprojects.length > 0) {
      info('');
      info(colors.bold('Monorepo Subprojects:'));
      for (const sub of projectInfo.monorepoSubprojects) {
        const relPath = sub.path.replace(`${cwd}/`, '');
        if (sub.kind === 'backend') {
          const label =
            sub.frameworkMode === 'vendor'
              ? 'vendor (src/core/, VENDOR.md)'
              : 'npm (@lenne.tech/nest-server dependency)';
          info(`  Backend:  ${relPath} → ${label}`);
        } else {
          const label =
            sub.frameworkMode === 'vendor'
              ? 'vendor (app/core/, VENDOR.md)'
              : 'npm (@lenne.tech/nuxt-extensions dependency)';
          info(`  Frontend: ${relPath} → ${label}`);
        }
      }
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
    commands.forEach((cmd) => info(`  ${colors.cyan(cmd.command)} - ${cmd.description}`));

    info('');

    // For tests
    return `status ${projectInfo.projectType}`;
  },
};

function formatProjectType(type: string): string {
  const typeMap: Record<string, string> = {
    angular: 'Angular',
    'nest-server': 'lenne.tech Nest Server',
    nestjs: 'NestJS',
    node: 'Node.js',
    nuxt: 'Nuxt',
    react: 'React',
    typescript: 'TypeScript',
    unknown: 'Unknown',
    vue: 'Vue',
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
    angular: [{ command: 'lt frontend angular', description: 'Angular tools' }],
    'nest-server': [
      { command: 'lt server module', description: 'Create server module' },
      { command: 'lt server object', description: 'Create object type' },
      { command: 'lt server add-property', description: 'Add property to module' },
    ],
    nestjs: [{ command: 'lt server', description: 'NestJS server tools' }],
    nuxt: [{ command: 'lt frontend nuxt', description: 'Nuxt tools' }],
  };

  return [...commonCommands, ...(typeCommands[projectType] || [])];
}

export default StatusCommand;
