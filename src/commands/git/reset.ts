import { GluegunCommand } from 'gluegun'
import { ExtendedGluegunToolbox } from '../../interfaces/extended-gluegun-toolbox'

/**
 * Reset current branch
 */
const NewCommand: GluegunCommand = {
  name: 'reset',
  alias: ['r'],
  description: 'Reset current branch',
  hidden: false,
  run: async (toolbox: ExtendedGluegunToolbox) => {
    // Retrieve the tools we need
    const {
      filesystem,
      git,
      helper,
      parameters,
      print: { error, info, spin, success },
      prompt,
      system
    } = toolbox

    // Start timer
    const timer = system.startTimer()

    // Check git
    if (!(await git.gitInstalled())) {
      return
    }

    // Current branch
    let branch = await system.run('git rev-parse --abbrev-ref HEAD')
    if (!branch) {
      error(`Branch ${parameters.first} not found!`)
      return
    }

    // Check remote
    const remoteBranch = await system.run(
      `git ls-remote --heads origin ${branch}`
    )
    if (!remoteBranch) {
      error(`No remote branch ${parameters.first} found!`)
      return
    }

    // Ask for reset
    const checkout = await prompt.confirm(
      `Reset branch ${branch} to the remote state`
    )
    if (!checkout) {
      return
    }

    // Reset
    const resetSpin = spin('Reset ' + branch)
    await system.run(
      'git clean -fd && ' +
        'git reset HEAD --hard && ' +
        'git checkout master && ' +
        'git fetch && ' +
        'git pull && ' +
        'git branch -D ' +
        branch +
        ' && ' +
        'git checkout ' +
        branch +
        ' && ' +
        'git pull'
    )
    resetSpin.succeed()

    // Install npm packages
    if (filesystem.exists('package.json')) {
      const npmSpin = spin('Install npm packages')
      await system.run('npm i')
      npmSpin.succeed()
    }

    // Success info
    success(
      `Branch ${branch} was reset in in ${helper.msToMinutesAndSeconds(
        timer()
      )}.`
    )
    info('')

    // For tests
    return `new server ${toolbox.parameters.first}`
  }
}

export default NewCommand
