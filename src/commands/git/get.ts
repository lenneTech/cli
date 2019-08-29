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
    branch = await git.getBranch(parameters.first, {
      error: true,
      exact: false,
      remote: false,
      spin: true
    })
    if (!branch) {
      return
    }

    // Get branches
    const remoteBranch = await git.getBranch(branch, { remote: true })
    const local = await git.getBranch(branch)

    // Ask for checkout branch?
    if (
      !parameters.options.noConfirm &&
      !(await prompt.confirm(
        'Checkout ' + (remoteBranch ? 'remote' : 'local') + ' branch ' + branch
      ))
    ) {
      return
    }

    // Checkout branch
    await system.run('git checkout master')
    let checkoutSpin

    // Handling for remote
    if (remoteBranch) {
      // Delete local
      const checkSpin = spin('Check status')
      if (branch !== 'master' && local && (await git.diffFiles(local)).length) {
        checkSpin.succeed()
        let mode = parameters.options.mode
        if (!mode) {
          if (await prompt.confirm(`Remove local commits of ${branch}`)) {
            mode = 'hard'
          }
        }
        if (mode === 'hard') {
          const prepareSpin = spin('Refresh ' + branch)
          await system.run(`git branch -D ${branch}`)
          prepareSpin.succeed()
        }
      } else {
        checkSpin.succeed()
      }

      // Start spin
      checkoutSpin = spin('Checkout ' + branch)

      // Checkout
      await system.run(
        `git fetch && git checkout ${branch} && git reset --hard && git clean -fd && git pull`
      )

      // Handling for local only
    } else if (local) {
      checkoutSpin = spin('Checkout ' + branch)
      await system.run(
        `git fetch && git checkout ${branch} && git reset --hard && git clean -fd`
      )

      // No branch found
    } else {
      error(`Branch ${branch} not found!`)
      return
    }
    checkoutSpin.succeed()

    // Install npm packages
    await npm.install()

    // Success info
    success(
      `${
        remoteBranch ? 'Remote' : 'Local'
      } branch ${branch} checked out in ${helper.msToMinutesAndSeconds(
        timer()
      )}m.`
    )
    info('')

    // For tests
    return `get branch ${branch}`
  }
}

export default NewCommand
