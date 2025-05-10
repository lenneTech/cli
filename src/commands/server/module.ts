import { join } from 'path';

import { ExtendedGluegunCommand } from '../../interfaces/extended-gluegun-command';
import { ExtendedGluegunToolbox } from '../../interfaces/extended-gluegun-toolbox';
import genObject from './object';

/**
 * Create a new server module
 */
const NewCommand: ExtendedGluegunCommand = {
  alias: ['m'],
  description: 'Creates a new server module',
  hidden: false,
  name: 'module',
  run: async (
    toolbox: ExtendedGluegunToolbox,
    options?: {
      currentItem?: string;
      objectsToAdd?: { object: string; property: string }[];
      preventExitProcess?: boolean;
      referencesToAdd?: { property: string; reference: string }[];
    },
  ) => {

    // Options:
    const { currentItem, objectsToAdd, preventExitProcess, referencesToAdd } = {
      currentItem: '',
      objectsToAdd: [],
      preventExitProcess: false,
      referencesToAdd: [],
      ...options,
    };

    // Retrieve the tools we need
    const {
      filesystem,
      helper,
      parameters,
      patching,
      print: { divider, error, info, spin, success },
      prompt: { ask, confirm },
      server,
      strings: { camelCase, kebabCase, pascalCase },
      system,
      template,
    } = toolbox;

    // Start timer
    const timer = system.startTimer();

    // Info
    if (currentItem) {
      info(`Creating a new server module for ${currentItem}`);
    } else {
      info('Create a new server module');
    }

    const name = await helper.getInput(currentItem || parameters.first, {
      initial: currentItem || '',
      name: 'module name',
    });
    if (!name) {
      return;
    }


    const controller = (await ask({
      choices: ['Rest', 'GraphQL', 'Both'],
      message: 'What controller type?',
      name: 'controller',
      type: 'select',
    })).controller;

    // Set up initial props (to pass into templates)
    const nameCamel = camelCase(name);
    const nameKebab = kebabCase(name);
    const namePascal = pascalCase(name);

    // Check if directory
    const cwd = filesystem.cwd();
    const path = cwd.substr(0, cwd.lastIndexOf('src'));
    if (!filesystem.exists(join(path, 'src'))) {
      info('');
      error(`No src directory in "${path}".`);
      return undefined;
    }
    const directory = join(path, 'src', 'server', 'modules', nameKebab);
    if (filesystem.exists(directory)) {
      info('');
      error(`Module directory "${directory}" already exists.`);
      return undefined;
    }

    const { props, refsSet, schemaSet } = await server.addProperties({ objectsToAdd, referencesToAdd });

    const generateSpinner = spin('Generate files');
    const declare = server.useDefineForClassFieldsActivated();
    const inputTemplate = server.propsForInput(props, { declare, modelName: name, nullable: true });
    const createTemplate = server.propsForInput(props, { create: true, declare, modelName: name, nullable: false });
    const modelTemplate = server.propsForModel(props, { declare, modelName: name });

    // nest-server-module/inputs/xxx.input.ts
    await template.generate({
      props: { imports: inputTemplate.imports, nameCamel, nameKebab, namePascal, props: inputTemplate.props },
      target: join(directory, 'inputs', `${nameKebab}.input.ts`),
      template: 'nest-server-module/inputs/template.input.ts.ejs',
    });

    if (controller === 'Rest' || controller === 'Both') {
      await template.generate({
        props: { lowercase: name.toLowerCase(), nameCamel: camelCase(name), nameKebab: kebabCase(name), namePascal: pascalCase(name) },
        target: join(directory, `${nameKebab}.controller.ts`),
        template: 'nest-server-module/template.controller.ts.ejs',
      });
    }

    // nest-server-module/inputs/xxx-create.input.ts
    await template.generate({
      props: { imports: createTemplate.imports, nameCamel, nameKebab, namePascal, props: createTemplate.props },
      target: join(directory, 'inputs', `${nameKebab}-create.input.ts`),
      template: 'nest-server-module/inputs/template-create.input.ts.ejs',
    });

    // nest-server-module/output/find-and-count-xxxs-result.output.ts
    await template.generate({
      props: { nameCamel, nameKebab, namePascal },
      target: join(directory, 'outputs', `find-and-count-${nameKebab}s-result.output.ts`),
      template: 'nest-server-module/outputs/template-fac-result.output.ts.ejs',
    });

    // nest-server-module/xxx.model.ts
    await template.generate({
      props: {
        imports: modelTemplate.imports,
        mappings: modelTemplate.mappings,
        nameCamel,
        nameKebab,
        namePascal,
        props: modelTemplate.props,
      },
      target: join(directory, `${nameKebab}.model.ts`),
      template: 'nest-server-module/template.model.ts.ejs',
    });

    // nest-server-module/xxx.module.ts
    await template.generate({
      props: { controller, nameCamel, nameKebab, namePascal },
      target: join(directory, `${nameKebab}.module.ts`),
      template: 'nest-server-module/template.module.ts.ejs',
    });

    if (controller === 'GraphQL' || controller === 'Both') {
    // nest-server-module/xxx.resolver.ts
    await template.generate({
      props: { nameCamel, nameKebab, namePascal },
      target: join(directory, `${nameKebab}.resolver.ts`),
      template: 'nest-server-module/template.resolver.ts.ejs',
    });
    }

    // nest-server-module/xxx.service.ts
    await template.generate({
      props: { nameCamel, nameKebab, namePascal },
      target: join(directory, `${nameKebab}.service.ts`),
      template: 'nest-server-module/template.service.ts.ejs',
    });

    generateSpinner.succeed('Files generated');

    const serverModule = join(path, 'src', 'server', 'server.module.ts');
    if (filesystem.exists(serverModule)) {
      const includeSpinner = spin('Include module into server');

      // Import module
      await patching.patch(serverModule, {
        before: 'import',
        insert: `import { ${namePascal}Module } from './modules/${nameKebab}/${nameKebab}.module';\n`,
      });

      // Add Module directly into imports config
      const patched = await patching.patch(serverModule, {
        after: new RegExp('imports:[^\\]]*', 'm'),
        insert: `  ${namePascal}Module,\n  `,
      });

      // Add Module with forwardRef in exported imports
      if (!patched) {
        await patching.patch(serverModule, {
          after: new RegExp('imports = \\[[^\\]]*', 'm'),
          insert: ` forwardRef(() => ${namePascal}Module),\n  `,
        });
      }

      // Add comma if necessary
      await patching.patch(serverModule, {
        insert: '$1,$2',
        replace: new RegExp(`([^,\\s])(\\s*${namePascal}Module,\\s*\\])`),
      });

      includeSpinner.succeed('Module included');
    } else {
      info('Don\'t forget to include the module into your main module.');
    }

    // Linting
    // if (await confirm('Run lint?', false)) {
    //   await system.run('npm run lint');
    // }

    // We're done, so show what to do next
    info('');
    success(`Generated ${namePascal}Module in ${helper.msToMinutesAndSeconds(timer())}m.`);
    info('');

    // Add additional references
    if (referencesToAdd.length > 0) {
      divider();
      const nextRef = referencesToAdd.shift().reference;
      await NewCommand.run(toolbox, { currentItem: nextRef, objectsToAdd, preventExitProcess: true, referencesToAdd });
    }

    // Add additional objects
    if (objectsToAdd.length > 0) {
      divider();
      const nextObj = objectsToAdd.shift().object;
      await genObject.run(toolbox, { currentItem: nextObj, objectsToAdd, preventExitProcess: true, referencesToAdd });
    }

    // Lint fix
    if (await confirm('Run lint fix?', true)) {
      await system.run('npm run lint:fix');
    }

    divider();

    // We're done, so show what to do next
    if (!preventExitProcess) {
      if (refsSet || schemaSet) {
        success('HINT: References / Schemata have been added, so it is necessary to add the corresponding imports!');
      }

      if (!toolbox.parameters.options.fromGluegunMenu) {
        process.exit();
      }
    }

    // For tests
    return `new module ${name}`;
  },
};

export default NewCommand;
