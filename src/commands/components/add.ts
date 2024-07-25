import { GluegunCommand } from 'gluegun'
import { ExtendedGluegunToolbox } from '../../interfaces/extended-gluegun-toolbox'
import * as fs from 'fs'
import * as glob from 'glob';
import * as path from 'path'
import axios from 'axios'

const AddComponentCommand: GluegunCommand = {
  name: 'add',
  description: 'Füge eine bestimmte Komponente zu einem anderen Nuxt-Projekt hinzu',
  run: async (toolbox: ExtendedGluegunToolbox) => {
    const { parameters } = toolbox
    const componentName = parameters.first
    await addComponent(toolbox, componentName)
    process.exit();
    return 'add';
  }
}

async function getFileInfo(path?: string): Promise<{ name: string; type: 'dir' | 'file' }[]> {
  const githubApiUrl = `https://api.github.com/repos/lenneTech/nuxt-base-components/contents/components${path ? '/' + path : ''}`
  const response = await axios.get(githubApiUrl)

  if (response.status === 200) {
    return response.data.map((file: any) => {
      return {
        name: file.name,
        type: file.type
      }
    })
  } else {
    throw new Error(`Fehler beim Abrufen der Dateiliste von GitHub: ${response.statusText}`)
  }
}

async function addComponent(toolbox: ExtendedGluegunToolbox, componentName: string | undefined) {
  const { print, prompt } = toolbox

  try {
    const compSpinner = print.spin('Lade Komponenten Auswahl von GitHub...');
    const possibleComponents = await getFileInfo()
    compSpinner.succeed('Komponenten Auswahl von GitHub erfolgreich geladen');

    if (possibleComponents.length > 0) {
      let selectedComponent: string = '';

      if (!componentName) {
        const response = await prompt.ask({
          type: 'select',
          name: 'componentType',
          message: 'Welche Komponente möchten Sie hinzufügen:',
          choices: possibleComponents,
        })
        selectedComponent = response.componentType
      } else {
        selectedComponent = componentName
      }

      const selectedFile = possibleComponents.find((e) => e.name === selectedComponent);
      if (selectedFile?.type === 'dir') {
        print.success(`Das Verzeichnis ${selectedFile.name} wurde ausgewählt.`);
        const directoryFiles = await getFileInfo(selectedFile.name)

        if (directoryFiles.length > 0) {
          for (const file of directoryFiles) {
            await copyComponent({
              name: `${selectedFile.name}/${file.name}`,
              type: 'dir'
            }, toolbox)
          }
          print.success(`Alle Dateien aus dem Verzeichnis ${selectedFile.name} wurden erfolgreich kopiert.`)
        } else {
          print.error(`Das Verzeichnis ${selectedFile.name} ist leer.`)
        }
      } else if (selectedFile?.type === 'file') {
        print.success(`Die Komponente ${selectedFile.name} wurde ausgewählt.`);
        await copyComponent(selectedFile, toolbox)
      }
    } else {
      print.error('Keine Komponenten auf GitHub gefunden.')
    }
  } catch (error) {
    print.error(`Fehler beim Hinzufügen/Auswählen der Komponente: ${error.message}`)
  }
}

async function copyComponent(file: { name: string; type: 'dir' | 'file' }, toolbox: ExtendedGluegunToolbox) {
  const { print } = toolbox
  const apiUrl = `https://raw.githubusercontent.com/lenneTech/nuxt-base-components/main/components/${file.name}`;

  return new Promise(async (resolve, reject) => {
    try {
      const compSpinner = print.spin(`Lade Komponente ${file.name} von GitHub...`);
      const response = await axios.get(apiUrl)
      compSpinner.succeed(`Komponente ${file.name} erfolgreich von GitHub geladen`);

      if (response.status === 200) {
        const sourceCode = response.data
        const cwd = process.cwd()
        let targetDirectory: string

        if (fs.existsSync(path.resolve(cwd, 'components'))) {
          targetDirectory = path.resolve(cwd, 'components')
        } else {
          const directories = glob.sync('*/components', { cwd });

          if (directories.length > 0) {
            targetDirectory = path.join(cwd, directories[0])
          } else {
            targetDirectory = cwd
          }
        }

        print.info(`Found directory for components: ${targetDirectory}`)

        const targetPath = path.join(targetDirectory, `${file.name}`)
        if (!fs.existsSync(targetDirectory)) {
          const targetDirSpinner = print.spin(`Creating target directory...`)
          fs.mkdirSync(targetDirectory, { recursive: true })
          targetDirSpinner.succeed(`Target directory created successfully`)
        }

        if (file.type === 'dir') {
          const dirName = file.name.split('/')[0];
          const dirPath = path.join(targetDirectory, dirName);
          if (!fs.existsSync(dirPath)) {
            const dirSpinner = print.spin(`Creating directory ${dirName}...`)
            fs.mkdirSync(dirPath, { recursive: true })
            dirSpinner.succeed(`Directory ${dirName} created successfully`)
          }
        }

        const spinner = print.spin(`Kopiere die Komponente ${file.name} nach ${targetPath}...`)
        fs.writeFileSync(targetPath, sourceCode);
        spinner.succeed(`Die Komponente ${file.name} wurde erfolgreich kopiert nach ${targetPath}`)
        resolve(targetPath)
      } else {
        print.error(`Fehler beim Abrufen der Datei von GitHub: ${response.statusText}`)
        reject(response.statusText)
      }
    } catch (error) {
      print.error(`Fehler beim Kopieren der Komponente ${file.name}: ${error.message}`)
      reject(error)
    }
  })
}

export default AddComponentCommand
