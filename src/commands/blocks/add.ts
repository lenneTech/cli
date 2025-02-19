import axios from 'axios';
import * as fs from 'fs';
import * as glob from 'glob';
import { GluegunCommand, filesystem } from 'gluegun';
import * as path from 'path';

import { ExtendedGluegunToolbox } from '../../interfaces/extended-gluegun-toolbox';

const AddComponentCommand: GluegunCommand = {
  description: 'Adds a specific block to another Nuxt project',
  name: 'add',
  run: async (toolbox: ExtendedGluegunToolbox) => {
    const { parameters } = toolbox;
    const blockName = parameters.first;
    await addBlock(toolbox, blockName);
    process.exit();
    return 'add';
  },
};

async function getConfigForBlock(fileName: string, toolbox: ExtendedGluegunToolbox) {
  const { print } = toolbox;
  const configSpinner = print.spin('Checking the config for block...');

  const data = await getConfig();
  const name = fileName.split('.').slice(0, -1).join('.');
  const rootName = name.split('/')[0];

  configSpinner.succeed(`Config for ${rootName} loaded successfully`);
  return data.config[rootName] || {};
}

async function getConfig() {
  const githubApiUrl = 'https://raw.githubusercontent.com/lenneTech/nuxt-base-components/main/config.json';
  const response = await axios.get(githubApiUrl);

  if (response.status === 200) {
    return response.data;
  } else {
    throw new Error(`Error when retrieving the configuration from GitHub: ${response.statusText}`);
  }
}

async function processConfig(config: any, toolbox: ExtendedGluegunToolbox) {
  if (config?.npm) {
    const npmPackages = config.npm;
    for (const npmPackage of npmPackages) {
      await installPackage(npmPackage, toolbox);
    }
  }

  if (config?.composables) {
    const composables = config.composables;
    for (const composable of composables) {
      await copyComposable(composable, toolbox);
    }
  }

  if (config?.components) {
    const components = config.components;
    for (const component of components) {
      if (component.endsWith('/*')) {
        const folderName = component.split('/')[0];
        const directoryFiles = await getComponentsInfo(folderName);

        for (const file of directoryFiles) {
          await copyComponent({ name: `${folderName}/${file.name}`, type: 'dir' }, toolbox);
        }
      } else {
        await copyComponent({ name: `${component}.vue`, type: 'file' }, toolbox);
      }
    }
  }
}

async function installPackage(packageName: string, toolbox: ExtendedGluegunToolbox) {
  const { print, prompt, system } = toolbox;

  const nameWithoutVersion = packageName.split('@')[0] || packageName;
  const packageJsonPath = path.resolve(process.cwd(), 'package.json');
  const packageJson = filesystem.read(packageJsonPath, 'json');
  const isInstalled
    = (packageJson.dependencies && packageJson.dependencies[nameWithoutVersion])
    || (packageJson.devDependencies && packageJson.devDependencies[nameWithoutVersion]);

  if (!isInstalled) {
    const confirm = await prompt.confirm(`The npm package ${nameWithoutVersion} is required. Would you like to install it?`);

    if (!confirm) {
      return;
    }

    const installSpinner = print.spin(`Install npm package ${nameWithoutVersion}...`);
    await system.run(`npm install ${packageName} --save-exact`);
    installSpinner.succeed(`npm package ${nameWithoutVersion} successfully installed`);
  } else {
    print.info(`npm package ${nameWithoutVersion} is already installed`);
  }
}

