import { join } from 'path';

import { ExtendedGluegunCommand } from '../../interfaces/extended-gluegun-command';
import { ExtendedGluegunToolbox } from '../../interfaces/extended-gluegun-toolbox';
import genObject from './object';

/**
 * Detect controller type based on existing modules
 * Analyzes project modules (excluding base modules) to determine common pattern
 */
function detectControllerType(filesystem: any, path: string): 'Both' | 'GraphQL' | 'Rest' {
  const modulesDir = join(path, 'src', 'server', 'modules');

  // Check if modules directory exists
  if (!filesystem.exists(modulesDir)) {
    return 'Both'; // Default if no modules exist yet
  }

  // Base modules to exclude from analysis
  const excludeModules = ['auth', 'file', 'meta', 'user'];

  // Get all module directories
  const allModules = filesystem.list(modulesDir) || [];
  const modulesToAnalyze = allModules.filter(
    (module: string) => !excludeModules.includes(module) && filesystem.isDirectory(join(modulesDir, module))
  );

  // If no modules to analyze, use default
  if (modulesToAnalyze.length === 0) {
    return 'Both';
  }

  // Count patterns
  let onlyController = 0;
  let onlyResolver = 0;
  let both = 0;

  for (const module of modulesToAnalyze) {
    const moduleDir = join(modulesDir, module);
    const hasController = filesystem.exists(join(moduleDir, `${module}.controller.ts`));
    const hasResolver = filesystem.exists(join(moduleDir, `${module}.resolver.ts`));

    if (hasController && hasResolver) {
      both++;
    } else if (hasController && !hasResolver) {
      onlyController++;
    } else if (!hasController && hasResolver) {
      onlyResolver++;
    }
    // If neither exists, skip (incomplete module)
  }

  // Decision logic
  // If we have clear majority pattern, use it
  if (both > 0) {
    return 'Both'; // If any module uses both, prefer both
  } else if (onlyController > 0 && onlyResolver === 0) {
    return 'Rest'; // Only REST controllers found
  } else if (onlyResolver > 0 && onlyController === 0) {
    return 'GraphQL'; // Only GraphQL resolvers found
  }

  // Default to Both if mixed or unclear
  return 'Both';
}

/**
 * Create a new server module
 */
