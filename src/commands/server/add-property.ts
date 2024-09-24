import { join } from 'path';
import { ExtendedGluegunToolbox } from '../../interfaces/extended-gluegun-toolbox';
import { GluegunCommand, patching } from 'gluegun';
import { ServerProps } from '../../interfaces/ServerProps.interface';
import genModule  from './module'

/**
 * Create a new server module
 */
const NewCommand: GluegunCommand = {
  name: 'addProp',
  alias: ['ap'],
  description: 'Adds a property to a module',
  hidden: false,
  run: async (toolbox: ExtendedGluegunToolbox) => {
    // Retrieve the tools we need
    const {
      filesystem,
      print: { error, info, success, spin, divider },
      prompt: { ask, confirm },
      strings: { pascalCase },
    } = toolbox;

    const refArray: string[] = []

    function getModules() {
      const cwd = filesystem.cwd();
      const path = cwd.substr(0, cwd.lastIndexOf('src'));
      const moduleDirs = join(path, 'src', 'server', 'modules');

      return filesystem.subdirectories(moduleDirs, true);
    }


    const moduleToEdit = (
      await ask([
        {
          type: 'select',
          name: 'input',
          message: 'Choose one of your Modules to update',
          choices: getModules(),
        },
      ])
    ).input;


    // Check if directory
    const cwd = filesystem.cwd();
    const path = cwd.substr(0, cwd.lastIndexOf('src'));
    if (!filesystem.exists(join(path, 'src'))) {
      info(``);
      error(`No src directory in "${path}".`);
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
          message: `Enter property name (e.g. myProperty) of the new property or leave empty (ENTER)`,
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
      if (type === 'Subobject') {
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
          refArray.push(reference);
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

    const updateSpinner = spin('Updating files...');
    // const inputTemplate = server.propsForInput(props, { modelName: name, nullable: true });
    // const createTemplate = server.propsForInput(props, { modelName: name, nullable: false, create: true });
    // const modelTemplate = server.propsForModel(props, { modelName: name });

    const moduleModel = join(path, 'src', 'server', 'modules', moduleToEdit, `${moduleToEdit}.model.ts`);
    const moduleInput = join(path, 'src', 'server', 'modules', moduleToEdit, 'inputs' ,`${moduleToEdit}.input.ts`);
    const moduleCreateInput = join(path, 'src', 'server', 'modules', moduleToEdit, 'inputs' ,`${moduleToEdit}-create.input.ts`);

    for (const prop in props) {

      const propObj = props[prop];

      if(await patching.exists(moduleModel, `${propObj.name}`)) {
        info('')
        info(`Property ${propObj.name} already exists`)
        continue;
      }

// Patch the model
      await patching.patch(moduleModel, {
        insert: `\n\n
  /**
   * ${pascalCase(propObj.name)} of ${pascalCase(moduleToEdit)}
   */
  @Restricted(RoleEnum.ADMIN)
  @Field(() => ${propObj.isArray ? `[${propObj.type == 'ObjectId' ? propObj.reference : pascalCase(propObj.type)}]` : propObj.type == 'ObjectId' ? propObj.reference : pascalCase(propObj.type)}, {
    description: '${pascalCase(propObj.name)} of ${pascalCase(moduleToEdit)}',
    nullable: ${propObj.nullable},
  })
  @Prop(${propObj.type == 'ObjectId' ? `{ ref: ${propObj.reference}, type: Schema.Types.ObjectId }` : ''})
  ${propObj.name}: ${propObj.isArray ? `${propObj.type == 'ObjectId' ? propObj.reference : pascalCase(propObj.type)}[]` : propObj.type == 'ObjectId' ? propObj.reference : pascalCase(propObj.type)} = undefined;`,
        // after: new RegExp('export class \\w+(?: .+)? \\{'),
        after: new RegExp('@Field[\\s\\S]*?undefined;(?![\\s\\S]*@Field)', 'g')
      });

    // Patch the input
      // Create the Field type string based on conditions
      const fieldType = propObj.isArray
        ? `[${propObj.type === 'ObjectId' ? propObj.reference : pascalCase(propObj.type)}]`
        : propObj.type === 'ObjectId'
          ? propObj.reference
          : pascalCase(propObj.type);

      const arraySuffix = propObj.isArray ? '[]' : ''



      const optionalSuffix = propObj.nullable ? '?' : '';

// Construct the property string
      const propertyString = `
/**
 * ${pascalCase(propObj.name)} of ${pascalCase(moduleToEdit)}
 */
@Restricted(RoleEnum.ADMIN)
@Field(() => ${fieldType}, {
  description: '${pascalCase(propObj.name)} of ${pascalCase(moduleToEdit)}',
  nullable: ${propObj.nullable},
})
${propObj.nullable ? '@IsOptional()' : ''}
${propObj.name}${optionalSuffix}: ${propObj.type}${arraySuffix} = undefined;
`;

// Perform the patching
      await patching.patch(moduleInput, {
        insert: propertyString,
      after: new RegExp('@Field[\\s\\S]*?undefined;(?![\\s\\S]*@Field)', 'g')
    })



      // Patch the create input
      await patching.patch(moduleCreateInput, {
        insert: ` \n\n
   /**
   * ${pascalCase(propObj.name)} of ${pascalCase(moduleToEdit)}
   */
  @Restricted(RoleEnum.ADMIN)
  @Field(() => ${propObj.isArray ? `[${propObj.type == 'ObjectId' ? propObj.reference : pascalCase(propObj.type)}]` : propObj.type == 'ObjectId' ? propObj.reference : pascalCase(propObj.type)}, {
    description: '${pascalCase(propObj.name)} of ${pascalCase(moduleToEdit)}',
    nullable: ${propObj.nullable},
  })
 ${propObj.nullable ? '@IsOptional()' : ''}${propObj.nullable ? '\n' : ''}override ${propObj.name}${propObj.nullable ? '?' : ''}: ${propObj.isArray ? `${propObj.type == 'ObjectId' ? propObj.reference : pascalCase(propObj.type)}[]` : propObj.type == 'ObjectId' ? propObj.reference : pascalCase(propObj.type)} = undefined;`,

        after: new RegExp('@Field[\\s\\S]*?undefined;(?![\\s\\S]*@Field)', 'g')
      })



    }

    updateSpinner.succeed('All files updated successfully.');

    if (refArray.length > 0) {
      divider()
      const nextRef = refArray.shift();
      return genModule.run(toolbox, refArray, nextRef);
    }

    if (refsSet || schemaSet) {
      success(`HINT: References / Schemata have been added, so it is necessary to add the corresponding imports!`);
    }

    if (!toolbox.parameters.options.fromGluegunMenu) {
      process.exit();
    }

    return `properties updated for ${name}`

  },
};

export default NewCommand;
