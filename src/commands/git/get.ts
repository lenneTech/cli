import { GluegunCommand } from 'gluegun'
import { ExtendedGluegunToolbox } from '../../interfaces/extended-gluegun-toolbox'

/**
 * Checkout git branch
 */
const NewCommand: GluegunCommand = {
  name: 'get',
  alias: ['g'],
  description: 'Checkout git branch',
  hidden: false,
  run: async (toolbox: ExtendedGluegunToolbox) => {
    // Retrieve the tools we need
    const {
      git,
      helper,
      npm,
      parameters,
      print: { info, spin, success },
      prompt,
      system
    } = toolbox

    // Start timer
    const timer = system.startTimer()

    // Check git
    if (!(await git.gitInstalled())) {
      return
    }

    // Get branch
    let branch = await helper.getInput(parameters.first, {
      name: 'branch name',
      showError: true
    })
    if (!branch) {
      return
    }

    // Check changes in current branch (reset necessary)
    if (!(await git.askForReset({ showError: true }))) {
      return
    }

    // Get branch
    branch = await git.existBranch(parameters.first, {
      error: true,
      exact: false,
      remote: false,
      spin: true
    })
    if (!branch) {
      return
    }

    // Ask for checkout branch?
    const remoteBranch = await git.existBranch(branch, { remote: true })
    const checkout = await prompt.confirm(
      'Checkout ' + (remoteBranch ? 'remote' : 'local') + ' branch ' + branch
    )
    if (!checkout) {
      return
    }

    // Checkout branch
    await system.run('git checkout master')
    const checkoutSpin = spin('Checkout ' + branch)
    if (remoteBranch) {
      const local = await system.run(`git rev-parse --verify ${branch}`)
      if (branch !== 'master' && local) {
        await system.run(`git branch -D ${branch}`)
      }
      await system.run(
        `git checkout ${branch} && git reset --hard && git clean -fd && git pull`
      )
    } else {
      await system.run(
        `git checkout ${branch} && git reset --hard && git clean -fd`
      )
    }
    checkoutSpin.succeed()

    // Install npm packages
    await npm.install()

    // Success info
    if (remoteBranch) {
      success(
        `Remote branch ${branch} checked out in ${helper.msToMinutesAndSeconds(
          timer()
        )}.`
      )
    } else {
      success(
        `Local branch ${branch} checked out in ${helper.msToMinutesAndSeconds(
          timer()
        )}.`
      )
    }

    info('')

    // For tests
    return `get branch ${branch}`
  }
}

export default NewCommand