async function copyComposable(composable: string, toolbox: ExtendedGluegunToolbox) {
  const { print, prompt } = toolbox;
  const apiUrl = `https://raw.githubusercontent.com/lenneTech/nuxt-base-components/main/composables/${composable}.ts`;
  const response = await axios.get(apiUrl);

  if (response.status === 200) {
    const sourceCode = response.data;
    const cwd = process.cwd();
    let targetDirectory: string;

    if (fs.existsSync(path.resolve(cwd, 'composables'))) {
      targetDirectory = path.resolve(cwd, 'composables');
    } else {
      const directories = glob.sync('*/composables', { cwd });

      if (directories.length > 0) {
        targetDirectory = path.join(cwd, directories[0]);
      } else {
        targetDirectory = cwd;
      }
    }

    // check composable already exists
    if (fs.existsSync(path.join(targetDirectory, `${composable}.ts`))) {
      print.info(`The composable ${composable} already exists`);
      return;
    }

    const confirm = await prompt.confirm(`The composable ${composable} is required. Would you like to add it?`);

    if (!confirm) {
      return;
    }

    const targetPath = path.join(targetDirectory, `${composable}.ts`);
    const spinner = print.spin(`Copy the composable ${composable} to ${targetPath}...`);
    fs.writeFileSync(targetPath, sourceCode);
    spinner.succeed(`The composable ${composable} was successfully copied to ${targetPath}`);
  } else {
    print.error(`Error retrieving the file from GitHub: ${response.statusText}`);
  }
}

async function getComponentsInfo(path?: string): Promise<{ name: string; type: 'dir' | 'file' }[]> {
  const githubApiUrl = `https://api.github.com/repos/lenneTech/nuxt-base-components/contents/components${path ? `/${path}` : ''}`;
  const response = await axios.get(githubApiUrl);

  if (response.status === 200) {
    return response.data.map((file: any) => {
      return {
        name: file.name,
        type: file.type,
      };
    });
  } else {
    throw new Error(`Error when retrieving the file list from GitHub: ${response.statusText}`);
  }
}

async function getBlockInfo(path?: string): Promise<{ name: string; type: 'dir' | 'file' }[]> {
  const githubApiUrl = `https://api.github.com/repos/lenneTech/nuxt-base-components/contents/blocks${path ? `/${path}` : ''}`;
  const response = await axios.get(githubApiUrl);

  if (response.status === 200) {
    return response.data.map((file: any) => {
      return {
        name: file.name,
        type: file.type,
      };
    });
  } else {
    throw new Error(`Error when retrieving the file list from GitHub: ${response.statusText}`);
  }
}

async function addBlock(toolbox: ExtendedGluegunToolbox, blockName: string | undefined) {
  const { print, prompt } = toolbox;

  try {
    const compSpinner = print.spin('Load block selection from GitHub...');
    const possibleBlocks = await getBlockInfo();
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
        const foundComponent = possibleBlocks.find(e => e.name.toLowerCase() === `${blockName.toLowerCase()}.vue` || e.name.toLowerCase() === blockName.toLowerCase());
        selectedBlock = foundComponent.name;
      }

      const selectedFile = possibleBlocks.find(e => e.name.toLowerCase() === selectedBlock.toLowerCase());
      if (selectedFile?.type === 'dir') {
        print.success(`The directory ${selectedFile.name} has been selected.`);
        const directoryFiles = await getBlockInfo(selectedFile.name);

        if (directoryFiles.length > 0) {
          for (const file of directoryFiles) {
            await copyBlock({
              name: `${selectedFile.name}/${file.name}`,
              type: 'dir',
            }, toolbox);
          }
          print.success(`All files from the directory ${selectedFile.name} have been successfully copied.`);
        } else {
          print.error(`The directory ${selectedFile.name} is empty.`);
        }
      } else if (selectedFile?.type === 'file') {
        print.success(`The block ${selectedFile.name} was selected.`);
        await copyBlock(selectedFile, toolbox);
      }
    } else {
      print.error('No block found on GitHub.');
    }
  } catch (error) {
    print.error(`Error when adding/selecting the block: ${error.message}`);
  }
}

