import { GluegunCommand } from 'gluegun'
import { ExtendedGluegunToolbox } from '../../interfaces/extended-gluegun-toolbox'

/**
 * Undo last commit (without loosing files)
 */
const NewCommand: GluegunCommand = {
  name: 'undo',
  alias: ['un'],
  description: 'Undo last commit (without loosing files)',
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

    // Last commit message
    const lastCommitMessage = await git.lastCommitMessage()

    // Ask to squash the branch
    if (
      !parameters.options.noConfirm &&
      !(await confirm(`Undo last commit "${lastCommitMessage}"?`))
    ) {
      return
    }

    // Start timer
    const timer = startTimer()

    // Get current branch
    const branch = await git.currentBranch()

    // Reset soft
    const undoSpinner = spin(`Undo last commit of branch ${branch}`)
    await run('git reset --soft HEAD~')
    undoSpinner.succeed()

    // Success
    success(
      `Undo last commit of ${branch} in ${helper.msToMinutesAndSeconds(
        timer()
      )}.`
    )
    info('')

    // For tests
    return `undo last commit of branch ${branch}`
  }
}

export default NewCommand
