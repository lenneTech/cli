import { GluegunCommand } from 'gluegun';
import { dirname } from 'path';
import { ExtendedGluegunToolbox } from '../../interfaces/extended-gluegun-toolbox';

/**
 * Reinitialize npm packages
 */
const NewCommand: GluegunCommand = {
  name: 'reinit',
  alias: ['r'],
  description: 'Reinitialize npm packages',
  hidden: false,
  run: async (toolbox: ExtendedGluegunToolbox) => {
    // Retrieve the tools we need
    const {
      helper,
      npm,
      parameters,
      print: { spin, success },
      prompt,
      system
    } = toolbox;

    // Start timer
    const timer = system.startTimer();

    // Check
    const { path, data } = await npm.getPackageJson({ showError: true });
    if (!path) {
      return;
    }

    // Update packages
    let update = parameters.options.update || parameters.options.u;
    if (!update && !parameters.options.noConfirm) {
      update = await prompt.confirm('Update package.json before reinitialization?');
    }
    if (update) {
      if (!system.which('ncu')) {
        const installSpin = spin('Install ncu');
        await system.run('npm i -g npm-check-updates');
        installSpin.succeed();
      }
      const updateSpin = spin('Update package.json');
      await system.run('ncu -u --packageFile ' + path);
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
        `cd ${dirname(path)} && rimraf package-lock.json && rimraf node_modules && npm cache clean --force && npm i`
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

    // For tests
    return `npm reinit`;
  }
};

export default NewCommand;
