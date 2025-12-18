import { GluegunCommand } from 'gluegun';

import { ExtendedGluegunToolbox } from '../../interfaces/extended-gluegun-toolbox';
import { copyFile, FileInfo, getFileInfo } from '../../lib/nuxt-base-components';

const AddComponentCommand: GluegunCommand = {
  description: 'Add Nuxt component',
  name: 'add',
  run: async (toolbox: ExtendedGluegunToolbox) => {
    const { config, parameters } = toolbox;

    // Load configuration
    const ltConfig = config.loadConfig();

    // Determine noConfirm with priority: CLI > config > global > default (false)
    const noConfirm = config.getNoConfirm({
      cliValue: parameters.options.noConfirm,
      commandConfig: ltConfig?.commands?.components?.add,
      config: ltConfig,
    });

    const componentName = parameters.first;
    await addComponent(toolbox, componentName, noConfirm);

    if (!parameters.options.fromGluegunMenu) {
      process.exit();
    }
    return `added component ${componentName || 'selected'}`;
  },
};

async function addComponent(toolbox: ExtendedGluegunToolbox, componentName: string | undefined, noConfirm = false) {
  const { print, prompt } = toolbox;

  try {
    const compSpinner = print.spin('Load component selection from GitHub...');
    const possibleComponents = await getFileInfo('components');
    compSpinner.succeed('Components selection successfully loaded from GitHub');

    if (possibleComponents.length > 0) {
      let selectedComponent: string = '';

      if (!componentName) {
        const response = await prompt.ask({
          choices: possibleComponents,
          message: 'Which component would you like to add?',
          name: 'componentType',
          type: 'select',
        });
        selectedComponent = response.componentType;
      } else {
        const foundComponent = possibleComponents.find(
          e => e.name.toLowerCase() === `${componentName.toLowerCase()}.vue` || e.name.toLowerCase() === componentName.toLowerCase(),
        );
        selectedComponent = foundComponent?.name || componentName;
      }

      const selectedFile = possibleComponents.find(e => e.name.toLowerCase() === selectedComponent.toLowerCase());
      if (selectedFile?.type === 'dir') {
        print.success(`The directory ${selectedFile.name} has been selected.`);
        const directoryFiles = await getFileInfo('components', selectedFile.name);

        if (directoryFiles.length > 0) {
          for (const file of directoryFiles) {
            await copyFile(
              { name: `${selectedFile.name}/${file.name}`, type: 'dir' } as FileInfo,
              toolbox,
              'components',
              noConfirm,
            );
          }
          print.success(`All files from the directory ${selectedFile.name} have been successfully copied.`);
        } else {
          print.error(`The directory ${selectedFile.name} is empty.`);
        }
      } else if (selectedFile?.type === 'file') {
        print.success(`The component ${selectedFile.name} was selected.`);
        await copyFile(selectedFile, toolbox, 'components', noConfirm);
      }
    } else {
      print.error('No components found on GitHub.');
    }
  } catch (error) {
    print.error(`Error when adding/selecting the component: ${error.message}`);
  }
}

export default AddComponentCommand;
