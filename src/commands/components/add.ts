import { GluegunCommand } from 'gluegun';
import { ExtendedGluegunToolbox } from '../../interfaces/extended-gluegun-toolbox';
import * as fs from 'fs';
import * as path from 'path';
import axios from 'axios';

async function getGitHubComponentNames(): Promise<{ name: string; type: 'dir' | 'file' }[]> {
    const githubApiUrl = 'https://api.github.com/repos/lenneTech/nuxt-base-components/contents/components';
    try {
        const response = await axios.get(githubApiUrl);
        if (response.status === 200) {
            return response.data.map((file: any) => {
                return {
                    name: file.name,
                    type: file.type,
                };
            });
        } else {
            throw new Error(`Fehler beim Abrufen der Dateiliste von GitHub: ${response.statusText}`);
        }
    } catch (error) {
        throw new Error(`Fehler beim Abrufen der Dateiliste von GitHub: ${error.message}`);
    }
}

async function addComponent(toolbox: ExtendedGluegunToolbox, componentName: string | undefined) {
    const { print, prompt } = toolbox;

    try {
        const componentNames = await getGitHubComponentNames();

        if (componentNames.length > 0) {
            let selectedComponent;

            if (!componentName) {
                const response = await prompt.ask({
                    type: 'select',
                    name: 'componentType',
                    message: 'Welche Komponente möchten Sie hinzufügen:',
                    choices: componentNames.map((c) => c.name.replace('.vue','')),
                });

                selectedComponent = response.componentType;
            } else {
                selectedComponent = componentName;
            }

            const item = componentNames.find((e) => e.type === 'file' ? e.name === selectedComponent + '.vue' : e.name === selectedComponent);
            if (item?.type === 'dir') {
                const directoryName = item.name;
                const directoryFiles = await getFilesInDirectory(directoryName);

                if (directoryFiles.length > 0) {
                    for (const file of directoryFiles) {
                        await copyComponent({
                            githubRawLink: `https://raw.githubusercontent.com/lenneTech/nuxt-base-components/main/components/${directoryName}/${file}`,
                            name: file,
                            type: item.type,
                            directoryName: directoryName,
                        });
                    }
                    console.log(`Alle Dateien aus dem Verzeichnis ${directoryName} wurden erfolgreich kopiert.`);
                } else {
                    console.log(`Das Verzeichnis ${directoryName} ist leer.`);
                }
            } else if (item?.type === 'file') {
                await copyComponent({
                    githubRawLink: `https://raw.githubusercontent.com/lenneTech/nuxt-base-components/main/components/${selectedComponent}.vue`,
                    name: selectedComponent + '.vue',
                    type: item.type
                });
            }
        } else {
            print.error('Keine Komponenten auf GitHub gefunden.');
        }
    } catch (error) {
        print.error(`Fehler beim Hinzufügen/Auswählen der Komponente: ${error.message}`);
    }
}

const AddComponentCommand: GluegunCommand = {
    name: 'add',
    description: 'Füge eine bestimmte Komponente zu einem anderen Nuxt-Projekt hinzu',
    run: async (toolbox: ExtendedGluegunToolbox) => {
        const { parameters } = toolbox;
        const componentName = parameters.first;
        await addComponent(toolbox, componentName);
    },
};

async function getFilesInDirectory(directoryName: string): Promise<string[]> {
    const githubApiUrl = `https://api.github.com/repos/lenneTech/nuxt-base-components/contents/components/${directoryName}`;

    try {
        const response = await axios.get(githubApiUrl);

        if (response.status === 200) {
            return response.data.map((file: any) => file.name);
        } else {
            throw new Error(`Fehler beim Abrufen von Dateien aus dem Verzeichnis ${directoryName}: ${response.statusText}`);
        }
    } catch (error) {
        throw new Error(`Fehler beim Abrufen von Dateien aus dem Verzeichnis ${directoryName}: ${error.message}`);
    }
}

async function copyComponent({ githubRawLink, name, type, directoryName }: { githubRawLink: string; name: string; type: 'dir' | 'file', directoryName?: string }) {
    try {
        const response = await axios.get(githubRawLink);

        if (response.status === 200) {
            const sourceCode = response.data;

            const currentWorkingDirectory = process.cwd();

            const srcComponentsDirectory = path.resolve(currentWorkingDirectory, 'src/components');
            const componentsDirectory = path.resolve(currentWorkingDirectory, 'components');

            let targetDirectory;

            if (fs.existsSync(srcComponentsDirectory)) {
                targetDirectory = srcComponentsDirectory;
            } else if (fs.existsSync(componentsDirectory)) {
                targetDirectory = componentsDirectory;
            } else {
                targetDirectory = currentWorkingDirectory;
            }

            if (type === 'dir') {
                targetDirectory = targetDirectory + '/' + directoryName;
            }

            const targetPath = path.join(targetDirectory, `${name}`)

            if (!fs.existsSync(targetDirectory)) {
                fs.mkdirSync(targetDirectory, { recursive: true });
            }

            fs.writeFileSync(targetPath, sourceCode);

            console.log(`Die Komponente ${name} wurde erfolgreich kopiert nach ${targetPath}`);
        } else {
            console.error(`Fehler beim Abrufen der Datei von GitHub: ${response.statusText}`);
        }
    } catch (error) {
        console.error(`Fehler beim Kopieren der Komponente ${name}: ${error.message}`);
    }
}

export default AddComponentCommand;