const NewCommand: ExtendedGluegunCommand = {
  alias: ['m'],
  description: 'Create server module',
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
    const { currentItem, preventExitProcess } = {
      currentItem: '',
      preventExitProcess: false,
      ...options,
    };
    let { objectsToAdd = [], referencesToAdd = [] } = options || {};

    // Retrieve the tools we need
    const {
      config,
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

    // Load configuration
    const ltConfig = config.loadConfig();
    const configController = ltConfig?.commands?.server?.module?.controller;

    // Load global defaults
    const globalController = config.getGlobalDefault<string>(ltConfig, 'controller');

    // Parse CLI arguments
    const { controller: cliController, name: cliName, skipLint: cliSkipLint } = parameters.options;

    // Determine noConfirm with priority: CLI > config > global > default (false)
    const noConfirm = config.getNoConfirm({
      cliValue: parameters.options.noConfirm,
      commandConfig: ltConfig?.commands?.server?.module,
      config: ltConfig,
    });

    let name = cliName || currentItem || parameters.first;
    if (!name) {
      name = await helper.getInput(currentItem || parameters.first, {
        initial: currentItem || '',
        name: 'module name',
      });
    }
    if (!name) {
      return;
    }

    // Check if directory
    const cwd = filesystem.cwd();
    const path = cwd.substr(0, cwd.lastIndexOf('src'));
    if (!filesystem.exists(join(path, 'src'))) {
      info('');
      error(`No src directory in "${path}".`);
      return;
    }

    // Determine controller type with priority: CLI > config > global > auto-detect > interactive
    let controller: string;
    const detected = detectControllerType(filesystem, path);

    // Helper function to handle 'auto' controller value
    const resolveController = (value: string, source: string): string => {
      if (value.toLowerCase() === 'auto') {
        info(`Auto-detected controller pattern: ${detected} (based on existing modules, ${source})`);
        return detected;
      }
      info(`Using controller type from ${source}: ${value}`);
      return value;
    };

    // Priority 1: CLI parameter
    if (cliController) {
      controller = resolveController(cliController, 'CLI');
    }
    // Priority 2: Command-specific config
    else if (configController) {
      controller = resolveController(configController, 'lt.config commands.server.module');
    }
    // Priority 3: Global defaults
    else if (globalController) {
      controller = resolveController(globalController, 'lt.config defaults');
    }
    // Priority 4: noConfirm mode - use detected/default
    else if (noConfirm) {
      info(`Using auto-detected controller pattern: ${detected} (noConfirm mode)`);
      controller = detected;
    }
    // Priority 5: Interactive mode with auto-detection
    else {
      // Map detected value to index for initial selection
      const choices = ['Rest', 'GraphQL', 'Both'];
      const initialIndex = choices.indexOf(detected);

      info(`Detected controller pattern: ${detected} (based on existing modules)`);
      controller = (await ask([{
        choices,
        initial: initialIndex >= 0 ? initialIndex : 2, // Default to 'Both' (index 2)
        message: 'What controller type?',
        name: 'controller',
        type: 'select',
      }])).controller || detected;
    }

    // Set up initial props (to pass into templates)
    const nameCamel = camelCase(name);
    const nameKebab = kebabCase(name);
    const namePascal = pascalCase(name);
    const directory = join(path, 'src', 'server', 'modules', nameKebab);
    if (filesystem.exists(directory)) {
      info('');
      error(`Module directory "${directory}" already exists.`);
      return;
    }

    const { objectsToAdd: newObjects, props, referencesToAdd: newReferences, refsSet, schemaSet }
      = await toolbox.parseProperties({ objectsToAdd, referencesToAdd });

    objectsToAdd = newObjects;
    referencesToAdd = newReferences;

    const generateSpinner = spin('Generate files');
    const inputTemplate = server.propsForInput(props, { modelName: name, nullable: true });
    const createTemplate = server.propsForInput(props, { create: true, modelName: name, nullable: false });
    const modelTemplate = server.propsForModel(props, { modelName: name });

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
      props: { imports: createTemplate.imports, isGql: controller === 'GraphQL' || controller === 'Both', nameCamel, nameKebab, namePascal, props: createTemplate.props },
      target: join(directory, 'inputs', `${nameKebab}-create.input.ts`),
      template: 'nest-server-module/inputs/template-create.input.ts.ejs',
    });

    // nest-server-module/output/find-and-count-xxxs-result.output.ts
    await template.generate({
      props: { isGql: controller === 'GraphQL' || controller === 'Both', nameCamel, nameKebab, namePascal },
      target: join(directory, 'outputs', `find-and-count-${nameKebab}s-result.output.ts`),
      template: 'nest-server-module/outputs/template-fac-result.output.ts.ejs',
    });

    // nest-server-module/xxx.model.ts
    await template.generate({
      props: {
        imports: modelTemplate.imports,
        isGql: controller === 'GraphQL' || controller === 'Both',
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
      props: { isGql: controller === 'GraphQL' || controller === 'Both', nameCamel, nameKebab, namePascal },
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

        // Ensure forwardRef is imported from @nestjs/common
        const serverModuleContent = filesystem.read(serverModule);
        if (serverModuleContent && !serverModuleContent.includes('forwardRef')) {
          // Add forwardRef to @nestjs/common import
          await patching.patch(serverModule, {
            insert: '$1, forwardRef$2',
            replace: /from '@nestjs\/common'(.*?)}/,
          });
        } else if (serverModuleContent && serverModuleContent.includes('@nestjs/common') && !serverModuleContent.match(/forwardRef.*@nestjs\/common|@nestjs\/common.*forwardRef/)) {
          // forwardRef exists but not in @nestjs/common import - add it
          await patching.patch(serverModule, {
            insert: '$1, forwardRef$2',
            replace: /(\w+)\s*}\s*from\s+'@nestjs\/common'/,
          });
        }
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

    // Lint fix with priority: CLI > config > global > default (false)
    const skipLint = config.getSkipLint({
      cliValue: cliSkipLint,
      commandConfig: ltConfig?.commands?.server?.module,
      config: ltConfig,
    });

    if (!skipLint) {
      // Run lint fix - skip confirmation when noConfirm, otherwise ask
      const runLint = noConfirm || await confirm('Run lint fix?', true);
      if (runLint) {
        await system.run('npm run lint:fix');
      }
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
