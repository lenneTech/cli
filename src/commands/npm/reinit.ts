import { GluegunCommand } from 'gluegun';
import { dirname } from 'path';

import { ExtendedGluegunToolbox } from '../../interfaces/extended-gluegun-toolbox';

/**
 * Reinitialize npm packages
 */
const NewCommand: GluegunCommand = {
  alias: ['r'],
  description: 'Reinstall npm packages',
  hidden: false,
  name: 'reinit',
  run: async (toolbox: ExtendedGluegunToolbox) => {
    // Retrieve the tools we need
    const {
      config,
      helper,
      npm,
      parameters,
      print: { info, spin, success },
      prompt,
      system,
    } = toolbox;

    // Start timer
    const timer = system.startTimer();

    // Load configuration
    const ltConfig = config.loadConfig();
    const configUpdate = ltConfig?.commands?.npm?.reinit?.update;

    // Parse CLI arguments
    const cliUpdate = parameters.options.update || parameters.options.u;

    // Determine noConfirm with priority: CLI > command > global > default
    const noConfirm = config.getNoConfirm({
      cliValue: parameters.options.noConfirm,
      commandConfig: ltConfig?.commands?.npm?.reinit,
      config: ltConfig,
    });

    // Check
    const { data, path } = await npm.getPackageJson({ showError: true });
    if (!path) {
      return;
    }

    // Determine update with priority: CLI > config > interactive
    let update: boolean;

    if (cliUpdate !== undefined) {
      // CLI parameter provided
      update = cliUpdate === true || cliUpdate === 'true';
    } else if (configUpdate !== undefined) {
      // Config value provided
      update = configUpdate;
      if (update) {
        info('Using update setting from lt.config: true');
      }
    } else if (noConfirm) {
      // noConfirm mode without explicit update setting
      update = false;
    } else {
      // Interactive mode
      update = await prompt.confirm('Update package.json before reinitialization?');
    }

    if (update) {
      if (!system.which('ncu')) {
        const installSpin = spin('Install ncu');
        await system.run('npm i -g npm-check-updates');
        installSpin.succeed();
      }
      const updateSpin = spin('Update package.json');
      await system.run(`ncu -u --packageFile ${path}`);
      updateSpin.succeed();
    }

    // Reinitialize
    if (data.scripts && data.scripts.reinit) {
      const ownReinitSpin = spin('Reinitialize npm packages');
      await system.run(`cd ${dirname(path)} && npm run reinit`);
      ownReinitSpin.succeed();
    } else {
      const reinitSpin = spin('Reinitialize npm packages');
      if (system.which('rimraf')) {
        await system.run('npm i -g rimraf');
      }
      await system.run(
        `cd ${dirname(path)} && rimraf package-lock.json && rimraf node_modules && npm cache clean --force && npm i`,
      );
      reinitSpin.succeed();
      if (data.scripts && data.scripts['test:e2e']) {
        const testE2eSpin = spin('Run tests');
        await system.run(`cd ${dirname(path)} && npm run test:e2e`);
        testE2eSpin.succeed();
      } else if (data.scripts && data.scripts && data.scripts.test) {
        const testSpin = spin('Run tests');
        await system.run(`cd ${dirname(path)} && npm run test`);
        testSpin.succeed();
      }
    }

    // Success info
    success(`Reinitialized npm packages in ${helper.msToMinutesAndSeconds(timer())}m.`);

    // Exit if not running from menu
    if (!toolbox.parameters.options.fromGluegunMenu) {
      process.exit();
    }

    // For tests
    return 'npm reinit';
  },
};

export default NewCommand;
