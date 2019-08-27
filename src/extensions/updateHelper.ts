import { ExtendedGluegunToolbox } from '../interfaces/extended-gluegun-toolbox'

/**
 * Update function
 */
export class UpdateHelper {
  /**
   * Constructor for integration of toolbox
   */
  constructor(protected toolbox: ExtendedGluegunToolbox) {}

  public async runUpdate() {
    const {
      helper,
      print: { info, spin, success },
      system: { run, startTimer }
    } = this.toolbox
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
      `🎉 Updated to ${version} from @lenne.tech/cli in ${helper.msToMinutesAndSeconds(
        timer()
      )}m.`
    )
    info('')
  }
}

/**
 * Extend updateHelper
 */
export default (toolbox: ExtendedGluegunToolbox) => {
  toolbox.updateHelper = new UpdateHelper(toolbox)
}
