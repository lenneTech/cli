import { GluegunCommand } from 'gluegun';
import { dirname } from 'path';

import { ExtendedGluegunToolbox } from '../../interfaces/extended-gluegun-toolbox';
import { execArgs, safeRef } from '../../lib/exec-args';

/**
 * Run git steps one after another, each without a shell; stops at the first failure like the
 * former `a && b && c` chain did.
 */
async function gitSteps(...steps: string[][]): Promise<void> {
  for (const args of steps) {
    await execArgs('git', args);
  }
}

/**
 * Checkout git branch
 */
const NewCommand: GluegunCommand = {
  alias: ['g'],
  description: 'Checkout branch',
  hidden: false,
  name: 'get',
  run: async (toolbox: ExtendedGluegunToolbox) => {
    // Retrieve the tools we need
    const {
      config,
      filesystem,
      git,
      helper,
      npm,
      parameters,
      print: { error, info, spin, success },
      prompt,
      system,
    } = toolbox;

    // Load configuration
    const ltConfig = config.loadConfig();
    const configMode = ltConfig?.commands?.git?.get?.mode;

    // Parse CLI arguments
    const cliMode = parameters.options.mode;

    // Determine noConfirm with priority: CLI > config > global > default (false)
    const noConfirm = config.getNoConfirm({
      cliValue: parameters.options.noConfirm,
      commandConfig: ltConfig?.commands?.git?.get,
      config: ltConfig,
      parentConfig: ltConfig?.commands?.git,
    });

    // Start timer
    const timer = system.startTimer();

    // Check git
    if (!(await git.gitInstalled())) {
      return;
    }

    // Get (part of) branch name
    const branchName = await helper.getInput(parameters.first, {
      name: 'branch name',
      showError: true,
    });
    if (!branchName) {
      return;
    }

    // Check changes in current branch (reset necessary)
    if (!(await git.askForReset({ showError: true }))) {
      return;
    }

    // Search for branch, which includes branch name
    const branch = await git.getBranch(branchName, {
      error: true,
      exact: false,
      remote: false,
      spin: true,
    });

    if (!branch) {
      return;
    }

    // Get remote branch
    const remoteBranch = await git.getBranch(branch, { remote: true });

    // Ask for checkout branch
    if (branchName !== branch) {
      if (!noConfirm && !(await prompt.confirm(`Checkout ${remoteBranch ? 'remote' : 'local'} branch ${branch}`))) {
        return;
      }
    } else {
      success(`Branch ${branchName} found`);
    }

    // Checkout branch
    // Argument lists, no shell: branch names come from the user and from the remote (see exec-args.ts).
    await execArgs('git', ['checkout', safeRef((await git.getDefaultBranch()) || 'main')]);
    let checkoutSpin;

    // Handling for remote
    if (remoteBranch) {
      // Delete local
      let removed = false;
      const checkSpin = spin('Check status');
      if (branch !== 'main' && branch && (await git.diffFiles(branch, { noDiffResult: '' })).length) {
        checkSpin.succeed();
        // Determine mode with priority: CLI > config > interactive
        let mode = cliMode || configMode;
        if (!cliMode && configMode) {
          info(`Using mode from lt.config commands.git.get: ${configMode}`);
        }
        if (!mode && !noConfirm) {
          if (await prompt.confirm(`Remove local commits of ${branch}`)) {
            mode = 'hard';
          }
        } else if (!mode && noConfirm) {
          // In noConfirm mode without explicit mode, default to not removing
          mode = undefined;
        }
        if (mode === 'hard') {
          const prepareSpin = spin(`Refresh ${branch}`);
          await execArgs('git', ['branch', '-D', safeRef(branch)]);
          removed = true;
          prepareSpin.succeed();
        }
      } else {
        checkSpin.succeed();
      }

      // Start spin
      checkoutSpin = spin(`Checkout ${branch}`);

      // Checkout remote if local branch not exists
      if (removed || !(await git.getBranch(branch, { local: true }))) {
        await gitSteps(
          ['fetch'],
          ['checkout', '--track', `origin/${safeRef(branch)}`],
          ['reset', '--hard'],
          ['clean', '-fd'],
          ['pull'],
        );

        // Checkout local branch
      } else {
        await gitSteps(['fetch'], ['checkout', safeRef(branch)], ['reset', '--hard'], ['clean', '-fd'], ['pull']);
      }

      // Handling for local only
    } else if (branch) {
      checkoutSpin = spin(`Checkout ${branch}`);
      await gitSteps(['fetch'], ['checkout', safeRef(branch)], ['reset', '--hard'], ['clean', '-fd']);

      // No branch found
    } else {
      error(`Branch ${branch} not found!`);
      return;
    }

    // Checkout done
    checkoutSpin.succeed();

    // Install packages with correctly detected package manager (supports monorepo lockfiles)
    const { path: pkgPath } = await npm.getPackageJson();
    if (pkgPath) {
      const projectDir = dirname(pkgPath);
      const detectedPm = toolbox.pm.detect(projectDir);
      const installSpin = spin(`Install packages using ${detectedPm}`);
      await system.run(toolbox.pm.install(detectedPm), { cwd: projectDir });
      installSpin.succeed();
    }

    // Init lerna projects
    if (filesystem.isFile('./lerna.json')) {
      const initProjectsSpin = spin('Init projects');
      await system.run(`${toolbox.pm.run('init')} --if-present`);
      initProjectsSpin.succeed();
    }

    // Success info
    success(
      `${remoteBranch ? 'Remote' : 'Local'} branch ${branch} checked out in ${helper.msToMinutesAndSeconds(timer())}m.`,
    );
    info('');
    if (!toolbox.parameters.options.fromGluegunMenu) {
      process.exit();
    }

    // For tests
    return `checked out branch ${branch}`;
  },
};

export default NewCommand;
