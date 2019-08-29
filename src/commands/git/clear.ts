import { GluegunCommand } from 'gluegun'
import { ExtendedGluegunToolbox } from '../../interfaces/extended-gluegun-toolbox'

/**
 * Undo last commit (without loosing files)
 */
const NewCommand: GluegunCommand = {
  name: 'clear',
  alias: ['cl'],
  description: 'Undo current changes',
  hidden: false,
  run: async (toolbox: ExtendedGluegunToolbox) => {
    // Retrieve the tools we need
    const {
      git,
      helper,
      parameters,
      prompt: { confirm },
      print: { info, spin, success },
      system: { run, startTimer }
    } = toolbox

    // Check git
    if (!(await git.gitInstalled())) {
      return
    }

    // Get current branch
    const branch = await git.currentBranch()

    // Ask to squash the branch
    if (
      !parameters.options.noConfirm &&
      !(await confirm(`Clear "${branch}"?`))
    ) {
      return
    }

    // Start timer
    const timer = startTimer()

    // Reset soft
    const undoSpinner = spin(`Clear ${branch}`)
    await run('git reset --hard && git clean -fd')
    undoSpinner.succeed()

    // Success
    success(`Clear ${branch} in ${helper.msToMinutesAndSeconds(timer())}m.`)
    info('')

    // For tests
    return `clear branch ${branch}`
  }
}

export default NewCommand
