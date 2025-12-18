import { GluegunCommand } from 'gluegun';
import { join } from 'path';

import { ExtendedGluegunToolbox } from '../../interfaces/extended-gluegun-toolbox';

/**
 * Create a new deployment for mono repository
 */
const NewCommand: GluegunCommand = {
  alias: ['dc'],
  description: 'Create deployment config',
  hidden: false,
  name: 'create',
  run: async (toolbox: ExtendedGluegunToolbox) => {
    // Retrieve the tools we need
    const {
      config,
      filesystem,
      helper,
      parameters,
      patching,
      print: { info, spin, success },
      prompt: { confirm },
      strings: { camelCase, kebabCase, pascalCase },
      system,
      template,
    } = toolbox;

    // Load configuration
    const ltConfig = config.loadConfig();
    const configDomain = ltConfig?.commands?.deployment?.domain;
    const configGitHub = ltConfig?.commands?.deployment?.gitHub;
    const configGitLab = ltConfig?.commands?.deployment?.gitLab;
    const configTestRunner = ltConfig?.commands?.deployment?.testRunner;
    const configProdRunner = ltConfig?.commands?.deployment?.prodRunner;

    // Load global defaults
    const globalDomain = config.getGlobalDefault<string>(ltConfig, 'domain');

    // Parse CLI arguments
    const cliDomain = parameters.options.domain;
    const cliGitHub = parameters.options.gitHub;
    const cliGitLab = parameters.options.gitLab;
    const cliTestRunner = parameters.options.testRunner;
    const cliProdRunner = parameters.options.prodRunner;
    const cliNoConfirm = parameters.options.noConfirm;

    // Determine noConfirm with priority: CLI > command > parent > global > default
    const noConfirm = config.getNoConfirm({
      cliValue: cliNoConfirm,
      commandConfig: ltConfig?.commands?.deployment,
      config: ltConfig,
    });

    // Start timer
    const timer = system.startTimer();

    // Info
    info('Create a new deployment');

    // Get default project name
    let projectName = '';
    const hasLtJson = await filesystem.exists('lt.json');
    if (hasLtJson) {
      await patching.update('lt.json', (data: Record<string, any>) => {
        projectName = data.name;
        return data;
      });
    }

    if (!projectName) {
      await patching.update('package.json', (data: Record<string, any>) => {
        projectName = pascalCase(data.name);
        return data;
      });
    }

    // Get name
    const name = await helper.getInput(parameters.first, {
      initial: projectName,
      name: `project name (e.g. ${projectName ? projectName : 'My new project'})`,
    });

    if (!name) {
      return;
    }

    // Determine domain with priority: CLI > config > global > interactive
    let domain: string;
    if (cliDomain) {
      domain = cliDomain;
    } else if (configDomain) {
      domain = configDomain.replace('{name}', kebabCase(name));
      info(`Using domain from lt.config commands.deployment: ${domain}`);
    } else if (globalDomain) {
      domain = globalDomain.replace('{name}', kebabCase(name));
      info(`Using domain from lt.config defaults: ${domain}`);
    } else {
      domain = await helper.getInput(parameters.second, {
        initial: `${kebabCase(name)}.lenne.tech`,
        name: `main domain of the project (e.g. ${kebabCase(name)}.lenne.tech)`,
      });
    }

    if (!domain) {
      return;
    }

    // Determine gitHub with priority: CLI > config > noConfirm > interactive
    let gitHub: boolean;
    if (cliGitHub !== undefined) {
      gitHub = cliGitHub === true || cliGitHub === 'true';
    } else if (configGitHub !== undefined) {
      gitHub = configGitHub;
      if (gitHub) {
        info('Using GitHub pipeline setting from lt.config: enabled');
      }
    } else if (noConfirm) {
      gitHub = false; // Default to false when noConfirm
    } else {
      gitHub = await confirm('Add GitHub pipeline?');
    }

    // Determine gitLab with priority: CLI > config > noConfirm > interactive
    let gitLab: boolean;
    if (cliGitLab !== undefined) {
      gitLab = cliGitLab === true || cliGitLab === 'true';
    } else if (configGitLab !== undefined) {
      gitLab = configGitLab;
      if (gitLab) {
        info('Using GitLab pipeline setting from lt.config: enabled');
      }
    } else if (noConfirm) {
      gitLab = false; // Default to false when noConfirm
    } else {
      gitLab = await confirm('Add GitLab pipeline?');
    }

    // GitLab test runner
    let testRunner: string | undefined;
    let prodRunner: string | undefined;
    if (gitLab) {
      // Determine testRunner with priority: CLI > config > interactive
      if (cliTestRunner) {
        testRunner = cliTestRunner;
      } else if (configTestRunner) {
        testRunner = configTestRunner;
        info(`Using test runner from lt.config: ${testRunner}`);
      } else {
        testRunner = await helper.getInput('', {
          initial: 'docker-swarm',
          name: 'runner for test (tag in .gitlab-ci.yml, e.g. docker-swarm)',
        });
      }
      if (!testRunner) {
        return;
      }

      // Determine prodRunner with priority: CLI > config > interactive
      if (cliProdRunner) {
        prodRunner = cliProdRunner;
      } else if (configProdRunner) {
        prodRunner = configProdRunner;
        info(`Using prod runner from lt.config: ${prodRunner}`);
      } else {
        prodRunner = await helper.getInput('', {
          initial: 'docker-landing',
          name: 'runner for production (tag in .gitlab-ci.yml, e.g. docker-landing)',
        });
      }
      if (!prodRunner) {
        return;
      }
    }

    // Set up initial props (to pass into templates)
    const nameCamel = camelCase(name);
    const nameKebab = kebabCase(name);
    const namePascal = pascalCase(name);

    // Check if directory
    const cwd = filesystem.cwd();

    const generateSpinner = spin('Generate files');

    await template.generate({
      props: { nameCamel, nameKebab, namePascal },
      target: join(cwd, 'scripts', 'build-push.sh'),
      template: 'deployment/scripts/build-push.sh.ejs',
    });

    await template.generate({
      props: { nameCamel, nameKebab, namePascal },
      target: join(cwd, 'scripts', 'deploy.sh'),
      template: 'deployment/scripts/deploy.sh.ejs',
    });

    await template.generate({
      props: { nameCamel, nameKebab, namePascal },
      target: join(cwd, 'Dockerfile'),
      template: 'deployment/Dockerfile.ejs',
    });

    await template.generate({
      props: { nameCamel, nameKebab, namePascal },
      target: join(cwd, 'Dockerfile.app'),
      template: 'deployment/Dockerfile.app.ejs',
    });

    await template.generate({
      props: { nameCamel, nameKebab, namePascal },
      target: join(cwd, 'docker-compose.dev.yml'),
      template: 'deployment/docker-compose.dev.yml.ejs',
    });

    await template.generate({
      props: { nameCamel, nameKebab, namePascal },
      target: join(cwd, 'docker-compose.test.yml'),
      template: 'deployment/docker-compose.test.yml.ejs',
    });

    await template.generate({
      props: { nameCamel, nameKebab, namePascal },
      target: join(cwd, 'docker-compose.prod.yml'),
      template: 'deployment/docker-compose.prod.yml.ejs',
    });

    if (gitHub) {
      await template.generate({
        props: { nameCamel, nameKebab, namePascal, url: domain },
        target: join(cwd, '.github', 'workflows', 'pre-release.yml'),
        template: 'deployment/.github/workflows/pre-release.yml.ejs',
      });

      await template.generate({
        props: { nameCamel, nameKebab, namePascal, url: domain },
        target: join(cwd, '.github', 'workflows', 'release.yml'),
        template: 'deployment/.github/workflows/release.yml.ejs',
      });
    }

    if (gitLab) {
      await template.generate({
        props: { nameCamel, nameKebab, namePascal, prodRunner, testRunner, url: domain },
        target: join(cwd, '.gitlab-ci.yml'),
        template: 'deployment/.gitlab-ci.yml.ejs',
      });
    }

    generateSpinner.succeed('Files generated');

    const environmentsSpinner = spin('Update app environment files');
    const prodEnv = await filesystem.exists('projects/app/src/environments/environment.prod.ts');
    if (prodEnv) {
      await patching.patch('projects/app/src/environments/environment.prod.ts', {
        insert: `https://api.${domain}`,
        replace: new RegExp('http://127.0.0.1:3000', 'g'),
      });
      await patching.patch('projects/app/src/environments/environment.prod.ts', {
        insert: `wss://api.${domain}`,
        replace: new RegExp('ws://127.0.0.1:3000', 'g'),
      });
      await patching.patch('projects/app/src/environments/environment.prod.ts', {
        insert: `https://${domain}`,
        replace: new RegExp('http://127.0.0.1:4200', 'g'),
      });
    } else {
      info('Missing projects/app/src/environments/environment.prod.ts');
    }

    const testEnv = await filesystem.exists('projects/app/src/environments/environment.test.ts');
    if (testEnv) {
      await patching.patch('projects/app/src/environments/environment.test.ts', {
        insert: `https://api.test.${domain}`,
        replace: new RegExp('http://127.0.0.1:3000', 'g'),
      });
      await patching.patch('projects/app/src/environments/environment.test.ts', {
        insert: `wss://api.test.${domain}`,
        replace: new RegExp('ws://127.0.0.1:3000', 'g'),
      });
      await patching.patch('projects/app/src/environments/environment.test.ts', {
        insert: `https://test.${domain}`,
        replace: new RegExp('http://127.0.0.1:4200', 'g'),
      });
    } else {
      info('Missing projects/app/src/environments/environment.test.ts');
    }

    environmentsSpinner.succeed('App environment files updated');

    // We're done, so show what to do next
    info('');
    success(`Generated deployment for ${namePascal} in ${helper.msToMinutesAndSeconds(timer())}m.`);
    info('');

    // Hint for CI/CD
    const subDomains = ['www', 'api', 'test', 'www.test', 'api.test'];
    let urlStr = `\n- ${domain}`;
    for (const sub of subDomains) {
      urlStr += `\n- ${sub}.${domain}`;
    }
    success(`HINT: please initialize following Domains before running the CI/CD pipeline:${urlStr}`);
    info('');

    if (!toolbox.parameters.options.fromGluegunMenu) {
      process.exit();
    }

    // For tests
    return `new deployment ${name}`;
  },
};

export default NewCommand;
