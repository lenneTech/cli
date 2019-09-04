import { GluegunCommand } from 'gluegun'
import { ExtendedGluegunToolbox } from '../interfaces/extended-gluegun-toolbox'

/**
 * Update @lenne.tech/cli
 */
const NewCommand: GluegunCommand = {
  name: 'update',
  alias: ['up'],
  description: 'Update @lenne.tech/cli',
  hidden: false,
  run: async (toolbox: ExtendedGluegunToolbox) => {
    // Retrieve the tools we need
    const {
      helper,
      runtime: { brand }
    } = toolbox

    // Update cli and show process
    await helper.updateCli({ showInfos: true })

    // For tests
    return `updated ${brand}`
  }
}

export default NewCommand
