import { GluegunCommand } from 'gluegun'
import { ExtendedGluegunToolbox } from '../../interfaces/extended-gluegun-toolbox'

/**
 * Update branch
 */
const NewCommand: GluegunCommand = {
  name: 'update',
  alias: ['up'],
  description: 'Update branch',
  hidden: false,
  run: async (toolbox: ExtendedGluegunToolbox) => {
    // Retrieve the tools we need
    const {
      git,
      helper,
      npm,
      print: { info, spin, success },
      system: { run, startTimer }
    } = toolbox

    // Check git
    if (!(await git.gitInstalled())) {
      return
    }

    // Start timer
    const timer = startTimer()

    // Get current branch
    const branch = await git.currentBranch()

    // Update
    const updateSpin = spin(`Update branch ${branch}`)
    await run('git fetch && git pull')
    updateSpin.succeed()

    // Install npm packages
    await npm.install()

    // Success
    success(`Updated ${branch} in ${helper.msToMinutesAndSeconds(timer())}.`)
    info('')

    // For tests
    return `updated ${branch}`
  }
}

export default NewCommand
