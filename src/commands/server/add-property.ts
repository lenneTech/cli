import { join } from 'path';
import {
  ClassPropertyTypes,
  IndentationText,
  OptionalKind,
  Project,
  PropertyDeclarationStructure,
  SyntaxKind,
} from 'ts-morph';

import { ExtendedGluegunCommand } from '../../interfaces/extended-gluegun-command';
import { ExtendedGluegunToolbox } from '../../interfaces/extended-gluegun-toolbox';
import genModule from './module';
import genObject from './object';

/**
 * Add property to module or object
 */
const NewCommand: ExtendedGluegunCommand = {
  alias: ['ap'],
  description: 'Add property to module/object',
  hidden: false,
  name: 'addProp',
  run: async (
    toolbox: ExtendedGluegunToolbox,
    options?: {
      preventExitProcess?: boolean;
    },
  ) => {
    // Options:
    const { preventExitProcess } = {
      preventExitProcess: false,
      ...options,
    };

    // Retrieve the tools we need
    const {
      config,
      filesystem,
      parameters,
      print: { divider, error, info, spin, success },
      prompt: { ask, confirm },
      server,
      strings: { pascalCase },
      system,
    } = toolbox;

    const argProps = Object.keys(toolbox.parameters.options || {}).filter((key: string) => key.startsWith('prop'));

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

    // Load configuration
    const ltConfig = config.loadConfig();

    // Parse CLI arguments
    const { element: cliElement, skipLint: cliSkipLint, type: cliType } = parameters.options;

    const objectOrModule =
      cliType ||
      (
        await ask([
          {
            choices: ['Module', 'Object'],
            message: 'What should be updated',
            name: 'input',
            type: 'select',
          },
        ])
      ).input;

    const elementToEdit =
      cliElement ||
      (
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
      return;
    }

    const { objectsToAdd, props, referencesToAdd, refsSet, schemaSet } = await toolbox.parseProperties({
      argProps,
      objectsToAdd: [],
      parameters: toolbox.parameters,
      referencesToAdd: [],
      server: toolbox.server,
    });

    const updateSpinner = spin('Updating files...');

    const project = new Project();

    // Prepare model file
    const modelPath =
      objectOrModule === 'Module'
        ? join(path, 'src', 'server', 'modules', elementToEdit, `${elementToEdit}.model.ts`)
        : join(path, 'src', 'server', 'common', 'objects', elementToEdit, `${elementToEdit}.object.ts`);
    const moduleFile = project.addSourceFileAtPath(modelPath);
    const modelDeclaration = moduleFile.getClasses()[0];
    const modelProperties = modelDeclaration
      .getMembers()
      .filter((m) => m.getKind() === SyntaxKind.PropertyDeclaration) as ClassPropertyTypes[];

    // Prepare input file
    const inputPath =
      objectOrModule === 'Module'
        ? join(path, 'src', 'server', 'modules', elementToEdit, 'inputs', `${elementToEdit}.input.ts`)
        : join(path, 'src', 'server', 'common', 'objects', elementToEdit, `${elementToEdit}.input.ts`);
    const inputFile = project.addSourceFileAtPath(inputPath);
    const inputDeclaration = inputFile.getClasses()[0];
    const inputProperties = inputDeclaration
      .getMembers()
      .filter((m) => m.getKind() === SyntaxKind.PropertyDeclaration) as ClassPropertyTypes[];

    // Prepare create input file
    const creatInputPath =
      objectOrModule === 'Module'
        ? join(path, 'src', 'server', 'modules', elementToEdit, 'inputs', `${elementToEdit}-create.input.ts`)
        : join(path, 'src', 'server', 'common', 'objects', elementToEdit, `${elementToEdit}-create.input.ts`);
    const createInputFile = project.addSourceFileAtPath(creatInputPath);
    const createInputDeclaration = createInputFile.getClasses()[0];
    const createInputProperties = createInputDeclaration
      .getMembers()
      .filter((m) => m.getKind() === SyntaxKind.PropertyDeclaration);

    // Add props
    for (const prop of Object.keys(props).reverse()) {
      const propObj = props[prop];

      if (modelProperties.some((p) => p.getName() === propObj.name)) {
        info('');
        info(`Property ${propObj.name} already exists`);

        // Remove the reference for this property from the list
        const refIndex = referencesToAdd.findIndex((item) => item.property === propObj.name);
        if (refIndex !== -1) {
          referencesToAdd.splice(refIndex, 1);
        }

        // Remove the object for this property from the list
        const objIndex = objectsToAdd.findIndex((item) => item.property === propObj.name);
        if (objIndex !== -1) {
          objectsToAdd.splice(objIndex, 1);
        }

        // Go on
        continue;
      }

      const description = `'${pascalCase(propObj.name)} of ${pascalCase(elementToEdit)}'`;

      // Use utility function to determine TypeScript type for Model
      const tsType = server.getModelClassType(propObj);

      // Build @UnifiedField options; types vary and can't go in standardDeclaration
      function constructUnifiedFieldOptions(type: 'create' | 'input' | 'model'): string {
        // Use utility functions from server helper
        const enumConfig = server.getEnumConfig(propObj);

        // Determine field type based on context
        let fieldType: string;
        if (type === 'model') {
          fieldType = server.getModelFieldType(propObj);
        } else {
          // Input or CreateInput
          fieldType = server.getInputFieldType(propObj, { create: type === 'create' });
        }

        // Use utility function for type config
        const typeConfig = server.getTypeConfig(fieldType, propObj.isArray);

        // Build mongoose configuration for model type
        let mongooseConfig = '';
        if (type === 'model') {
          if (propObj.type === 'ObjectId' && propObj.reference) {
            mongooseConfig = `mongoose: ${propObj.isArray ? '[' : ''}{ ref: '${propObj.reference}', type: Schema.Types.ObjectId }${propObj.isArray ? ']' : ''},\n`;
          } else if (propObj.schema) {
            mongooseConfig = `mongoose: ${propObj.isArray ? '[' : ''}{ type: ${propObj.schema}Schema }${propObj.isArray ? ']' : ''},\n`;
          } else if (propObj.enumRef) {
            mongooseConfig = `mongoose: ${propObj.isArray ? '[' : ''}{ enum: ${propObj.nullable ? `Object.values(${propObj.enumRef}).concat([null])` : propObj.enumRef}, type: String }${propObj.isArray ? ']' : ''},\n`;
          } else if (propObj.type === 'Json') {
            mongooseConfig = `mongoose: ${propObj.isArray ? '[' : ''}{ type: Object }${propObj.isArray ? ']' : ''},\n`;
          } else {
            mongooseConfig = 'mongoose: true,\n';
          }
        }

        switch (type) {
          case 'create':
            return `{
              description: ${description},${propObj.nullable ? '\nisOptional: true,' : '\nisOptional: false,'}
              roles: RoleEnum.S_EVERYONE,
              ${enumConfig}${typeConfig}
              }`;
          case 'input':
            return `{
              description: ${description},
              isOptional: true,
              roles: RoleEnum.S_EVERYONE,
              ${enumConfig}${typeConfig}
              }`;
          case 'model':
            return `{
              description: ${description},${propObj.nullable ? '\nisOptional: true,' : '\nisOptional: false,'}
              ${mongooseConfig}roles: RoleEnum.S_EVERYONE,
              ${enumConfig}${typeConfig}
              }`;
        }
      }

      // Only use = undefined when useDefineForClassFieldsActivated is false or override keyword is set
      const useDefineForClassFields = server.useDefineForClassFieldsActivated();
      const standardDeclaration: OptionalKind<PropertyDeclarationStructure> = {
        decorators: [],
        hasQuestionToken: propObj.nullable,
        initializer: useDefineForClassFields ? undefined : 'undefined',
        name: propObj.name,
      };

      // Patch model
      const newModelProperty: OptionalKind<PropertyDeclarationStructure> = structuredClone(standardDeclaration);

      newModelProperty.decorators.push({ arguments: [constructUnifiedFieldOptions('model')], name: 'UnifiedField' });
      newModelProperty.type = `${tsType}${propObj.isArray ? '[]' : ''}`;

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

      // Use utility function to determine TypeScript type for Input
      const inputTsType = server.getInputClassType(propObj, { create: false });
      newInputProperty.type = `${inputTsType}${propObj.isArray ? '[]' : ''}`;

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
      // Use override (not declare) when useDefineForClassFieldsActivated is true
      if (useDefineForClassFields) {
        newCreateInputProperty.hasOverrideKeyword = true;
        newCreateInputProperty.initializer = 'undefined'; // Override requires = undefined
      }
      newCreateInputProperty.decorators.push({
        arguments: [constructUnifiedFieldOptions('create')],
        name: 'UnifiedField',
      });

      // Use utility function to determine TypeScript type for CreateInput
      const createTsType = server.getInputClassType(propObj, { create: true });
      newCreateInputProperty.type = `${createTsType}${propObj.isArray ? '[]' : ''}`;

      let insertedCreateInputProp;
      if (createInputProperties.length > 0) {
        const lastCreateInputProperty = createInputProperties[createInputProperties.length - 1];
        insertedCreateInputProp = createInputDeclaration.insertProperty(
          lastCreateInputProperty.getChildIndex() + 1,
          newCreateInputProperty,
        );
      } else {
        insertedCreateInputProp = createInputDeclaration.addProperty(newCreateInputProperty);
      }
      insertedCreateInputProp.prependWhitespace('\n');
      insertedCreateInputProp.appendWhitespace('\n');
    }

    project.manipulationSettings.set({
      indentationText: IndentationText.TwoSpaces,
    });

    // Update map method with mapClasses for non-native properties
    const standardTypes = ['boolean', 'string', 'number', 'Date'];
    const mapMethod = modelDeclaration.getMethod('map');
    if (mapMethod) {
      // Collect all properties that need mapClasses (non-native types)
      const allModelProps = modelDeclaration
        .getMembers()
        .filter((m) => m.getKind() === SyntaxKind.PropertyDeclaration) as ClassPropertyTypes[];
      const mappings = {};

      for (const prop of allModelProps) {
        const propName = prop.getName();
        const propType = prop.getType().getText();

        // Skip if it's a standard type
        if (standardTypes.some((t) => propType.includes(t))) {
          continue;
        }

        // Skip ObjectId, enum, and JSON types
        if (
          propType.includes('string') ||
          propType.includes('ObjectId') ||
          propType.includes('Record<string, unknown>')
        ) {
          continue;
        }

        // Check if this property was in our newly added props and should be mapped
        const newProp = props[propName];
        if (newProp) {
          const type = newProp.type;
          const reference = newProp.reference?.trim() ? pascalCase(newProp.reference.trim()) : '';
          const schema = newProp.schema?.trim() ? pascalCase(newProp.schema.trim()) : '';

          if (reference) {
            mappings[propName] = reference;
          } else if (schema) {
            mappings[propName] = schema;
          } else if (!standardTypes.includes(type) && type !== 'ObjectId' && type !== 'Json') {
            mappings[propName] = pascalCase(type);
          }
        }
      }

      // Update the map method's return statement
      const returnStatement = mapMethod.getStatements().find((s) => s.getKind() === SyntaxKind.ReturnStatement);
      if (returnStatement && Object.keys(mappings).length > 0) {
        const currentReturn = returnStatement.getText();

        // Check if already using mapClasses
        if (currentReturn.includes('mapClasses')) {
          // Parse existing mapClasses call to merge with new mappings
          const match = currentReturn.match(/mapClasses\(input,\s*\{([^}]*)\}/);
          if (match) {
            const existingMappings = match[1].trim();
            const existingPairs = existingMappings ? existingMappings.split(',').map((p) => p.trim()) : [];

            // Merge with new mappings
            const allMappings = {};
            for (const pair of existingPairs) {
              const [key, value] = pair.split(':').map((s) => s.trim());
              if (key && value) {
                allMappings[key] = value;
              }
            }

            // Add new mappings
            for (const [key, value] of Object.entries(mappings)) {
              allMappings[key] = value;
            }

            // Generate new mapClasses call
            const mappingPairs = Object.entries(allMappings).map(([k, v]) => `${k}: ${v}`);
            returnStatement.replaceWithText(`return mapClasses(input, { ${mappingPairs.join(', ')} }, this);`);
          }
        } else if (currentReturn.includes('return this')) {
          // Replace "return this" with mapClasses call
          const mappingPairs = Object.entries(mappings).map(([k, v]) => `${k}: ${v}`);
          returnStatement.replaceWithText(`return mapClasses(input, { ${mappingPairs.join(', ')} }, this);`);
        }

        // Ensure mapClasses is imported
        const existingImports = moduleFile.getImportDeclaration('@lenne.tech/nest-server');
        if (existingImports) {
          const namedImports = existingImports.getNamedImports();
          const hasMapClasses = namedImports.some((ni) => ni.getName() === 'mapClasses');
          if (!hasMapClasses) {
            existingImports.addNamedImport('mapClasses');
          }
        }
      }
    }

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

    // Lint fix with priority: CLI > config > global > default (false)
    const skipLint = config.getSkipLint({
      cliValue: cliSkipLint,
      commandConfig: ltConfig?.commands?.server?.addProp,
      config: ltConfig,
    });

    if (!skipLint) {
      if (await confirm('Run lint fix?', true)) {
        await system.run(toolbox.pm.run('lint:fix'));
      }
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

    return `properties updated for ${elementToEdit}`;
  },
};

export default NewCommand;
