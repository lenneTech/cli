import { GluegunCommand } from 'gluegun';

import { ExtendedGluegunToolbox } from '../../interfaces/extended-gluegun-toolbox';

/**
 * Create a new server
 */
const NewCommand: GluegunCommand = {
  alias: ['c'],
  description: 'Creates a new server',
  hidden: false,
  name: 'create',
  run: async (toolbox: ExtendedGluegunToolbox) => {
    // Retrieve the tools we need
    const {
      filesystem,
      git,
      helper,
      meta,
      parameters,
      patching,
      print: { error, info, spin, success },
      server,
      strings: { kebabCase },
      system,
      template,
    } = toolbox;
    
    // Start timer
    const timer = system.startTimer();
    
    // Info
    info('Create a new server');
    
    // Check git
    if (!(await git.gitInstalled())) {
      return;
    }
    
    // Get name
    const name = await helper.getInput(parameters.first, {
      name: 'server name',
      showError: true,
    });
    if (!name) {
      return;
    }
    
    // Set project directory
    const projectDir = kebabCase(name);
    
    // Check if directory already exists
    if (filesystem.exists(projectDir)) {
      info('');
      error(`There's already a folder named "${projectDir}" here.`);
      return undefined;
    }
    
    // Clone git repository
    const cloneSpinner = spin('Clone https://github.com/lenneTech/nest-server-starter.git');
    await system.run(`git clone https://github.com/lenneTech/nest-server-starter.git ${projectDir}`);
    if (filesystem.isDirectory(`./${projectDir}`)) {
      filesystem.remove(`./${projectDir}/.git`);
      cloneSpinner.succeed('Repository cloned from https://github.com/lenneTech/nest-server-starter.git');
    }
    
    // Check directory
    if (!filesystem.isDirectory(`./${projectDir}`)) {
      error(`The directory "${projectDir}" could not be created.`);
      return undefined;
    }
    
    // Get description
    const description = await helper.getInput(parameters.second, {
      name: 'Description',
      showError: false,
    });
    
    // Get author
    const author = await helper.getInput(parameters.second, {
      name: 'Author',
      showError: false,
    });
    
    const prepareSpinner = spin('Prepare files');
    
    // Set readme
    await template.generate({
      props: { description, name },
      target: `./${projectDir}/README.md`,
      template: 'nest-server-starter/README.md.ejs',
    });
    
    // Replace secret or private keys and remove `nest-server`
    await patching.update(`./${projectDir}/src/config.env.ts`, content => server.replaceSecretOrPrivateKeys(content).replace(/nest-server-/g, `${projectDir
       }-`));
    
    // Set package.json
    await patching.update(`./${projectDir}/package.json`, (config) => {
      config.author = author;
      config.bugs = {
        url: '',
      };
      config.description = description || name;
      config.homepage = '';
      config.name = projectDir;
      config.repository = {
        type: 'git',
        url: '',
      };
      config.version = '0.0.1';
      return config;
    });
    
    // Set package.json
    if (filesystem.exists(`./${projectDir}/src/meta`)) {
      await patching.update(`./${projectDir}/src/meta`, (config) => {
        config.name = name;
        config.description = description;
        return config;
      });
    }
    
    prepareSpinner.succeed('Files prepared');
    
    // Init
    const installSpinner = spin('Install npm packages');
    await system.run(`cd ${projectDir} && npm i`);
    installSpinner.succeed('NPM packages installed');
    if (git) {
      const initGitSpinner = spin('Initialize git');
      await system.run(
        `cd ${projectDir} && git init && git add . && git commit -am "Init via lenne.Tech CLI ${meta.version()}"`,
      );
      initGitSpinner.succeed('Git initialized');
    }
    
    // We're done, so show what to do next
    info('');
    success(
      `Generated ${name} server with lenne.Tech CLI ${meta.version()} in ${helper.msToMinutesAndSeconds(timer())}m.`,
    );
    info('');
    info('Next:');
    info('  Start database server (e.g. MongoDB)');
    info(`  Check config: ${projectDir}/src/config.env.ts`);
    info(`  Go to project directory: cd ${projectDir}`);
    info('  Run tests: npm run test:e2e');
    info('  Start server: npm start');
    info('');
    
    if (!toolbox.parameters.options.fromGluegunMenu) {
      process.exit();
    }
    
    // For tests
    return `new server ${name}`;
  },
};

export default NewCommand;
