import { GluegunCommand } from 'gluegun';

import { ExtendedGluegunToolbox } from '../../interfaces/extended-gluegun-toolbox';
import { copyFile, FileInfo, getFileInfo } from '../../lib/nuxt-base-components';

const AddBlockCommand: GluegunCommand = {
  description: 'Add Nuxt block',
  name: 'add',
  run: async (toolbox: ExtendedGluegunToolbox) => {
    const { config, parameters } = toolbox;

    // Load configuration
    const ltConfig = config.loadConfig();

    // Determine noConfirm with priority: CLI > config > global > default (false)
    const noConfirm = config.getNoConfirm({
      cliValue: parameters.options.noConfirm,
      commandConfig: ltConfig?.commands?.blocks?.add,
      config: ltConfig,
    });

    const blockName = parameters.first;
    await addBlock(toolbox, blockName, noConfirm);

    if (!parameters.options.fromGluegunMenu) {
      process.exit();
    }
    return `added block ${blockName || 'selected'}`;
  },
};

async function addBlock(toolbox: ExtendedGluegunToolbox, blockName: string | undefined, noConfirm = false) {
  const { print, prompt } = toolbox;

  try {
    const compSpinner = print.spin('Load block selection from GitHub...');
    const possibleBlocks = await getFileInfo('blocks');
    compSpinner.succeed('Blocks selection successfully loaded from GitHub');

    if (possibleBlocks.length > 0) {
      let selectedBlock: string = '';

      if (!blockName) {
        const response = await prompt.ask({
          choices: possibleBlocks,
          message: 'Which block would you like to add?',
          name: 'blockType',
          type: 'select',
        });
        selectedBlock = response.blockType;
      } else {
        const foundBlock = possibleBlocks.find(
          e => e.name.toLowerCase() === `${blockName.toLowerCase()}.vue` || e.name.toLowerCase() === blockName.toLowerCase(),
        );
        selectedBlock = foundBlock?.name || blockName;
      }

      const selectedFile = possibleBlocks.find(e => e.name.toLowerCase() === selectedBlock.toLowerCase());
      if (selectedFile?.type === 'dir') {
        print.success(`The directory ${selectedFile.name} has been selected.`);
        const directoryFiles = await getFileInfo('blocks', selectedFile.name);

        if (directoryFiles.length > 0) {
          for (const file of directoryFiles) {
            await copyFile(
              { name: `${selectedFile.name}/${file.name}`, type: 'dir' } as FileInfo,
              toolbox,
              'blocks',
              noConfirm,
            );
          }
          print.success(`All files from the directory ${selectedFile.name} have been successfully copied.`);
        } else {
          print.error(`The directory ${selectedFile.name} is empty.`);
        }
      } else if (selectedFile?.type === 'file') {
        print.success(`The block ${selectedFile.name} was selected.`);
        await copyFile(selectedFile, toolbox, 'blocks', noConfirm);
      }
    } else {
      print.error('No block found on GitHub.');
    }
  } catch (error) {
    print.error(`Error when adding/selecting the block: ${error.message}`);
  }
}

export default AddBlockCommand;
