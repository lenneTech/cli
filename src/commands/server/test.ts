import { GluegunCommand } from 'gluegun';
import { join } from 'path';

import { ExtendedGluegunToolbox } from '../../interfaces/extended-gluegun-toolbox';

/**
 * Create a new server
 */
const NewCommand: GluegunCommand = {
  alias: ['t'],
  description: 'Creates a new test file',
  hidden: false,
  name: 'test',
  run: async (toolbox: ExtendedGluegunToolbox) => {
    // Retrieve the tools we need
    const {
      filesystem,
      helper,
      parameters,
      print: { error, info, spin, success },
      strings: { camelCase, kebabCase, pascalCase },
      system,
      template,
    } = toolbox;

    // Start timer
    const timer = system.startTimer();

    // Info
    info('Create a new test file');

    // Get name
    const name = await helper.getInput(parameters.first, {
      name: 'test name',
    });
    if (!name) {
      return;
    }

    // Set up initial props (to pass into templates)
    const nameCamel = camelCase(name);
    const nameKebab = kebabCase(name);
    const namePascal = pascalCase(name);

    // Check if directory
    const cwd = filesystem.cwd();
    const path = cwd.substr(0, cwd.lastIndexOf('src'));
    if (!filesystem.exists(join(path, 'tests'))) {
      info('');
      error(`No tests directory in "${path}".`);
      return;
    }
    const testsDir = join(path, 'tests');
    const filePath = join(testsDir, `${nameKebab}.e2e-spec.ts`);

    // Check if file already exists
    if (filesystem.exists(filePath)) {
      info('');
      error(`There's already a file named "${filePath}"`);
      return;
    }

    const generateSpinner = spin('Generate test file');

    // nest-server-tests/tests.e2e-spec.ts.ejs
    await template.generate({
      props: { nameCamel, nameKebab, namePascal },
      target: filePath,
      template: 'nest-server-tests/tests.e2e-spec.ts.ejs',
    });

    generateSpinner.succeed('Generate test file');

    // We're done, so show what to do next
    info('');
    success(`Generated ${namePascal} test file in ${helper.msToMinutesAndSeconds(timer())}m.`);
    info('');

    if (!toolbox.parameters.options.fromGluegunMenu) {
      process.exit();
    }

    // For tests
    return `new test ${name}`;
  },
};

export default NewCommand;
