import { GluegunCommand, patching } from 'gluegun';
import { join } from 'path';

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
      prompt: { ask },
      server,
    } = toolbox;

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

    const elementClass = objectOrModule === 'Module'
      ? join(path, 'src', 'server', 'modules', elementToEdit, `${elementToEdit}.model.ts`)
      : join(path, 'src', 'server', 'common', 'objects', elementToEdit, `${elementToEdit}.object.ts`);
    const elementInput = objectOrModule === 'Module'
      ? join(path, 'src', 'server', 'modules', elementToEdit, 'inputs', `${elementToEdit}.input.ts`)
      : join(path, 'src', 'server', 'common', 'objects', elementToEdit, `${elementToEdit}.input.ts`);
    const elementCreateInput = objectOrModule === 'Module'
      ? join(path, 'src', 'server', 'modules', elementToEdit, 'inputs', `${elementToEdit}-create.input.ts`)
      : join(path, 'src', 'server', 'common', 'objects', elementToEdit, `${elementToEdit}-create.input.ts`);

    for (const prop in props) {

      const propObj = props[prop];

      if (await patching.exists(elementClass, `${propObj.name}`)) {
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


      // Patch the Model
      await patching.patch(elementClass, {
        after: new RegExp('@Field[\\s\\S]*?undefined;(?![\\s\\S]*@Field)', 'g'),
        insert: server.constructModelPatchString(propObj, elementToEdit),
      });

      // Patch the normal input.ts
      await patching.patch(elementInput, {
        after: new RegExp('@Field[\\s\\S]*?undefined;(?![\\s\\S]*@Field)', 'g'),
        insert: server.constructInputPatchString(propObj, elementToEdit),
      });

      // Patch the create.input.ts
      await patching.patch(elementCreateInput, {
        after: new RegExp('@Field[\\s\\S]*?undefined;(?![\\s\\S]*@Field)', 'g'),
        insert: server.constructCreateInputPatchString(propObj, elementToEdit),
      });
    }

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
