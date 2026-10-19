import { GluegunCommand } from 'gluegun';

import { ExtendedGluegunToolbox } from '../../interfaces/extended-gluegun-toolbox';
import { hasCmdShimHazard, spawnArgs } from '../../lib/exec-args';

/**
 * Generate TypeScript types from Directus collections
 */
const NewCommand: GluegunCommand = {
  alias: ['t'],
  description: 'Generate TypeScript types',
  hidden: false,
  name: 'typegen',
  run: async (toolbox: ExtendedGluegunToolbox) => {
    // Retrieve the tools we need
    const {
      config,
      parameters,
      print: { error, info, spin, success },
      prompt,
      system,
    } = toolbox;

    // Load configuration
    const ltConfig = config.loadConfig();

    // Parse CLI arguments
    const cliUrl = parameters.options.url || parameters.options.u;
    const cliToken = parameters.options.token || parameters.options.t;
    const cliOutput = parameters.options.output || parameters.options.o;

    // Determine noConfirm with priority: CLI > command > global > default
    const noConfirm = config.getNoConfirm({
      cliValue: parameters.options.noConfirm,
      commandConfig: ltConfig?.commands?.directus?.typegen,
      config: ltConfig,
    });

    // Get configuration values
    const configUrl = ltConfig?.commands?.directus?.typegen?.url;
    const configToken = ltConfig?.commands?.directus?.typegen?.token;
    const configOutput = ltConfig?.commands?.directus?.typegen?.output;

    // Determine values with priority: CLI > config > default/interactive
    let url: string;
    let token: string;
    let output: string;

    if (cliUrl) {
      url = cliUrl;
    } else if (configUrl) {
      url = configUrl;
      info(`Using Directus URL from lt.config: ${url}`);
    } else if (noConfirm) {
      url = 'http://localhost:8055';
      info(`Using default Directus URL: ${url}`);
    } else {
      const urlResponse = await prompt.ask<{ url: string }>({
        initial: 'http://localhost:8055',
        message: 'Enter Directus API URL:',
        name: 'url',
        type: 'input',
      });
      url = urlResponse.url;
    }

    if (!url) {
      error('Directus URL is required!');
      return;
    }

    if (cliToken) {
      token = cliToken;
    } else if (configToken) {
      token = configToken;
      info('Using Directus token from lt.config');
    } else if (noConfirm) {
      error('Directus token is required (use --token or configure in lt.config)!');
      return;
    } else {
      const tokenResponse = await prompt.ask<{ token: string }>({
        message: 'Enter Directus API token (needs Administrator permissions):',
        name: 'token',
        type: 'password',
      });
      token = tokenResponse.token;
    }

    if (!token) {
      error('Directus token is required!');
      return;
    }

    if (cliOutput) {
      output = cliOutput;
    } else if (configOutput) {
      output = configOutput;
      info(`Using output path from lt.config: ${output}`);
    } else if (noConfirm) {
      output = './directus-schema.ts';
      info(`Using default output path: ${output}`);
    } else {
      const outputResponse = await prompt.ask<{ output: string }>({
        initial: './directus-schema.ts',
        message: 'Enter output file path:',
        name: 'output',
        type: 'input',
      });
      output = outputResponse.output;
    }

    if (!output) {
      error('Output path is required!');
      return;
    }

    // Check if directus-sdk-typegen is installed globally
    const hasTypegen = system.which('directus-sdk-typegen');
    let useGlobalTypegen = Boolean(hasTypegen);

    if (!hasTypegen) {
      info('directus-sdk-typegen is not installed globally.');
      if (noConfirm) {
        info('Installing directus-sdk-typegen globally...');
      } else {
        const shouldInstall = await prompt.confirm('Would you like to install directus-sdk-typegen globally?');
        if (!shouldInstall) {
          info('Using npx/dlx instead...');
          useGlobalTypegen = false;
        } else {
          const installSpin = spin('Installing directus-sdk-typegen');
          await system.run(toolbox.pm.globalInstall('directus-sdk-typegen'));
          installSpin.succeed();
          useGlobalTypegen = true;
        }
      }
    }

    // url, token and output come from flags or lt.config, which a cloned repository can supply,
    // and they used to sit in double quotes in a shell string, where `$(…)` ran. They are now an
    // argument list (see exec-args.ts). On Windows the runner is a `.cmd` shim that re-parses its
    // arguments through cmd.exe, so values that could break out there are refused first.
    let directusUrl: string;
    try {
      const parsed = new URL(url);
      if (parsed.protocol !== 'http:' && parsed.protocol !== 'https:') {
        throw new Error(parsed.protocol);
      }
      // The value as given: `href` would append a "/" and change the URL the generator sees.
      directusUrl = url;
    } catch {
      error(`Invalid Directus URL "${url}": expected http:// or https://.`);
      return;
    }
    if (!/^[\w.~+/=-]+$/.test(token)) {
      error('Invalid Directus token: only letters, digits and . _ ~ + / = - are allowed.');
      return;
    }
    if ([directusUrl, output].some((value) => hasCmdShimHazard(value))) {
      error('URL and output path must not contain ", % or line breaks on Windows.');
      return;
    }
    const [runner, ...runnerArgs] = useGlobalTypegen
      ? ['directus-sdk-typegen']
      : toolbox.pm.exec('directus-sdk-typegen').split(' ');

    // Generate types
    const generateSpin = spin('Generating TypeScript types from Directus');
    try {
      // Asynchronous: a synchronous spawn under the spinner would block Ctrl+C until it exits.
      await spawnArgs(runner, [...runnerArgs, '-u', directusUrl, '-t', token, '-o', output]);
      generateSpin.succeed();
      success(`TypeScript types generated successfully at ${output}`);
    } catch (err) {
      generateSpin.fail();
      error('Failed to generate types. Please check your URL and token.');
      if (err instanceof Error) {
        error(err.message);
      }
      return;
    }

    // Exit if not running from menu
    if (!toolbox.parameters.options.fromGluegunMenu) {
      process.exit();
    }

    // For tests
    return `generated directus types at ${output}`;
  },
};

export default NewCommand;
