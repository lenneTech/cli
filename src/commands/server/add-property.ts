import { GluegunCommand, patching } from 'gluegun';
import { join } from 'path';
import { ExtendedGluegunToolbox } from '../../interfaces/extended-gluegun-toolbox';
import genModule from './module';

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
      prompt: { ask },
      server,
    } = toolbox;
    
    const refArray: string[] = [];
    
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
    
    const { props, refsSet, schemaSet } = await server.addProperties({ refArray });
    
    const updateSpinner = spin('Updating files...');
    // const inputTemplate = server.propsForInput(props, { modelName: name, nullable: true });
    // const createTemplate = server.propsForInput(props, { modelName: name, nullable: false, create: true });
    // const modelTemplate = server.propsForModel(props, { modelName: name });
    
    const moduleModel = join(path, 'src', 'server', 'modules', moduleToEdit, `${moduleToEdit}.model.ts`);
    const moduleInput = join(path, 'src', 'server', 'modules', moduleToEdit, 'inputs', `${moduleToEdit}.input.ts`);
    const moduleCreateInput = join(path, 'src', 'server', 'modules', moduleToEdit, 'inputs', `${moduleToEdit}-create.input.ts`);
    
    for (const prop in props) {
      
      const propObj = props[prop];
      
      if (await patching.exists(moduleModel, `${propObj.name}`)) {
        info('');
        info(`Property ${propObj.name} already exists`);
        continue;
      }


      // Patch the Model
      await patching.patch(moduleModel, {
        insert: server.constructModelPatchString(propObj, moduleToEdit),
        after: new RegExp('@Field[\\s\\S]*?undefined;(?![\\s\\S]*@Field)', 'g')
      });

      // Patch the normal input.ts
      await patching.patch(moduleInput, {
        insert: server.constructInputPatchString(propObj, moduleToEdit),
        after: new RegExp('@Field[\\s\\S]*?undefined;(?![\\s\\S]*@Field)', 'g')
      });

      // Patch the create.input.ts
      await patching.patch(moduleCreateInput, {
        insert: server.constructCreateInputPatchString(propObj, moduleToEdit),
        after: new RegExp('@Field[\\s\\S]*?undefined;(?![\\s\\S]*@Field)', 'g')
      });
      
      
    }
    
    updateSpinner.succeed('All files updated successfully.');
    
    if (refArray.length > 0) {
      divider();
      const nextRef = refArray.shift();
      return genModule.run(toolbox, refArray, nextRef);
    }
    
    if (refsSet || schemaSet) {
      success(`HINT: References / Schemata have been added, so it is necessary to add the corresponding imports!`);
    }
    
    if (!toolbox.parameters.options.fromGluegunMenu) {
      process.exit();
    }
    
    return `properties updated for ${name}`;
    
  },
};

export default NewCommand;
