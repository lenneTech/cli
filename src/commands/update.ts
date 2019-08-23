import { ExtendedGluegunToolbox } from '../interfaces/extended-gluegun-toolbox'
import { GluegunCommand } from 'gluegun'

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
      print: { info, spin, success },
      system: { run, startTimer }
    } = toolbox

    // Start timer
    const timer = startTimer()

    // Update
    const updateSpin = spin(`Update @lenne.tech/cli`)
    await run('npm install -g @lenne.tech/cli')
    updateSpin.succeed()

    // Check new version
    const versionSpin = spin(`Get current version from @lenne.tech/cli`)
    const version = helper.trim(await run('lt version'))
    versionSpin.succeed()

    // Success
    success(
      `Updated to ${version} from @lenne.tech/cli in ${helper.msToMinutesAndSeconds(
        timer()
      )}m.`
    )
    info('')

    // For tests
    return `updated @lenne.tech/cli`
  }
}

export default NewCommand
