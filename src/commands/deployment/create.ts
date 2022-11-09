import { GluegunCommand } from 'gluegun';
import { join } from 'path';
import { ExtendedGluegunToolbox } from '../../interfaces/extended-gluegun-toolbox';

/**
 * Create a new server module
 */
const NewCommand: GluegunCommand = {
  name: 'create',
  alias: ['dc'],
  description: 'Creates a new deployment for mono repository',
  hidden: false,
  run: async (toolbox: ExtendedGluegunToolbox) => {
    // Retrieve the tools we need
    const {
      filesystem,
      helper,
      parameters,
      print: { info, spin, success },
      strings: { kebabCase, pascalCase, camelCase },
      prompt: { confirm },
      system,
      template,
    } = toolbox;

    // Start timer
    const timer = system.startTimer();

    // Info
    info('Create a new deployment');

    // Get name
    const name = await helper.getInput(parameters.first, {
      name: 'project name',
    });

    if (!name) {
      return;
    }

    // Get url
    const url = await helper.getInput(parameters.second, {
      name: 'url for deployment',
    });

    if (!name) {
      return;
    }

    const gitHub = await confirm(`Add GitHub pipeline?`);
    const gitLab = await confirm(`Add GitLab pipeline?`);

    // Set up initial props (to pass into templates)
    const nameCamel = camelCase(name);
    const nameKebab = kebabCase(name);
    const namePascal = pascalCase(name);

    // Check if directory
    const cwd = filesystem.cwd();

    const generateSpinner = spin('Generate files');

    await template.generate({
      template: 'deployment/scripts/build-push.sh.ejs',
      target: join(cwd, 'scripts', 'build-push.sh'),
      props: { nameCamel, nameKebab, namePascal },
    });

    await template.generate({
      template: 'deployment/scripts/deploy.sh.ejs',
      target: join(cwd, 'scripts', 'deploy.sh'),
      props: { nameCamel, nameKebab, namePascal },
    });

    await template.generate({
      template: 'deployment/Dockerfile.ejs',
      target: join(cwd, 'Dockerfile'),
      props: { nameCamel, nameKebab, namePascal },
    });

    await template.generate({
      template: 'deployment/Dockerfile.app.ejs',
      target: join(cwd, 'Dockerfile.app'),
      props: { nameCamel, nameKebab, namePascal },
    });

    await template.generate({
      template: 'deployment/docker-compose.develop.yml.ejs',
      target: join(cwd, 'docker-compose.develop.yml'),
      props: { nameCamel, nameKebab, namePascal },
    });

    await template.generate({
      template: 'deployment/docker-compose.test.yml.ejs',
      target: join(cwd, 'docker-compose.test.yml'),
      props: { nameCamel, nameKebab, namePascal },
    });

    await template.generate({
      template: 'deployment/docker-compose.prod.yml.ejs',
      target: join(cwd, 'docker-compose.prod.yml'),
      props: { nameCamel, nameKebab, namePascal },
    });

    if (gitHub) {
      await template.generate({
        template: 'deployment/.github/workflows/pre-release.yml.ejs',
        target: join(cwd, '.github', 'workflows', 'pre-release.yml'),
        props: { nameCamel, nameKebab, namePascal, url },
      });

      await template.generate({
        template: 'deployment/.github/workflows/release.yml.ejs',
        target: join(cwd, '.github', 'workflows', 'release.yml'),
        props: { nameCamel, nameKebab, namePascal, url },
      });
    }

    if (gitLab) {
      await template.generate({
        template: 'deployment/.gitlab-ci.yml.ejs',
        target: join(cwd, '.gitlab-ci.yml'),
        props: { nameCamel, nameKebab, namePascal, url },
      });
    }

    generateSpinner.succeed('Files generated');

    // We're done, so show what to do next
    info(``);
    success(`Generated deployment for ${namePascal} in ${helper.msToMinutesAndSeconds(timer())}m.`);
    info(``);

    if (!toolbox.parameters.options.fromGluegunMenu) {
      process.exit();
    }

    // For tests
    return `new deployment ${name}`;
  },
};

export default NewCommand;
