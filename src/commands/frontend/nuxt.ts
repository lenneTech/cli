import { GluegunCommand } from 'gluegun';

import { ExtendedGluegunToolbox } from '../../interfaces/extended-gluegun-toolbox';

/**
 * Create a new nuxt workspace
 */
const NewCommand: GluegunCommand = {
  alias: ['n'],
  description: 'Creates a new nuxt workspace',
  hidden: false,
  name: 'nuxt',
  run: async (toolbox: ExtendedGluegunToolbox) => {
    // Retrieve the tools we need
    const {
      config,
      frontendHelper,
      helper,
      parameters,
      print: { spin },
      prompt: { ask },
      strings: { kebabCase },
      system,
    } = toolbox;

    // Load configuration
    const ltConfig = config.loadConfig();
    const configBranch = ltConfig?.commands?.frontend?.nuxt?.branch;
    const configCopy = ltConfig?.commands?.frontend?.nuxt?.copy;
    const configLink = ltConfig?.commands?.frontend?.nuxt?.link;

    // Parse CLI arguments
    const cliBranch = parameters.options.branch || parameters.options.b;
    const cliCopy = parameters.options.copy || parameters.options.c;
    const cliLink = parameters.options.link;

    // Determine branch and copy/link paths with priority: CLI > config
    const branch = cliBranch || configBranch;
    const copyPath = cliCopy || configCopy;
    const linkPath = cliLink || configLink;

    const projName = (
      await ask({
        message: 'What is the project\'s name?',
        name: 'projectName',
        required: true,
        type: 'input',
      })
    ).projectName;

    const projectDir = kebabCase(projName);

    // Start timer
    const timer = system.startTimer();

    const baseSpinner = spin(`Creating nuxt-base with name '${projectDir}'${linkPath ? ' (link)' : copyPath ? ' (copy)' : branch ? ` (branch: ${branch})` : ''}`);

    // Use FrontendHelper for setup
    const result = await frontendHelper.setupNuxt(`./${projectDir}`, {
      branch,
      copyPath,
      linkPath,
      skipInstall: true, // Nuxt standalone doesn't need npm install (create-nuxt-base handles it)
    });

    if (!result.success) {
      baseSpinner.fail(`Failed to setup nuxt workspace: ${result.path}`);
      return;
    }

    baseSpinner.succeed(`Successfully created nuxt workspace with name '${projectDir}' in ${helper.msToMinutesAndSeconds(
      timer(),
    )}m.`);

    if (!toolbox.parameters.options.fromGluegunMenu) {
      process.exit();
    }

    return `created nuxt workspace ${result.method === 'link' ? 'symlink ' : ''}${projectDir}`;
  },
};

export default NewCommand;
