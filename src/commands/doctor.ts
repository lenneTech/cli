import { GluegunCommand } from 'gluegun';
import { get } from 'https';
import { join } from 'path';

import { ExtendedGluegunToolbox } from '../interfaces/extended-gluegun-toolbox';
import { spawnArgs } from '../lib/exec-args';
import { checkGitIdentity, gitInstallHint, pnpmInstallHint } from '../lib/toolchain-preflight';

interface CheckResult {
  details?: string;
  /** One command per entry; several are printed one per line (PowerShell 5.1 has no `&&`). */
  fix?: string | string[];
  name: string;
  status: 'error' | 'ok' | 'warning';
}

interface NodeRelease {
  lts: false | string;
  version: string;
}

/**
 * Fetch current LTS version from Node.js API
 */
async function fetchCurrentLtsVersion(): Promise<null | { codename: string; major: number }> {
  return new Promise((resolve) => {
    const timeout = setTimeout(() => resolve(null), 5000);

    get('https://nodejs.org/dist/index.json', (res) => {
      let data = '';
      res.on('data', (chunk) => (data += chunk));
      res.on('end', () => {
        clearTimeout(timeout);
        try {
          const releases: NodeRelease[] = JSON.parse(data);
          // Find the first (latest) release with an LTS codename
          const ltsRelease = releases.find((r) => r.lts !== false);
          if (ltsRelease) {
            const major = parseInt(ltsRelease.version.replace('v', '').split('.')[0], 10);
            resolve({ codename: ltsRelease.lts as string, major });
          } else {
            resolve(null);
          }
        } catch {
          resolve(null);
        }
      });
      res.on('error', () => {
        clearTimeout(timeout);
        resolve(null);
      });
    }).on('error', () => {
      clearTimeout(timeout);
      resolve(null);
    });
  });
}

/**
 * Diagnose common issues
 */
