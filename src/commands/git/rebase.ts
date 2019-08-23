import { GluegunCommand } from 'gluegun'
import { ExtendedGluegunToolbox } from '../../interfaces/extended-gluegun-toolbox'

/**
 * Rebase branch
 */
const NewCommand: GluegunCommand = {
  name: 'rebase',
  alias: ['rb'],
  description: 'Rebase branch',
  hidden: false,
  run: async (toolbox: ExtendedGluegunToolbox) => {
    // Retrieve the tools we need
    const {
      git,
      helper,
      parameters,
      print: { error, info, spin, success },
      prompt: { confirm },
      system: { run, startTimer }
    } = toolbox

    // Check git
    if (!(await git.gitInstalled())) {
      return
    }

    // Get current branch
    const branch = await git.currentBranch()

    // Check branch
    if (branch === 'master' || branch === 'release' || branch === 'develop') {
      error(`Rebase of branch ${branch} is not allowed!`)
      return
    }

    // Ask to Rebase the branch
    if (
      !parameters.options.noConfirm &&
      !(await confirm(`Rebase branch ${branch}?`))
    ) {
      return
    }

    // Select base branch
    let baseBranch = parameters.first
    if (!baseBranch || !(await git.getBranch(baseBranch))) {
      baseBranch = await git.selectBranch({ text: 'Select base branch' })
    }

    // Start timer
    const timer = startTimer()

    // Rebase
    const rebaseSpin = spin(`Set ${baseBranch} as base of ${branch}`)
    await run(
      `git fetch && git checkout ${baseBranch} && git pull && git checkout ${branch} && git rebase ${baseBranch}`
    )
    rebaseSpin.succeed()

    // Success
    success(`Rebased ${branch} in ${helper.msToMinutesAndSeconds(timer())}.`)
    info('')

    // For tests
    return `rebased ${branch}`
  }
}

export default NewCommand
