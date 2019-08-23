import { GluegunCommand } from 'gluegun'
import { ExtendedGluegunToolbox } from '../../interfaces/extended-gluegun-toolbox'

/**
 * Create a new branch
 */
const NewCommand: GluegunCommand = {
  name: 'create',
  alias: ['c'],
  description: 'Create a new branch',
  hidden: false,
  run: async (toolbox: ExtendedGluegunToolbox) => {
    // Retrieve the tools we need
    const {
      git,
      helper,
      npm,
      parameters,
      print: { error, info, spin, success },
      system
    } = toolbox

    // Check git
    if (!(await git.gitInstalled())) {
      return
    }

    // Check changes in current branch (reset optional)
    await git.askForReset()

    // Get branch
    const branch = await helper.getInput(parameters.first, {
      name: 'branch name',
      showError: true
    })
    if (!branch) {
      return
    }

    // Check if branch already exists
    if (await git.getBranch(branch)) {
      error(`Branch ${branch} already exists!`)
    }

    // Select base branch
    let baseBranch = parameters.second
    if (!baseBranch || !(await git.getBranch(baseBranch))) {
      baseBranch = await git.selectBranch({ text: 'Select base branch' })
    }

    // Start timer
    const timer = system.startTimer()

    // Checkout
    const createSpin = spin('Create ' + branch)
    await system.run(
      `git checkout ${baseBranch} &&` +
        'git pull && ' +
        'git fetch && ' +
        `git checkout -b ${branch}`
    )
    createSpin.succeed()

    // Install npm packages
    await npm.install()

    // Success info
    success(
      `Branch ${branch} was created in ${helper.msToMinutesAndSeconds(
        timer()
      )}.`
    )
    info('')

    // For tests
    return `created branch ${branch}`
  }
}

export default NewCommand
