import { join } from 'path';

import { ExtendedGluegunCommand } from '../../interfaces/extended-gluegun-command';
import { ExtendedGluegunToolbox } from '../../interfaces/extended-gluegun-toolbox';
import genModule from './module';

/**
 * Create a new server object
 */
const NewCommand: ExtendedGluegunCommand = {
  alias: ['o'],
  description: 'Create embedded object',
  hidden: false,
  name: 'object',
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
      config,
      filesystem,
      helper,
      parameters,
      print: { divider, error, info, spin, success },
      prompt: { confirm },
      server,
      strings: { camelCase, kebabCase, pascalCase },
      system,
      template,
    } = toolbox;

    // Handle --help-json flag
    if (
      toolbox.tools.helpJson({
        aliases: ['o'],
        configuration: 'commands.server.object.*',
        description: 'Create embedded object',
        name: 'object',
        options: [
          { description: 'Object name', flag: '--name', required: true, type: 'string' },
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
      info(`Create a new server object (with inputs) for ${currentItem}`);
    } else {
      info('Create a new server object (with inputs)');
    }

    // Load configuration
    const ltConfig = config.loadConfig();

    // Parse CLI arguments
    const { name: cliName, skipLint: cliSkipLint } = parameters.options;

    // Parse dry-run flag early
    const dryRun = parameters.options.dryRun || parameters.options['dry-run'];

    // Get name
    let name = cliName || currentItem || parameters.first;
    if (!name) {
      name = await helper.getInput(currentItem || parameters.first, {
        initial: currentItem || '',
        name: 'object name',
      });
    }
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
    if (!filesystem.exists(join(path, 'src'))) {
      info('');
      error(`No src directory in "${path}".`);
      return;
    }
    const directory = join(path, 'src', 'server', 'common', 'objects', nameKebab);
    if (filesystem.exists(directory)) {
      info('');
      error(`Module directory "${directory}" already exists.`);
      return;
    }

    // Dry-run mode: show what would happen and exit
    if (dryRun) {
      info('');
      info(`Dry run: lt server object --name ${name}`);
      info('');
      info('Files that would be created:');
      info(`  src/server/common/objects/${nameKebab}/${nameKebab}.object.ts`);
      info(`  src/server/common/objects/${nameKebab}/${nameKebab}.input.ts`);
      info(`  src/server/common/objects/${nameKebab}/${nameKebab}-create.input.ts`);
      info('');
      return `dry-run object ${name}`;
    }

    // Parse properties from CLI or interactive mode
    const { props, refsSet, schemaSet } = await toolbox.parseProperties({ objectsToAdd, referencesToAdd });

    const generateSpinner = spin('Generate files');
    const inputTemplate = server.propsForInput(props, { modelName: name, nullable: true });
    const createTemplate = server.propsForInput(props, { create: true, modelName: name, nullable: false });
    const objectTemplate = server.propsForModel(props, { modelName: name });

    // nest-server-module/inputs/xxx.input.ts
    await template.generate({
      props: { imports: inputTemplate.imports, nameCamel, nameKebab, namePascal, props: inputTemplate.props },
      target: join(directory, `${nameKebab}.input.ts`),
      template: 'nest-server-object/template.input.ts.ejs',
    });

    // nest-server-object/inputs/xxx-create.input.ts
    await template.generate({
      props: { imports: createTemplate.imports, nameCamel, nameKebab, namePascal, props: createTemplate.props },
      target: join(directory, `${nameKebab}-create.input.ts`),
      template: 'nest-server-object/template-create.input.ts.ejs',
    });

    // nest-server-module/xxx.model.ts
    await template.generate({
      props: {
        imports: objectTemplate.imports,
        mappings: objectTemplate.mappings,
        nameCamel,
        nameKebab,
        namePascal,
        props: objectTemplate.props,
      },
      target: join(directory, `${nameKebab}.object.ts`),
      template: 'nest-server-object/template.object.ts.ejs',
    });

    generateSpinner.succeed('Files generated');

    // Print structured summary
    const summaryLines: string[] = [];
    summaryLines.push('--- Summary ---');
    summaryLines.push(`Object: ${namePascal}`);
    summaryLines.push(`Location: src/server/common/objects/${nameKebab}/`);
    summaryLines.push('');
    summaryLines.push('Created files:');
    summaryLines.push(`  + ${nameKebab}.object.ts`);
    summaryLines.push(`  + ${nameKebab}.input.ts`);
    summaryLines.push(`  + ${nameKebab}-create.input.ts`);
    summaryLines.push('');
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
    summaryLines.push('  2. Customize securityCheck() in object');
    summaryLines.push('---');
    info(summaryLines.join('\n'));
    info('');

    // Lint fix with priority: CLI > config > global > default (false)
    const skipLint = config.getSkipLint({
      cliValue: cliSkipLint,
      commandConfig: ltConfig?.commands?.server?.object,
      config: ltConfig,
    });

    if (!skipLint) {
      if (await confirm('Run lint fix?', true)) {
        await system.run(toolbox.pm.run('lint:fix'));
      }
    }

    // We're done, so show what to do next
    info('');
    success(`Generated ${namePascal}Object in ${helper.msToMinutesAndSeconds(timer())}m.`);
    info('');

    // Add additional references
    if (referencesToAdd.length > 0) {
      divider();
      const nextRef = referencesToAdd.shift().reference;
      await genModule.run(toolbox, { currentItem: nextRef, objectsToAdd, preventExitProcess: true, referencesToAdd });
    }

    // Add additional objects
    if (objectsToAdd.length > 0) {
      divider();
      const nextObj = objectsToAdd.shift().object;
      await NewCommand.run(toolbox, { currentItem: nextObj, objectsToAdd, preventExitProcess: true, referencesToAdd });
    }

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
    return `new object ${name}`;
  },
};

export default NewCommand;
