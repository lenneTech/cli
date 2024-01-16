import { GluegunCommand } from 'gluegun';
import { join } from 'path';
import { ExtendedGluegunToolbox } from '../../interfaces/extended-gluegun-toolbox';
import { ServerProps } from '../../interfaces/ServerProps.interface';

/**
 * Create a new server module
 */
const NewCommand: GluegunCommand = {
  name: 'object',
  alias: ['o'],
  description: 'Creates a new server object (with inputs)',
  hidden: false,
  run: async (toolbox: ExtendedGluegunToolbox) => {
    // Retrieve the tools we need
    const {
      filesystem,
      helper,
      parameters,
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
    info('Create a new server object (with inputs)');

    // Get name
    const name = await helper.getInput(parameters.first, {
      name: 'object name',
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
    const objectDir = join(path, 'src', 'server', 'common', 'objects', nameKebab);
    if (filesystem.exists(objectDir)) {
      info(``);
      error(`Module directory "${objectDir}" already exists.`);
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
            choices: ['boolean', 'string', 'number', 'ObjectId / Reference', 'Date', 'enum', 'Use own', 'JSON / any'],
          },
        ])
      ).input;
      if (type === 'ObjectId / Reference') {
        type = 'ObjectId';
      } else if (type === 'JSON / any') {
        type = 'JSON';
      }

      let schema: string;
      if (type === 'Subobject')
      {
        type = (
          await ask({
            type: 'input',
            name: 'input',
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
    const objectTemplate = server.propsForModel(props, { modelName: name });

    // nest-server-module/inputs/xxx.input.ts
    await template.generate({
      template: 'nest-server-object/template.input.ts.ejs',
      target: join(objectDir, nameKebab + '.input.ts'),
      props: { nameCamel, nameKebab, namePascal, props: inputTemplate.props, imports: inputTemplate.imports },
    });

    // nest-server-object/inputs/xxx-create.input.ts
    await template.generate({
      template: 'nest-server-object/template-create.input.ts.ejs',
      target: join(objectDir, nameKebab + '-create.input.ts'),
      props: { nameCamel, nameKebab, namePascal, props: createTemplate.props, imports: createTemplate.imports },
    });

    // nest-server-module/xxx.model.ts
    await template.generate({
      template: 'nest-server-object/template.object.ts.ejs',
      target: join(objectDir, nameKebab + '.object.ts'),
      props: {
        nameCamel,
        nameKebab,
        namePascal,
        props: objectTemplate.props,
        imports: objectTemplate.imports,
        mappings: objectTemplate.mappings,
      },
    });

    generateSpinner.succeed('Files generated');

    // Linting
    // if (await confirm('Run lint?', true)) {
    //   await system.run('npm run lint');
    // }

    // We're done, so show what to do next
    info(``);
    success(`Generated ${namePascal}Object in ${helper.msToMinutesAndSeconds(timer())}m.`);
    info(``);

    // We're done, so show what to do next
    if (refsSet || schemaSet) {
      success(`HINT: References / Schemata have been added, so it is necessary to add the corresponding imports!`);
    }

    if (!toolbox.parameters.options.fromGluegunMenu) {
      process.exit();
    }

    // For tests
    return `new object ${name}`;
  },
};

export default NewCommand;
