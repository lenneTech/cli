import { spawnSync } from 'child_process';
import { existsSync, readFileSync } from 'fs';
import { GluegunCommand } from 'gluegun';
import { join } from 'path';

import { ExtendedGluegunToolbox } from '../../interfaces/extended-gluegun-toolbox';
import { convertProjectToEsm, EsmFinding } from '../../lib/esm-convert';
import { verifyEsmProject } from '../../lib/esm-verify';
import { failRun } from '../../lib/fail-run';
import { detectFrameworkMode, findProjectDir } from '../../lib/framework-detection';
import { findUnknownOptions, formatUnknownOptions } from '../../lib/unknown-options';

/**
 * Convert a nest-server 12 API project from CommonJS to ES modules (`"type": "module"`), the steps
 * of the nest-server migration guide 11.43.x → 12.0.x, §17. Exact rewrites are applied; what has
 * no exact rewrite (an import cycle under a decorator, a named import Node cannot see in a
 * CommonJS package, a leftover `require`) is reported with file and line, and the command exits
 * with 1 until it is fixed. It ends by building the project and starting the built server and the
 * dev server, because both traps pass the test suite.
 */
export const help = {
  description: 'Convert API project to ES modules',
  name: 'convert-esm',
  options: [
    {
      default: false,
      description: 'Show what would change without writing anything',
      flag: '--dry-run',
      required: false,
      type: 'boolean',
    },
    {
      default: false,
      description: 'Convert although the git working tree has uncommitted changes',
      flag: '--force',
      required: false,
      type: 'boolean',
    },
    {
      default: false,
      description: 'Skip the confirmation prompt',
      flag: '--noConfirm',
      required: false,
      type: 'boolean',
    },
    {
      default: false,
      description: 'Skip the closing build, server start, migrate:list and dev start',
      flag: '--skip-verify',
      required: false,
      type: 'boolean',
    },
  ],
};

const isSet = (value: unknown) => value === true || value === 'true';

const ConvertEsmCommand: GluegunCommand = {
  description: 'Convert API project to ESM',
  hidden: false,
  name: 'convert-esm',
  run: async (toolbox: ExtendedGluegunToolbox) => {
    const {
      filesystem,
      parameters,
      print: { error, info, spin, success, warning },
      prompt: { confirm },
    } = toolbox;

    if (toolbox.tools.helpJson(help)) return;

    const declaredFlags = help.options.map((option) => option.flag);
    const unknownFlags = findUnknownOptions(parameters.options, declaredFlags);
    if (unknownFlags.length > 0) {
      error(formatUnknownOptions(unknownFlags, declaredFlags));
      failRun(toolbox);
      return 'convert-esm: unknown option';
    }

    // The API project: the current one, or projects/api from a workspace root.
    let apiDir = findProjectDir(filesystem.cwd());
    if (
      apiDir &&
      !existsSync(join(apiDir, 'src', 'main.ts')) &&
      existsSync(join(apiDir, 'projects', 'api', 'package.json'))
    ) {
      apiDir = join(apiDir, 'projects', 'api');
    }
    if (!apiDir || !existsSync(join(apiDir, 'src', 'main.ts'))) {
      error('No API project here: run it in the API project (src/main.ts) or in a workspace with projects/api.');
      failRun(toolbox);
      return 'convert-esm: no api project';
    }

    // Every step is idempotent, so a project that is already ESM is checked again rather than
    // skipped: the usual second run comes after fixing the findings of the first.
    const pkg = JSON.parse(readFileSync(join(apiDir, 'package.json'), 'utf8'));
    const alreadyEsm = pkg.type === 'module';
    if (alreadyEsm) info('Already an ES module project: re-applying the exact rewrites and checking it again.');

    const mode = detectFrameworkMode(apiDir);
    const frameworkProblem = esmReadyFramework(apiDir, mode);
    if (frameworkProblem) {
      error(frameworkProblem);
      failRun(toolbox);
      return 'convert-esm: framework too old';
    }

    const dryRun = isSet(parameters.options['dry-run']) || isSet(parameters.options.dryRun);
    // The first conversion must be one reviewable, revertable diff. A re-run on an ESM project
    // naturally sits on top of that uncommitted diff and the hand fixes.
    if (!dryRun && !alreadyEsm && !isSet(parameters.options.force)) {
      const dirty = uncommittedChanges(apiDir);
      if (dirty) {
        error('The git working tree has uncommitted changes. Commit or stash them first, so the conversion is one');
        error('reviewable diff you can also revert, or pass --force.');
        info(dirty);
        failRun(toolbox);
        return 'convert-esm: dirty working tree';
      }
    }

    info(`API project: ${apiDir} (framework: ${mode} mode)`);
    if (dryRun) {
      const plan = convertProjectToEsm({ apiDir, checkNamedImports: false, dryRun: true, mode });
      info('');
      info(`Would change (${plan.changes.length}):`);
      for (const change of plan.changes) info(`  ${change}`);
      printFindings(plan.findings, warning, info);
      info('');
      info('After the edits the command also moves types in decorated signatures to `import type`, checks');
      info('import cycles and named imports of CommonJS packages, builds the project and starts it.');
      return `convert-esm dry-run (${plan.changes.length} changes, ${plan.findings.length} findings)`;
    }

    if (!isSet(parameters.options.noConfirm)) {
      const proceed = await confirm(
        `Convert ${apiDir} to ES modules?\n  This rewrites package.json, tsconfig, nodemon, imports across src/tests/migrations and migrations-utils.`,
      );
      if (!proceed) {
        info('Aborted.');
        return 'convert-esm: aborted';
      }
    }

    const spinner = spin('Converting to ES modules (rewrites, TS1272, cycle and named-import checks)…');
    let result: ReturnType<typeof convertProjectToEsm>;
    try {
      result = convertProjectToEsm({ apiDir, checkNamedImports: true, dryRun: false, mode });
      spinner.succeed(`Converted: ${result.changes.length} change(s).`);
    } catch (err) {
      spinner.fail(`Conversion failed: ${(err as Error).message}`);
      failRun(toolbox);
      return 'convert-esm: failed';
    }
    for (const change of result.changes) info(`  ${change}`);
    printFindings(result.findings, warning, info);

    let failedSteps = 0;
    const verify = !isSet(parameters.options['skip-verify']) && !isSet(parameters.options.skipVerify);
    if (verify && process.platform === 'win32') {
      // esm-verify spawns pnpm without its .cmd shim and the dev command through /bin/sh, so
      // every step would fail on Windows for reasons unrelated to the project.
      info('');
      warning('Verification runs on macOS and Linux only: build, start the built server, migrate:list');
      warning('and start the dev server by hand, or run the command there.');
    } else if (verify) {
      info('');
      info('Verifying: the test suite does not show the ESM start-up errors, so the project is run.');
      const verifySpinner = spin('build');
      const steps = await verifyEsmProject(apiDir, (name) => (verifySpinner.text = name));
      verifySpinner.stop();
      for (const step of steps) {
        if (step.ok) success(`  ✔ ${step.name}`);
        else {
          failedSteps++;
          error(`  ✖ ${step.name}`);
          if (step.detail) for (const line of step.detail.split('\n')) info(`      ${line}`);
        }
      }
    }

    info('');
    if (result.findings.length > 0 || failedSteps > 0) {
      warning('Not done yet: fix the findings above, then run `pnpm run check` and start the project once more.');
      failRun(toolbox);
    } else {
      success('ES module conversion complete. Review the diff, then run `pnpm run check`.');
    }
    if (!parameters.options.fromGluegunMenu) process.exit();
    return `convert-esm: ${result.changes.length} changes, ${result.findings.length} findings, ${failedSteps} failed checks`;
  },
};

