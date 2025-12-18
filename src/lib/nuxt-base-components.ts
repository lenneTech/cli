/**
 * Shared utilities for blocks and components commands
 * These functions handle downloading and installing Nuxt base components from GitHub
 */
import axios from 'axios';
import * as fs from 'fs';
import * as glob from 'glob';
import { filesystem } from 'gluegun';
import * as path from 'path';

import { ExtendedGluegunToolbox } from '../interfaces/extended-gluegun-toolbox';

const GITHUB_BASE_URL = 'https://raw.githubusercontent.com/lenneTech/nuxt-base-components/main';
const GITHUB_API_URL = 'https://api.github.com/repos/lenneTech/nuxt-base-components/contents';

export interface FileInfo {
  name: string;
  type: 'dir' | 'file';
}

/**
 * Copy a composable from GitHub to the local composables directory
 */
export async function copyComposable(
  composable: string,
  toolbox: ExtendedGluegunToolbox,
  noConfirm = false,
): Promise<void> {
  const { print, prompt } = toolbox;
  const apiUrl = `${GITHUB_BASE_URL}/composables/${composable}.ts`;
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

    // Check if composable already exists
    if (fs.existsSync(path.join(targetDirectory, `${composable}.ts`))) {
      print.info(`The composable ${composable} already exists`);
      return;
    }

    if (!noConfirm) {
      const confirmAdd = await prompt.confirm(`The composable ${composable} is required. Would you like to add it?`);
      if (!confirmAdd) {
        return;
      }
    }

    const targetPath = path.join(targetDirectory, `${composable}.ts`);
    const spinner = print.spin(`Copy the composable ${composable} to ${targetPath}...`);
    fs.writeFileSync(targetPath, sourceCode);
    spinner.succeed(`The composable ${composable} was successfully copied to ${targetPath}`);
  } else {
    print.error(`Error retrieving the file from GitHub: ${response.statusText}`);
  }
}

/**
 * Copy a file (block or component) from GitHub to local directory
 */
