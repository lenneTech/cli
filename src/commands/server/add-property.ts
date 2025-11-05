import { GluegunCommand } from 'gluegun';
import { join } from 'path';
import {
  ClassPropertyTypes, IndentationText,
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
  description: 'Adds a property to a module. Use --type (Module|Object), --element <name>, --prop-name-X <name>, --prop-type-X <type>, --prop-nullable-X (true|false), --prop-array-X (true|false), --prop-enum-X <EnumName>, --prop-schema-X <SchemaName>, --prop-reference-X <ReferenceName> for non-interactive mode.',
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


    // const notInteractivce = toolbox.parameters.options.ni;
const argProps = Object.keys(toolbox.parameters.options || {}).filter((key: string) => key.startsWith('prop'));


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

    // Parse CLI arguments
    const { element: cliElement, type: cliType } = toolbox.parameters.options;

    const objectOrModule = cliType || (
      await ask([
        {
          choices: ['Module', 'Object'],
          message: 'What should be updated',
          name: 'input',
          type: 'select',
        },
      ])
    ).input;

    const elementToEdit = cliElement || (
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

    const { objectsToAdd, props, referencesToAdd, refsSet, schemaSet }
      = await toolbox.parseProperties({
        argProps,
        objectsToAdd: [],
        parameters: toolbox.parameters,
        referencesToAdd: [],
        server: toolbox.server,
      });

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

      const description = `'${pascalCase(propObj.name)} of ${pascalCase(elementToEdit)}'`;

      const typeString = () => {
        switch (true) {
          case type === 'Json':
            return 'JSON';

          case !!propObj.enumRef:
            return propObj.enumRef;

          case !!propObj.schema:
            return propObj.schema;

          case propObj.type === 'ObjectId':
            return propObj.reference;

          default:
            return pascalCase(type);
        }
      };

      // Build @UnifiedField options; types vary and can't go in standardDeclaration
      function constructUnifiedFieldOptions(type: 'create' | 'input' | 'model'): string {
        switch (type) {
          case 'create':
            return `{
              description: ${description},${propObj.nullable ? '\nisOptional: true,' : ''}
              roles: RoleEnum.ADMIN,${propObj.enumRef ? '' : `\ntype: () => ${typeString()}${propObj.type === 'ObjectId' || propObj.schema ? 'CreateInput' : ''}`}
              }`;
          case 'input':
            return `{
              description: ${description},
              isOptional: true,
              roles: RoleEnum.ADMIN,
              ${propObj.enumRef ? `enum: { enum: ${propObj.enumRef} }` : `type: () => ${typeString()}${propObj.type === 'ObjectId' || propObj.schema ? 'Input' : ''}`}
              }`;
          case 'model':
            return `{
              description: ${description},${propObj.nullable ? '\nisOptional: true,' : ''}
              roles: RoleEnum.ADMIN,${propObj.enumRef ? '' : `\ntype: () => ${typeString()}`}
              }`;
        }
      }

      const standardDeclaration: OptionalKind<PropertyDeclarationStructure> = {
        decorators: [],
        hasQuestionToken: propObj.nullable,
        initializer: declare ? undefined : 'undefined',
        name: propObj.name,
      };

      // Patch model
      const newModelProperty: OptionalKind<PropertyDeclarationStructure> = structuredClone(standardDeclaration);
      newModelProperty.decorators.push({ arguments: [`${propObj.type === 'ObjectId' || propObj.schema ? `{ ref: () => ${propObj.reference}, type: Schema.Types.ObjectId }` : ''}`], name: 'Prop' });
      newModelProperty.decorators.push({ arguments: [constructUnifiedFieldOptions('model')], name: 'UnifiedField' });
      newModelProperty.type = `${typeString()}${propObj.isArray ? '[]' : ''}`;

      let insertedModelProp;
      if (modelProperties.length > 0) {
        const lastModelProperty = modelProperties[modelProperties.length - 1];
        insertedModelProp = modelDeclaration.insertProperty(lastModelProperty.getChildIndex() + 1, newModelProperty);
      } else {
        insertedModelProp = modelDeclaration.addProperty(newModelProperty);
      }
      insertedModelProp.prependWhitespace('\n');
      insertedModelProp.appendWhitespace('\n');

      // Patch input
      const newInputProperty: OptionalKind<PropertyDeclarationStructure> = structuredClone(standardDeclaration);
      newInputProperty.decorators.push({ arguments: [constructUnifiedFieldOptions('input')], name: 'UnifiedField' });
      const inputSuffix = propObj.type === 'ObjectId' || propObj.schema ? 'Input' : '';
      newInputProperty.type = `${typeString()}${inputSuffix}${propObj.isArray ? '[]' : ''}`;

      let insertedInputProp;
      if (inputProperties.length > 0) {
        const lastInputProperty = inputProperties[inputProperties.length - 1];
        insertedInputProp = inputDeclaration.insertProperty(lastInputProperty.getChildIndex() + 1, newInputProperty);
      } else {
        insertedInputProp = inputDeclaration.addProperty(newInputProperty);
      }
      insertedInputProp.prependWhitespace('\n');
      insertedInputProp.appendWhitespace('\n');

      // Patch create input
      const newCreateInputProperty: OptionalKind<PropertyDeclarationStructure> = structuredClone(standardDeclaration);
      if (declare) {
        newCreateInputProperty.hasDeclareKeyword = true;
      } else {
        newCreateInputProperty.hasOverrideKeyword = true;
      }
      newCreateInputProperty.decorators.push({ arguments: [constructUnifiedFieldOptions('create')], name: 'UnifiedField' });
      const createSuffix = propObj.type === 'ObjectId' || propObj.schema ? 'CreateInput' : '';
      newCreateInputProperty.type = `${typeString()}${createSuffix}${propObj.isArray ? '[]' : ''}`;

      let insertedCreateInputProp;
      if (createInputProperties.length > 0) {
        const lastCreateInputProperty = createInputProperties[createInputProperties.length - 1];
        insertedCreateInputProp = createInputDeclaration.insertProperty(lastCreateInputProperty.getChildIndex() + 1, newCreateInputProperty);
      } else {
        insertedCreateInputProp = createInputDeclaration.addProperty(newCreateInputProperty);
      }
      insertedCreateInputProp.prependWhitespace('\n');
      insertedCreateInputProp.appendWhitespace('\n');
    }

    project.manipulationSettings.set({
      indentationText: IndentationText.TwoSpaces,
    });

    // Format files
    moduleFile.formatText();
    inputFile.formatText();
    createInputFile.formatText();

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