/**
 * `undefined` when the project's framework is ESM-ready (nest-server 12+), else why not. A
 * vendored 12 core carries `modules/migrate/helpers/package.json`, which keeps its loader
 * CommonJS inside an ESM project; an older core would lose its loader with the switch.
 */
function esmReadyFramework(apiDir: string, mode: 'npm' | 'vendor'): string | undefined {
  if (mode === 'vendor') {
    return existsSync(join(apiDir, 'src', 'core', 'modules', 'migrate', 'helpers', 'package.json'))
      ? undefined
      : 'The vendored core predates nest-server 12. Update it first (migration guide 11.43.x → 12.0.x), then convert.';
  }
  const installed = join(apiDir, 'node_modules', '@lenne.tech', 'nest-server', 'package.json');
  const hoisted = join(apiDir, '..', '..', 'node_modules', '@lenne.tech', 'nest-server', 'package.json');
  const manifest = [installed, hoisted].find((file) => existsSync(file));
  if (!manifest) return 'Install the dependencies first: @lenne.tech/nest-server is not in node_modules.';
  const major = Number(String(JSON.parse(readFileSync(manifest, 'utf8')).version).split('.')[0]);
  return major >= 12
    ? undefined
    : `@lenne.tech/nest-server ${major}.x is installed; ES modules need 12 or newer (migration guide 11.43.x → 12.0.x first).`;
}

function printFindings(findings: EsmFinding[], warning: (m: string) => void, info: (m: string) => void): void {
  if (findings.length === 0) return;
  info('');
  warning(`To fix by hand (${findings.length}):`);
  for (const finding of findings) {
    info(`  ${finding.file}${finding.line ? `:${finding.line}` : ''}  ${finding.message}`);
  }
}

/** `git status --porcelain` of the project, or `undefined` when clean or not a git repository. */
function uncommittedChanges(apiDir: string): string | undefined {
  const status = spawnSync('git', ['status', '--porcelain', '--', '.'], { cwd: apiDir, encoding: 'utf8' });
  if (status.status !== 0) return undefined;
  const lines = status.stdout.split('\n').filter(Boolean);
  return lines.length > 0 ? lines.slice(0, 10).join('\n') : undefined;
}

module.exports = Object.assign(ConvertEsmCommand, { help });