async function copyBlock(file: { name: string; type: 'dir' | 'file' }, toolbox: ExtendedGluegunToolbox) {
  const { print } = toolbox;
  const apiUrl = `https://raw.githubusercontent.com/lenneTech/nuxt-base-components/main/blocks/${file.name}`;

  return new Promise(async (resolve, reject) => {
    try {
      const config = await getConfigForBlock(file.name, toolbox);

      if (config) {
        await processConfig(config, toolbox);
      }

      const compSpinner = print.spin(`Load block ${file.name} from GitHub...`);
      const response = await axios.get(apiUrl);
      compSpinner.succeed(`Block ${file.name} successfully loaded from GitHub`);

      if (response.status === 200) {
        const sourceCode = response.data;
        const cwd = process.cwd();
        let targetDirectory: string;

        if (fs.existsSync(path.resolve(cwd, 'pages'))) {
          targetDirectory = path.resolve(cwd, 'pages');
        } else {
          const directories = glob.sync('*/pages', { cwd });

          if (directories.length > 0) {
            targetDirectory = path.join(cwd, directories[0]);
          } else {
            targetDirectory = cwd;
          }
        }

        const targetName = file.name.replace(/([a-z])([A-Z])/g, '$1-$2')
          .toLowerCase()
          .replace(/^block-/, '');
        const targetPath = path.join(targetDirectory, `${targetName}`);

        // check if block already exists
        if (fs.existsSync(targetPath)) {
          print.info(`The block ${file.name} already exists`);
          resolve(targetPath);
          return;
        }

        if (!fs.existsSync(targetDirectory)) {
          const targetDirSpinner = print.spin('Creating the target directory...');
          fs.mkdirSync(targetDirectory, { recursive: true });
          targetDirSpinner.succeed();
        }

        if (file.type === 'dir') {
          const dirName = file.name.split('/')[0];
          const dirPath = path.join(targetDirectory, dirName);
          if (!fs.existsSync(dirPath)) {
            fs.mkdirSync(dirPath, { recursive: true });
          }
        }

        const spinner = print.spin(`Copy the block ${targetName} to ${targetPath}...`);
        fs.writeFileSync(targetPath, sourceCode);
        spinner.succeed(`The block ${targetName} was successfully copied to ${targetPath}`);
        resolve(targetPath);
      } else {
        print.error(`Error retrieving the file from GitHub: ${response.statusText}`);
        reject(response.statusText);
      }
    } catch (error) {
      print.error(`Error when copying the block ${file.name}: ${error.message}`);
      reject(error);
    }
  });
}

async function copyComponent(file: { name: string; type: 'dir' | 'file' }, toolbox: ExtendedGluegunToolbox) {
  const { print } = toolbox;
  const apiUrl = `https://raw.githubusercontent.com/lenneTech/nuxt-base-components/main/components/${file.name}`;

  return new Promise(async (resolve, reject) => {
    try {
      const config = await getConfigForBlock(file.name, toolbox);

      if (config) {
        await processConfig(config, toolbox);
      }

      const compSpinner = print.spin(`Load component ${file.name} from GitHub...`);
      const response = await axios.get(apiUrl);
      compSpinner.succeed(`Component ${file.name} successfully loaded from GitHub`);

      if (response.status === 200) {
        const sourceCode = response.data;
        const cwd = process.cwd();
        let targetDirectory: string;

        if (fs.existsSync(path.resolve(cwd, 'components'))) {
          targetDirectory = path.resolve(cwd, 'components');
        } else {
          const directories = glob.sync('*/components', { cwd });

          if (directories.length > 0) {
            targetDirectory = path.join(cwd, directories[0]);
          } else {
            targetDirectory = cwd;
          }
        }

        const targetPath = path.join(targetDirectory, `${file.name}`);

        if (fs.existsSync(targetPath)) {
          print.info(`The component ${file.name} already exists`);
          resolve(targetPath);
          return;
        }

        if (!fs.existsSync(targetDirectory)) {
          const targetDirSpinner = print.spin('Creating the target directory...');
          fs.mkdirSync(targetDirectory, { recursive: true });
          targetDirSpinner.succeed();
        }

        if (file.type === 'dir' || file.name.split('/').length > 1) {
          const dirName = file.name.split('/')[0];
          const dirPath = path.join(targetDirectory, dirName);
          if (!fs.existsSync(dirPath)) {
            fs.mkdirSync(dirPath, { recursive: true });
          }
        }

        const spinner = print.spin(`Copy the component ${file.name} to ${targetPath}...`);
        fs.writeFileSync(targetPath, sourceCode);
        spinner.succeed(`The component ${file.name} was successfully copied to ${targetPath}`);
        resolve(targetPath);
      } else {
        print.error(`Error retrieving the file from GitHub: ${response.statusText}`);
        reject(response.statusText);
      }
    } catch (error) {
      print.error(`Error when copying the component ${file.name}: ${error.message}`);
      reject(error);
    }
  });
}

export default AddComponentCommand;
