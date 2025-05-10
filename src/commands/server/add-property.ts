import { GluegunCommand } from 'gluegun';
import { join } from 'path';
import {
  ClassPropertyTypes,
  OptionalKind,
  Project,
  PropertyDeclarationStructure,
  SyntaxKind,
} from 'ts-morph';

import { ExtendedGluegunToolbox } from '../../interfaces/extended-gluegun-toolbox';
import genModule from './module';
import genObject from './object';

/**
 * Create a new server module
 */
const NewCommand: GluegunCommand = {
  alias: ['ap'],
  description: 'Adds a property to a module',
  hidden: false,
  name: 'addProp',
  run: async (toolbox: ExtendedGluegunToolbox) => {
    // Retrieve the tools we need
    const {
      filesystem,
      print: { divider, error, info, spin, success },
      prompt: { ask, confirm },
      server,
      strings: { pascalCase },
      system,
    } = toolbox;

    const declare = server.useDefineForClassFieldsActivated();

    function getModules() {
      const cwd = filesystem.cwd();
      const path = cwd.substr(0, cwd.lastIndexOf('src'));
      const moduleDirs = join(path, 'src', 'server', 'modules');

      return filesystem.subdirectories(moduleDirs, true);
    }

    function getObjects() {
      const cwd = filesystem.cwd();
      const path = cwd.substr(0, cwd.lastIndexOf('src'));
      const objectDirs = join(path, 'src', 'server', 'common', 'objects');

      return filesystem.subdirectories(objectDirs, true);
    }

    const objectOrModule = (
      await ask([
        {
          choices: ['Module', 'Object'],
          message: 'What should be updated',
          name: 'input',
          type: 'select',
        },
      ])
    ).input;


    const elementToEdit = (
      await ask([
        {
          choices: objectOrModule === 'Module' ? getModules() : getObjects(),
          message: 'Choose one to update',
          name: 'input',
          type: 'select',
        },
      ])
    ).input;


    // Check if directory
    const cwd = filesystem.cwd();
    const path = cwd.substr(0, cwd.lastIndexOf('src'));
    if (!filesystem.exists(join(path, 'src'))) {
      info('');
      error(`No src directory in "${path}".`);
      return undefined;
    }

    const { objectsToAdd, props, referencesToAdd, refsSet, schemaSet } = await server.addProperties();

    const updateSpinner = spin('Updating files...');

    const project = new Project();

    // Prepare model file
    const modelPath = objectOrModule === 'Module'
      ? join(path, 'src', 'server', 'modules', elementToEdit, `${elementToEdit}.model.ts`)
      : join(path, 'src', 'server', 'common', 'objects', elementToEdit, `${elementToEdit}.object.ts`);
    const moduleFile = project.addSourceFileAtPath(modelPath);
    const modelDeclaration = moduleFile.getClasses()[0];
    const modelProperties = modelDeclaration.getMembers().filter(m => m.getKind() === SyntaxKind.PropertyDeclaration) as ClassPropertyTypes[];

    // Prepare input file
    const inputPath = objectOrModule === 'Module'
      ? join(path, 'src', 'server', 'modules', elementToEdit, 'inputs', `${elementToEdit}.input.ts`)
      : join(path, 'src', 'server', 'common', 'objects', elementToEdit, `${elementToEdit}.input.ts`);
    const inputFile = project.addSourceFileAtPath(inputPath);
    const inputDeclaration = inputFile.getClasses()[0];
    const inputProperties = inputDeclaration.getMembers().filter(m => m.getKind() === SyntaxKind.PropertyDeclaration) as ClassPropertyTypes[];

    // Prepare create input file
    const creatInputPath = objectOrModule === 'Module'
      ? join(path, 'src', 'server', 'modules', elementToEdit, 'inputs', `${elementToEdit}-create.input.ts`)
      : join(path, 'src', 'server', 'common', 'objects', elementToEdit, `${elementToEdit}-create.input.ts`);
    const createInputFile = project.addSourceFileAtPath(creatInputPath);
    const createInputDeclaration = createInputFile.getClasses()[0];
    const createInputProperties = createInputDeclaration.getMembers().filter(m => m.getKind() === SyntaxKind.PropertyDeclaration);

    // Add props
    for (const prop of Object.keys(props).reverse()) {

      const propObj = props[prop];

      if (modelProperties.some(p => p.getName() === propObj.name)) {
        info('');
        info(`Property ${propObj.name} already exists`);

        // Remove the reference for this property from the list
        const refIndex = referencesToAdd.findIndex(item => item.property === propObj.name);
        if (refIndex !== -1) {
          referencesToAdd.splice(refIndex, 1);
        }

        // Remove the object for this property from the list
        const objIndex = objectsToAdd.findIndex(item => item.property === propObj.name);
        if (objIndex !== -1) {
          objectsToAdd.splice(objIndex, 1);
        }

        // Go on
        continue;
      }

      const type = ['any', 'bigint', 'boolean', 'never', 'null', 'number', 'string', 'symbol', 'undefined', 'unknown', 'void'].includes(propObj.type) ? propObj.type : pascalCase(propObj.type);
      const standardDeclaration: OptionalKind<PropertyDeclarationStructure> = {
        decorators: [
          { arguments: [`() => ${propObj.isArray ? `[${propObj.type
            === 'ObjectId' ? propObj.reference : pascalCase(propObj.type)}]` : propObj.type
            === 'ObjectId' ? propObj.reference : pascalCase(propObj.type)}`,
              `{ description: '${pascalCase(propObj.name)} of ${pascalCase(elementToEdit)}', nullable: ${propObj.nullable} }`],
            name: 'Field',
          },
          { arguments: ['RoleEnum.ADMIN'], name: 'Restricted' },
        ],
        hasQuestionToken: propObj.nullable,
        initializer: declare ? undefined : 'undefined',
        name: propObj.name,
        type: `${propObj.type === 'ObjectId' ? propObj.reference : type}${propObj.isArray ? '[]' : ''}`,
      };

      // Patch model
      const lastModelProperty = modelProperties[modelProperties.length - 1];
      const newModelProperty: OptionalKind<PropertyDeclarationStructure> = structuredClone(standardDeclaration);
      newModelProperty.decorators.push({ arguments: [`${propObj.type === 'ObjectId' ? `{ ref: ${propObj.reference}, type: Schema.Types.ObjectId }` : ''}`], name: 'Prop' });
      const insertedModelProp = modelDeclaration.insertProperty(lastModelProperty.getChildIndex() + 1, newModelProperty);
      insertedModelProp.prependWhitespace('\n');
      insertedModelProp.appendWhitespace('\n');

      // Patch input
      const lastInputProperty = inputProperties[inputProperties.length - 1];
      const newInputProperty: OptionalKind<PropertyDeclarationStructure> = structuredClone(standardDeclaration);
      if (propObj.nullable) {
        newInputProperty.decorators.push({ arguments: [], name: 'IsOptional' });
      }
      const insertedInputProp = inputDeclaration.insertProperty(lastInputProperty.getChildIndex() + 1, newInputProperty);
      insertedInputProp.prependWhitespace('\n');
      insertedInputProp.appendWhitespace('\n');

      // Patch create input
      const lastCreateInputProperty = createInputProperties[createInputProperties.length - 1];
      const newCreateInputProperty: OptionalKind<PropertyDeclarationStructure> = structuredClone(newInputProperty);
      if (declare) {
        newCreateInputProperty.hasDeclareKeyword = true;
      } else {
        newCreateInputProperty.hasOverrideKeyword = true;
      }
      const insertedCreateInputProp = createInputDeclaration.insertProperty(lastCreateInputProperty.getChildIndex() + 1, newCreateInputProperty);
      insertedCreateInputProp.prependWhitespace('\n');
      insertedCreateInputProp.appendWhitespace('\n');
    }

    // Save files
    await moduleFile.save();
    await inputFile.save();
    await createInputFile.save();

    updateSpinner.succeed('All files updated successfully.');

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
      await genObject.run(toolbox, { currentItem: nextObj, objectsToAdd, preventExitProcess: true, referencesToAdd });
    }

    // Lint fix
    if (await confirm('Run lint fix?', true)) {
      await system.run('npm run lint:fix');
    }

    if (refsSet || schemaSet) {
      success('HINT: References / Schemata have been added, so it is necessary to add the corresponding imports!');
    }

    if (!toolbox.parameters.options.fromGluegunMenu) {
      process.exit();
    }

    return `properties updated for ${elementToEdit}`;
  },
};

export default NewCommand;
