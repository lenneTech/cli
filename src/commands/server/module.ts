import { GluegunCommand } from 'gluegun';
import { join } from 'path';
import { ExtendedGluegunToolbox } from '../../interfaces/extended-gluegun-toolbox';
import { ServerProps } from '../../interfaces/ServerProps.interface';

/**
 * Create a new server module
 */
const NewCommand: GluegunCommand = {
  name: 'module',
  alias: ['m'],
  description: 'Creates a new server module',
  hidden: false,
  run: async (toolbox: ExtendedGluegunToolbox) => {
    // Retrieve the tools we need
    const {
      filesystem,
      helper,
      parameters,
      patching,
      print: { error, info, spin, success },
      prompt: { ask, confirm },
      server,
      strings: { kebabCase, pascalCase, camelCase },
      system,
      template,
    } = toolbox;

    // Start timer
    const timer = system.startTimer();

    // Info
    info('Create a new server module');

    // Get name
    const name = await helper.getInput(parameters.first, {
      name: 'module name',
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
    if (!filesystem.exists(join(path, 'src'))) {
      info(``);
      error(`No src directory in "${path}".`);
      return undefined;
    }
    const moduleDir = join(path, 'src', 'server', 'modules', nameKebab);
    if (filesystem.exists(moduleDir)) {
      info(``);
      error(`Module directory "${moduleDir}" already exists.`);
      return undefined;
    }

    // Set props
    const props: Record<string, ServerProps> = {};
    const setProps = true;
    let refsSet = false;
    let schemaSet = false;
    while (setProps) {
      const name = (
        await ask({
          type: 'input',
          name: 'input',
          message: `Enter property name (e.g. myProperty) to create new property or leave empty (ENTER)`,
        })
      ).input;
      if (!name.trim()) {
        break;
      }

      let type = (
        await ask([
          {
            type: 'select',
            name: 'input',
            message: 'Choose property type',
            choices: ['boolean', 'string', 'number', 'ObjectId / Reference', 'Date', 'enum', 'Subobject', 'Use own', 'JSON / any'],
          },
        ])
      ).input;
      if (type === 'ObjectId / Reference') {
        type = 'ObjectId';
      } else if (type === 'JSON / any') {
        type = 'JSON';
      }

      let schema: string;
      if (type === 'Subobject') {
        type = (
          await ask({
            type: 'input',
            name: 'input',
            initial: pascalCase(name),
            message: `Enter property type (e.g. MyClass)`,
          })
        ).input;
        schema = type;
        schemaSet = true;
      }

      let reference: string;
      let enumRef: string;
      if (type === 'ObjectId') {
        reference = (
          await ask({
            type: 'input',
            name: 'input',
            initial: pascalCase(name),
            message: `Enter reference for ObjectId`,
          })
        ).input;
        if (reference) {
          refsSet = true;
        }
      } else if (type === 'enum') {
        enumRef = (
          await ask({
            type: 'input',
            name: 'input',
            initial: pascalCase(name) + 'Enum',
            message: `Enter enum type`,
          })
        ).input;
        if (enumRef) {
          refsSet = true;
        }
      }

      const arrayEnding = type.endsWith('[]');
      type = type.replace('[]', '');
      const isArray = arrayEnding || (await confirm(`Array?`));

      const nullable = await confirm(`Nullable?`, true);

      props[name] = { name, nullable, isArray, type, reference, enumRef, schema };
    }

    const generateSpinner = spin('Generate files');
    const inputTemplate = server.propsForInput(props, { modelName: name, nullable: true });
    const createTemplate = server.propsForInput(props, { modelName: name, nullable: false, create: true });
    const modelTemplate = server.propsForModel(props, { modelName: name });

    // nest-server-module/inputs/xxx.input.ts
    await template.generate({
      template: 'nest-server-module/inputs/template.input.ts.ejs',
      target: join(moduleDir, 'inputs', nameKebab + '.input.ts'),
      props: { nameCamel, nameKebab, namePascal, props: inputTemplate.props, imports: inputTemplate.imports },
    });

    // nest-server-module/inputs/xxx-create.input.ts
    await template.generate({
      template: 'nest-server-module/inputs/template-create.input.ts.ejs',
      target: join(moduleDir, 'inputs', nameKebab + '-create.input.ts'),
      props: { nameCamel, nameKebab, namePascal, props: createTemplate.props, imports: createTemplate.imports },
    });

    // nest-server-module/output/find-and-count-xxxs-result.output.ts
    await template.generate({
      template: 'nest-server-module/outputs/template-fac-result.output.ts.ejs',
      target: join(moduleDir, 'outputs', 'find-and-count-' + nameKebab + 's-result.output.ts'),
      props: { nameCamel, nameKebab, namePascal },
    });

    // nest-server-module/xxx.model.ts
    await template.generate({
      template: 'nest-server-module/template.model.ts.ejs',
      target: join(moduleDir, nameKebab + '.model.ts'),
      props: {
        nameCamel,
        nameKebab,
        namePascal,
        props: modelTemplate.props,
        imports: modelTemplate.imports,
        mappings: modelTemplate.mappings,
      },
    });

    // nest-server-module/xxx.module.ts
    await template.generate({
      template: 'nest-server-module/template.module.ts.ejs',
      target: join(moduleDir, nameKebab + '.module.ts'),
      props: { nameCamel, nameKebab, namePascal },
    });

    // nest-server-module/xxx.resolver.ts
    await template.generate({
      template: 'nest-server-module/template.resolver.ts.ejs',
      target: join(moduleDir, nameKebab + '.resolver.ts'),
      props: { nameCamel, nameKebab, namePascal },
    });

    // nest-server-module/xxx.service.ts
    await template.generate({
      template: 'nest-server-module/template.service.ts.ejs',
      target: join(moduleDir, nameKebab + '.service.ts'),
      props: { nameCamel, nameKebab, namePascal },
    });

    generateSpinner.succeed('Files generated');

    const serverModule = join(path, 'src', 'server', 'server.module.ts');
    if (filesystem.exists(serverModule)) {
      const includeSpinner = spin('Include module into server');

      // Import module
      await patching.patch(serverModule, {
        insert: `import { ${namePascal}Module } from './modules/${nameKebab}/${nameKebab}.module';\n`,
        before: 'import',
      });

      // Add Module
      await patching.patch(serverModule, {
        insert: `  ${namePascal}Module,\n  `,
        after: new RegExp('imports:[^\\]]*', 'm'),
      });

      // Add comma if necessary
      await patching.patch(serverModule, {
        insert: '$1,$2',
        replace: new RegExp('([^,\\s])(\\s*' + namePascal + 'Module,\\s*\\])'),
      });

      includeSpinner.succeed('Module included');
    } else {
      info("Don't forget to include the module into your main module.");
    }

    // Linting
    // if (await confirm('Run lint?', false)) {
    //   await system.run('npm run lint');
    // }

    // We're done, so show what to do next
    info(``);
    success(`Generated ${namePascal}Module in ${helper.msToMinutesAndSeconds(timer())}m.`);
    info(``);

    // We're done, so show what to do next
    if (refsSet || schemaSet) {
      success(`HINT: References / Schemata have been added, so it is necessary to add the corresponding imports!`);
    }

    if (!toolbox.parameters.options.fromGluegunMenu) {
      process.exit();
    }

    // For tests
    return `new module ${name}`;
  },
};

export default NewCommand;