const DoctorCommand: GluegunCommand = {
  alias: ['dr'],
  description: 'Diagnose common issues',
  hidden: false,
  name: 'doctor',
  run: async (toolbox: ExtendedGluegunToolbox) => {
    const {
      filesystem,
      parameters,
      print: { colors, info, spin, success },
      system,
    } = toolbox;

    const fix = parameters.options.fix || parameters.options.f;
    const offline = parameters.options.offline || parameters.options.o;
    const checks: CheckResult[] = [];

    info('');
    info(colors.bold('lt doctor'));
    info(colors.dim('Checking your development environment...'));
    info('');

    // Check Node.js version
    const nodeSpinner = spin('Checking Node.js...');
    try {
      const nodeVersion = await system.run('node --version');
      const version = nodeVersion?.trim().replace('v', '');
      const major = parseInt(version?.split('.')[0] || '0', 10);

      // Fetch current LTS version (fallback to 22 if API fails or offline)
      const ltsInfo = offline ? null : await fetchCurrentLtsVersion();
      const ltsVersion = ltsInfo?.major || 22;
      const ltsCodename = ltsInfo?.codename || 'LTS';
      const minSupported = ltsVersion - 4; // Previous LTS (e.g., 22 -> 18)

      if (major >= ltsVersion) {
        nodeSpinner.succeed(`Node.js ${nodeVersion?.trim()} (${ltsCodename} LTS)`);
        checks.push({ name: 'Node.js', status: 'ok' });
      } else if (major >= minSupported) {
        nodeSpinner.warn(`Node.js ${nodeVersion?.trim()} (v${ltsVersion}+ ${ltsCodename} LTS recommended)`);
        checks.push({
          details: `Current: ${nodeVersion?.trim()}, Latest LTS: v${ltsVersion} (${ltsCodename})`,
          fix: `Upgrade to Node.js ${ltsVersion} LTS or newer`,
          name: 'Node.js',
          status: 'warning',
        });
      } else {
        nodeSpinner.fail(`Node.js ${nodeVersion?.trim()} (v${minSupported}+ required)`);
        checks.push({
          details: `Current: ${nodeVersion?.trim()}, Latest LTS: v${ltsVersion} (${ltsCodename})`,
          fix: `Upgrade to Node.js ${ltsVersion} LTS or newer`,
          name: 'Node.js',
          status: 'error',
        });
      }
    } catch {
      nodeSpinner.fail('Node.js not found');
      checks.push({
        fix: 'Install Node.js from https://nodejs.org',
        name: 'Node.js',
        status: 'error',
      });
    }

    // Check package manager. pnpm is always checked: lt fullstack init and lt dev run on pnpm,
    // whatever manager the current directory uses (npm is needed anyway, it installed lt).
    const detectedPm = toolbox.pm.detect();
    const managers = detectedPm === 'pnpm' ? ['pnpm'] : [detectedPm, 'pnpm'];
    for (const manager of managers) {
      const pmSpinner = spin(`Checking package manager (${manager})...`);
      try {
        // Argument list, no shell: npm and pnpm are .cmd shims on Windows (see exec-args.ts).
        const pmVersion = await spawnArgs(manager, ['--version']);
        pmSpinner.succeed(`${manager} ${pmVersion.trim()}`);
        checks.push({ name: `Package Manager (${manager})`, status: 'ok' });
      } catch {
        pmSpinner.fail(`${manager} not found`);
        checks.push({
          details: manager === 'pnpm' ? 'lt fullstack init and lt dev need pnpm' : undefined,
          fix: manager === 'pnpm' ? pnpmInstallHint() : `Install ${manager}`,
          name: `Package Manager (${manager})`,
          status: 'error',
        });
      }
    }

    // Check git
    const gitSpinner = spin('Checking Git...');
    try {
      const gitVersion = await system.run('git --version');
      gitSpinner.succeed(gitVersion?.trim());
      checks.push({ name: 'Git', status: 'ok' });

      // Same question the commit asks, resolved for the current directory (see checkGitIdentity).
      const identitySpinner = spin('Checking Git identity...');
      const identityIssue = await checkGitIdentity(filesystem.cwd());
      if (identityIssue) {
        identitySpinner.fail('Git identity not set');
        checks.push({
          details: identityIssue.message,
          fix: identityIssue.fix,
          name: 'Git identity',
          status: 'error',
        });
      } else {
        identitySpinner.succeed('Git identity set');
        checks.push({ name: 'Git identity', status: 'ok' });
      }
    } catch {
      gitSpinner.fail('Git not found');
      checks.push({
        fix: gitInstallHint(),
        name: 'Git',
        status: 'error',
      });
    }

    // Check lt CLI version
    const ltSpinner = spin('Checking lt CLI...');
    try {
      const packageJsonPath = join(__dirname, '..', '..', 'package.json');
      const packageJson = JSON.parse(filesystem.read(packageJsonPath) || '{}');
      const currentVersion = packageJson.version;

      // Check for updates (skip in offline mode)
      if (offline) {
        ltSpinner.succeed(`lt CLI v${currentVersion}`);
        checks.push({ name: 'lt CLI', status: 'ok' });
      } else {
        try {
          // No shell: `2>/dev/null` is a path on Windows, and cmd.exe refused to run the command.
          const latestVersion = await spawnArgs('npm', ['view', '@lenne.tech/cli', 'version']);
          if (latestVersion?.trim() && latestVersion.trim() !== currentVersion) {
            ltSpinner.warn(`lt CLI v${currentVersion} (v${latestVersion.trim()} available)`);
            checks.push({
              details: `Current: v${currentVersion}, Latest: v${latestVersion.trim()}`,
              fix: 'Run: lt update',
              name: 'lt CLI',
              status: 'warning',
            });
          } else {
            ltSpinner.succeed(`lt CLI v${currentVersion}`);
            checks.push({ name: 'lt CLI', status: 'ok' });
          }
        } catch {
          ltSpinner.succeed(`lt CLI v${currentVersion}`);
          checks.push({ name: 'lt CLI', status: 'ok' });
        }
      }
    } catch {
      ltSpinner.warn('Could not determine lt CLI version');
      checks.push({ name: 'lt CLI', status: 'warning' });
    }

    // Check for lt.config in current directory
    const configSpinner = spin('Checking project configuration...');
    const cwd = filesystem.cwd();
    const configFiles = ['lt.config.json', 'lt.config.yaml', 'lt.config'];
    let hasConfig = false;

    for (const configFile of configFiles) {
      if (filesystem.exists(join(cwd, configFile))) {
        hasConfig = true;
        configSpinner.succeed(`Found ${configFile}`);
        checks.push({ name: 'lt.config', status: 'ok' });
        break;
      }
    }

    if (!hasConfig) {
      configSpinner.info('No lt.config found (optional)');
      checks.push({
        details: 'Configuration file is optional but recommended',
        fix: 'Run: lt config init',
        name: 'lt.config',
        status: 'warning',
      });
    }

    // Check for package.json
    const pkgSpinner = spin('Checking package.json...');
    if (filesystem.exists(join(cwd, 'package.json'))) {
      pkgSpinner.succeed('Found package.json');
      checks.push({ name: 'package.json', status: 'ok' });

      // Check node_modules
      const nmSpinner = spin('Checking dependencies...');
      if (filesystem.exists(join(cwd, 'node_modules'))) {
        nmSpinner.succeed('Dependencies installed');
        checks.push({ name: 'Dependencies', status: 'ok' });
      } else {
        nmSpinner.warn('Dependencies not installed');
        checks.push({
          fix: `Run: ${toolbox.pm.install()}`,
          name: 'Dependencies',
          status: 'warning',
        });

        if (fix) {
          info('');
          const installSpinner = spin('Installing dependencies...');
          try {
            await system.run(toolbox.pm.install());
            installSpinner.succeed('Dependencies installed');
          } catch {
            installSpinner.fail('Failed to install dependencies');
          }
        }
      }
    } else {
      pkgSpinner.info('No package.json (not a Node.js project)');
    }

    // Summary
    info('');
    info(colors.dim('─'.repeat(50)));

    const errors = checks.filter((c) => c.status === 'error');
    const warnings = checks.filter((c) => c.status === 'warning');
    const ok = checks.filter((c) => c.status === 'ok');

    if (errors.length === 0 && warnings.length === 0) {
      success('All checks passed!');
    } else {
      info(`Checks: ${ok.length} passed, ${warnings.length} warnings, ${errors.length} errors`);
    }

    // Show issues and fixes
    if (errors.length > 0 || warnings.length > 0) {
      info('');
      info(colors.bold('Issues:'));

      for (const check of [...errors, ...warnings]) {
        const icon = check.status === 'error' ? colors.red('✖') : colors.yellow('⚠');
        info(`  ${icon} ${check.name}`);
        if (check.details) {
          info(colors.dim(`    ${check.details}`));
        }
        const fixLines = check.fix === undefined ? [] : ([] as string[]).concat(check.fix);
        fixLines.forEach((line, index) => {
          info(colors.cyan(`    ${index === 0 ? 'Fix:' : '    '} ${line}`));
        });
      }
    }

    if (!fix && warnings.length > 0) {
      info('');
      info(colors.dim('Run "lt doctor --fix" to attempt automatic fixes'));
    }

    info('');

    // For tests
    return `doctor ${errors.length === 0 ? 'ok' : 'issues'}`;
  },
};

export default DoctorCommand;
