import { GluegunCommand } from 'gluegun'
import { dirname } from 'path'
import { ExtendedGluegunToolbox } from '../../interfaces/extended-gluegun-toolbox'

/**
 * Rename current CLI
 */
const NewCommand: GluegunCommand = {
  name: 'rename',
  alias: ['r'],
  description: 'Rename current CLI',
  hidden: false,
  run: async (toolbox: ExtendedGluegunToolbox) => {
    // Retrieve the tools we need
    const {
      npm,
      parameters,
      print: { error },
      system
    } = toolbox

    // Get root path
    const { path: packagePath } = await npm.getPackageJson()
    if (!packagePath) {
      error('The path to the root directory could not be found.')
      return undefined
    }
    const rootPath = dirname(packagePath)
    if (!rootPath) {
      error('The path to the root directory could not be found.')
      return undefined
    }

    // Run rename script
    await system.run(`cd ${rootPath} && npm run rename -- ${parameters.string}`)

    // For tests
    return `Rename current CLI to ${name}`
  }
}

export default NewCommand