export async function copyFile(
  file: FileInfo,
  toolbox: ExtendedGluegunToolbox,
  type: 'blocks' | 'components',
  noConfirm = false,
): Promise<string> {
  const { print } = toolbox;
  const apiUrl = `${GITHUB_BASE_URL}/${type}/${file.name}`;
  const targetDirName = type === 'blocks' ? 'pages' : 'components';

  const config = await getConfigForFile(file.name, toolbox, type === 'blocks' ? 'block' : 'component');

  if (config) {
    await processConfig(config, toolbox, type, noConfirm);
  }

  const compSpinner = print.spin(`Load ${type.slice(0, -1)} ${file.name} from GitHub...`);
  const response = await axios.get(apiUrl);
  compSpinner.succeed(`${type === 'blocks' ? 'Block' : 'Component'} ${file.name} successfully loaded from GitHub`);

  if (response.status === 200) {
    const sourceCode = response.data;
    const cwd = process.cwd();
    let targetDirectory: string;

    if (fs.existsSync(path.resolve(cwd, targetDirName))) {
      targetDirectory = path.resolve(cwd, targetDirName);
    } else {
      const directories = glob.sync(`*/${targetDirName}`, { cwd });

      if (directories.length > 0) {
        targetDirectory = path.join(cwd, directories[0]);
      } else {
        targetDirectory = cwd;
      }
    }

    let targetName = file.name;
    if (type === 'blocks') {
      targetName = file.name
        .replace(/([a-z])([A-Z])/g, '$1-$2')
        .toLowerCase()
        .replace(/^block-/, '');
    }
    const targetPath = path.join(targetDirectory, targetName);

    // Check if file already exists
    if (fs.existsSync(targetPath)) {
      print.info(`The ${type.slice(0, -1)} ${file.name} already exists`);
      return targetPath;
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

    const spinner = print.spin(`Copy the ${type.slice(0, -1)} ${targetName} to ${targetPath}...`);
    fs.writeFileSync(targetPath, sourceCode);
    spinner.succeed(`The ${type.slice(0, -1)} ${targetName} was successfully copied to ${targetPath}`);
    return targetPath;
  } else {
    throw new Error(`Error retrieving the file from GitHub: ${response.statusText}`);
  }
}

/**
 * Get the config.json from the nuxt-base-components repository
 */
export async function getConfig(): Promise<any> {
  const githubApiUrl = `${GITHUB_BASE_URL}/config.json`;
  const response = await axios.get(githubApiUrl);

  if (response.status === 200) {
    return response.data;
  } else {
    throw new Error(`Error when retrieving the configuration from GitHub: ${response.statusText}`);
  }
}

/**
 * Get configuration for a specific block or component
 */
export async function getConfigForFile(
  fileName: string,
  toolbox: ExtendedGluegunToolbox,
  type: 'block' | 'component',
): Promise<any> {
  const { print } = toolbox;
  const configSpinner = print.spin(`Checking the config for ${type}...`);

  const data = await getConfig();
  const name = fileName.split('.').slice(0, -1).join('.');
  const rootName = name.split('/')[0];

  configSpinner.succeed(`Config for ${rootName} loaded successfully`);
  return data.config[rootName] || {};
}

/**
 * Get file info from GitHub API for blocks or components
 */
export async function getFileInfo(
  type: 'blocks' | 'components',
  subPath?: string,
): Promise<FileInfo[]> {
  const githubApiUrl = `${GITHUB_API_URL}/${type}${subPath ? `/${subPath}` : ''}`;
  const response = await axios.get(githubApiUrl);

  if (response.status === 200) {
    return response.data.map((file: any) => ({
      name: file.name,
      type: file.type,
    }));
  } else {
    throw new Error(`Error when retrieving the file list from GitHub: ${response.statusText}`);
  }
}

/**
 * Install an npm package if not already installed
 */
export async function installPackage(
  packageName: string,
  toolbox: ExtendedGluegunToolbox,
  noConfirm = false,
): Promise<void> {
  const { print, prompt, system } = toolbox;

  const nameWithoutVersion = packageName.split('@')[0] || packageName;
  const packageJsonPath = path.resolve(process.cwd(), 'package.json');
  const packageJson = filesystem.read(packageJsonPath, 'json');
  const isInstalled
    = (packageJson.dependencies && packageJson.dependencies[nameWithoutVersion])
    || (packageJson.devDependencies && packageJson.devDependencies[nameWithoutVersion]);

  if (!isInstalled) {
    if (!noConfirm) {
      const confirmInstall = await prompt.confirm(
        `The npm package ${nameWithoutVersion} is required. Would you like to install it?`,
      );
      if (!confirmInstall) {
        return;
      }
    }

    const installSpinner = print.spin(`Install npm package ${nameWithoutVersion}...`);
    await system.run(`npm install ${packageName} --save-exact`);
    installSpinner.succeed(`npm package ${nameWithoutVersion} successfully installed`);
  } else {
    print.info(`npm package ${nameWithoutVersion} is already installed`);
  }
}

/**
 * Process config dependencies (npm packages, composables, components)
 */
export async function processConfig(
  config: any,
  toolbox: ExtendedGluegunToolbox,
  type: 'blocks' | 'components',
  noConfirm = false,
): Promise<void> {
  if (config?.npm) {
    const npmPackages = config.npm;
    for (const npmPackage of npmPackages) {
      await installPackage(npmPackage, toolbox, noConfirm);
    }
  }

  if (config?.composables) {
    const composables = config.composables;
    for (const composable of composables) {
      await copyComposable(composable, toolbox, noConfirm);
    }
  }

  if (config?.components) {
    const components = config.components;
    for (const component of components) {
      if (component.endsWith('/*')) {
        const folderName = component.split('/')[0];
        const directoryFiles = await getFileInfo('components', folderName);

        for (const file of directoryFiles) {
          await copyFile({ name: `${folderName}/${file.name}`, type: 'dir' }, toolbox, 'components', noConfirm);
        }
      } else {
        await copyFile({ name: `${component}.vue`, type: 'file' }, toolbox, 'components', noConfirm);
      }
    }
  }
}
