import { join } from 'path';

import { ExtendedGluegunCommand } from '../../interfaces/extended-gluegun-command';
import { ExtendedGluegunToolbox } from '../../interfaces/extended-gluegun-toolbox';
import { getFrameworkImportSpecifier } from '../../lib/framework-detection';
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
    (module: string) => !excludeModules.includes(module) && filesystem.isDirectory(join(modulesDir, module)),
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

    // Handle --help-json flag
    if (
      toolbox.tools.helpJson({
        aliases: ['m'],
        configuration: 'commands.server.module.*',
        description: 'Create server module',
        name: 'module',
        options: [
          { description: 'Module name', flag: '--name', required: true, type: 'string' },
          {
            description: 'Controller type',
            flag: '--controller',
            required: false,
            type: 'string',
            values: ['Rest', 'GraphQL', 'Both', 'auto'],
          },
          {
            default: false,
            description: 'Skip all interactive prompts',
            flag: '--noConfirm',
            required: false,
            type: 'boolean',
          },
          {
            default: false,
            description: 'Skip lint fix after generation',
            flag: '--skipLint',
            required: false,
            type: 'boolean',
          },
          {
            default: false,
            description: 'Preview what would be generated without creating files',
            flag: '--dryRun',
            required: false,
            type: 'boolean',
          },
        ],
        propertyFlags: {
          attributes: [
            { description: 'Property name', name: 'name', type: 'string' },
            {
              description: 'Property type',
              name: 'type',
              type: 'string',
              values: ['string', 'number', 'boolean', 'bigint', 'Date', 'ObjectId', 'Json'],
            },
            { description: 'Optional field', name: 'nullable', type: 'boolean' },
            { description: 'Array of this type', name: 'array', type: 'boolean' },
            { description: 'Enum type reference', name: 'enum', type: 'string' },
            { description: 'Embedded object/schema reference', name: 'schema', type: 'string' },
            { description: 'Reference module for ObjectId fields', name: 'reference', type: 'string' },
          ],
          pattern: '--prop-<attribute>-<index>',
        },
      })
    ) {
      return;
    }

    // Start timer
    const timer = system.startTimer();

    // Info
    if (currentItem) {
      info(`Creating a new server module for ${currentItem}`);
    } else {
      info('Create a new server module');
    }

    // Hint for non-interactive callers (e.g. Claude Code)
    toolbox.tools.nonInteractiveHint(
      'lt server module --name <name> --controller <Rest|GraphQL|Both|auto> --noConfirm',
    );

    // Load configuration
    const ltConfig = config.loadConfig();
    const configController = ltConfig?.commands?.server?.module?.controller;

    // Load global defaults
    const globalController = config.getGlobalDefault<string>(ltConfig, 'controller');

    // Parse CLI arguments
    const { controller: cliController, name: cliName, skipLint: cliSkipLint } = parameters.options;

    // Parse dry-run flag early
    const dryRun = parameters.options.dryRun || parameters.options['dry-run'];

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
      controller =
        (
          await ask([
            {
              choices,
              initial: initialIndex >= 0 ? initialIndex : 2, // Default to 'Both' (index 2)
              message: 'What controller type?',
              name: 'controller',
              type: 'select',
            },
          ])
        ).controller || detected;
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

    // Dry-run mode: show what would happen and exit
    if (dryRun) {
      info('');
      info(`Dry run: lt server module --name ${name} --controller ${controller}`);
      info('');
      info('Files that would be created:');
      info(`  src/server/modules/${nameKebab}/${nameKebab}.model.ts`);
      info(`  src/server/modules/${nameKebab}/${nameKebab}.service.ts`);
      if (controller === 'Rest' || controller === 'Both') {
        info(`  src/server/modules/${nameKebab}/${nameKebab}.controller.ts`);
      }
      if (controller === 'GraphQL' || controller === 'Both') {
        info(`  src/server/modules/${nameKebab}/${nameKebab}.resolver.ts`);
      }
      info(`  src/server/modules/${nameKebab}/${nameKebab}.module.ts`);
      info(`  src/server/modules/${nameKebab}/inputs/${nameKebab}.input.ts`);
      info(`  src/server/modules/${nameKebab}/inputs/${nameKebab}-create.input.ts`);
      info(`  src/server/modules/${nameKebab}/outputs/find-and-count-${nameKebab}s-result.output.ts`);
      info('');
      const serverModule = join(path, 'src', 'server', 'server.module.ts');
      if (filesystem.exists(serverModule)) {
        info('Files that would be modified:');
        info('  src/server/server.module.ts');
        info('');
      }
      return `dry-run module ${name}`;
    }

    const {
      objectsToAdd: newObjects,
      props,
      referencesToAdd: newReferences,
      refsSet,
      schemaSet,
    } = await toolbox.parseProperties({ objectsToAdd, referencesToAdd });

    objectsToAdd = newObjects;
    referencesToAdd = newReferences;

    const generateSpinner = spin('Generate files');
    const inputTemplate = server.propsForInput(props, { modelName: name, nullable: true });
    const createTemplate = server.propsForInput(props, { create: true, modelName: name, nullable: false });
    const modelTemplate = server.propsForModel(props, { modelName: name });

    // Compute the correct framework-import specifier for each generated file.
    // In vendored projects this resolves to a relative path to src/core (depth
    // depends on file location); in npm projects it stays '@lenne.tech/nest-server'.
    const importFor = (target: string) => getFrameworkImportSpecifier(path, target);

    // nest-server-module/inputs/xxx.input.ts
    const inputTarget = join(directory, 'inputs', `${nameKebab}.input.ts`);
    await template.generate({
      props: {
        frameworkImport: importFor(inputTarget),
        imports: inputTemplate.imports,
        nameCamel,
        nameKebab,
        namePascal,
        props: inputTemplate.props,
      },
      target: inputTarget,
      template: 'nest-server-module/inputs/template.input.ts.ejs',
    });

    if (controller === 'Rest' || controller === 'Both') {
      const controllerTarget = join(directory, `${nameKebab}.controller.ts`);
      await template.generate({
        props: {
          frameworkImport: importFor(controllerTarget),
          lowercase: name.toLowerCase(),
          nameCamel: camelCase(name),
          nameKebab: kebabCase(name),
          namePascal: pascalCase(name),
        },
        target: controllerTarget,
        template: 'nest-server-module/template.controller.ts.ejs',
      });
    }

    // nest-server-module/inputs/xxx-create.input.ts
    const createInputTarget = join(directory, 'inputs', `${nameKebab}-create.input.ts`);
    await template.generate({
      props: {
        frameworkImport: importFor(createInputTarget),
        imports: createTemplate.imports,
        isGql: controller === 'GraphQL' || controller === 'Both',
        nameCamel,
        nameKebab,
        namePascal,
        props: createTemplate.props,
      },
      target: createInputTarget,
      template: 'nest-server-module/inputs/template-create.input.ts.ejs',
    });

    // nest-server-module/output/find-and-count-xxxs-result.output.ts
    const facOutputTarget = join(directory, 'outputs', `find-and-count-${nameKebab}s-result.output.ts`);
    await template.generate({
      props: {
        frameworkImport: importFor(facOutputTarget),
        isGql: controller === 'GraphQL' || controller === 'Both',
        nameCamel,
        nameKebab,
        namePascal,
      },
      target: facOutputTarget,
      template: 'nest-server-module/outputs/template-fac-result.output.ts.ejs',
    });

    // nest-server-module/xxx.model.ts
    const modelTarget = join(directory, `${nameKebab}.model.ts`);
    await template.generate({
      props: {
        frameworkImport: importFor(modelTarget),
        imports: modelTemplate.imports,
        isGql: controller === 'GraphQL' || controller === 'Both',
        mappings: modelTemplate.mappings,
        nameCamel,
        nameKebab,
        namePascal,
        props: modelTemplate.props,
      },
      target: modelTarget,
      template: 'nest-server-module/template.model.ts.ejs',
    });

    // nest-server-module/xxx.module.ts
    const moduleTarget = join(directory, `${nameKebab}.module.ts`);
    await template.generate({
      props: { controller, frameworkImport: importFor(moduleTarget), nameCamel, nameKebab, namePascal },
      target: moduleTarget,
      template: 'nest-server-module/template.module.ts.ejs',
    });

    if (controller === 'GraphQL' || controller === 'Both') {
      // nest-server-module/xxx.resolver.ts
      const resolverTarget = join(directory, `${nameKebab}.resolver.ts`);
      await template.generate({
        props: { frameworkImport: importFor(resolverTarget), nameCamel, nameKebab, namePascal },
        target: resolverTarget,
        template: 'nest-server-module/template.resolver.ts.ejs',
      });
    }

    // nest-server-module/xxx.service.ts
    const serviceTarget = join(directory, `${nameKebab}.service.ts`);
    await template.generate({
      props: {
        frameworkImport: importFor(serviceTarget),
        isGql: controller === 'GraphQL' || controller === 'Both',
        nameCamel,
        nameKebab,
        namePascal,
      },
      target: serviceTarget,
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
        if (
          serverModuleContent &&
          serverModuleContent.includes('@nestjs/common') &&
          !serverModuleContent.match(/import\s*\{[^}]*forwardRef[^}]*}\s*from\s+['"]@nestjs\/common['"]/)
        ) {
          // Add forwardRef into the existing `import { ... } from '@nestjs/common'`
          // statement by inserting it before the closing brace. The regex
          // captures two groups: (1) everything up to (but not including) the
          // closing brace of the named-import list and (2) the closing brace
          // plus the `from '@nestjs/common'` clause. The replacement wedges
          // `, forwardRef` in between.
          await patching.patch(serverModule, {
            insert: "$1, forwardRef$2",
            replace: /(import\s*\{\s*[^}]*?)(\s*\}\s*from\s+['"]@nestjs\/common['"])/,
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
      info("Don't forget to include the module into your main module.");
    }

    // We're done, so show what to do next
    info('');
    success(`Generated ${namePascal}Module in ${helper.msToMinutesAndSeconds(timer())}m.`);
    info('');

    // Print structured summary
    const summaryLines: string[] = [];
    summaryLines.push('--- Summary ---');
    summaryLines.push(`Module: ${namePascal}`);
    summaryLines.push(`Controller: ${controller}`);
    summaryLines.push(`Location: src/server/modules/${nameKebab}/`);
    summaryLines.push('');
    summaryLines.push('Created files:');
    summaryLines.push(`  + ${nameKebab}.model.ts`);
    summaryLines.push(`  + ${nameKebab}.service.ts`);
    if (controller === 'Rest' || controller === 'Both') {
      summaryLines.push(`  + ${nameKebab}.controller.ts`);
    }
    if (controller === 'GraphQL' || controller === 'Both') {
      summaryLines.push(`  + ${nameKebab}.resolver.ts`);
    }
    summaryLines.push(`  + ${nameKebab}.module.ts`);
    summaryLines.push(`  + inputs/${nameKebab}.input.ts`);
    summaryLines.push(`  + inputs/${nameKebab}-create.input.ts`);
    summaryLines.push(`  + outputs/find-and-count-${nameKebab}s-result.output.ts`);
    summaryLines.push('');
    if (filesystem.exists(join(path, 'src', 'server', 'server.module.ts'))) {
      summaryLines.push('Modified files:');
      summaryLines.push('  ~ src/server/server.module.ts');
      summaryLines.push('');
    }
    const propKeys = Object.keys(props);
    if (propKeys.length > 0) {
      summaryLines.push('Properties:');
      for (const key of propKeys) {
        const p = props[key];
        const parts: string[] = [];
        if (p.isArray) parts.push('array');
        if (p.nullable) parts.push('nullable');
        const suffix = parts.length > 0 ? ` (${parts.join(', ')})` : '';
        summaryLines.push(`  - ${p.name}${p.nullable ? '?' : ''}: ${p.type}${p.isArray ? '[]' : ''}${suffix}`);
      }
      summaryLines.push('');
    }
    summaryLines.push('Next steps:');
    summaryLines.push('  1. Add descriptions to @UnifiedField decorators');
    summaryLines.push('  2. Customize securityCheck() in model');
    summaryLines.push('  3. Add business logic to service');
    summaryLines.push('  4. Run: lt server permissions --failOnWarnings');
    summaryLines.push('---');
    info(summaryLines.join('\n'));
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
      const runLint = noConfirm || (await confirm('Run lint fix?', true));
      if (runLint) {
        await system.run(toolbox.pm.run('lint:fix'));
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
