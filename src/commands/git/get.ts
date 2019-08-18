import { GluegunCommand, GluegunToolbox } from 'gluegun'

/**
 * Checkout git branch
 */
const NewCommand: GluegunCommand = {
  name: 'get',
  alias: ['g'],
  description: 'Checkout git branch',
  hidden: false,
  run: async (toolbox: GluegunToolbox) => {
    // Retrieve the tools we need
    const {
      filesystem,
      helper,
      parameters,
      print: { error, info, spin, success },
      prompt,
      system
    } = toolbox

    // Start timer
    const timer = system.startTimer()

    // Git
    const git = !!system.which('git')
    if (!git) {
      error('Please install git')
    }

    // Check changes in current branch
    const changes = await system.run('git status --porcelain')
    if (changes) {
      const reset = await prompt.confirm('There are changes, reset?')
      if (reset) {
        await system.run('git reset --hard && git clean -fd')
      } else {
        return
      }
    }

    // Get branch
    const searchSpin = spin('Search branch')
    let branch = (await system.run(
      `git fetch && git branch -a | grep ${parameters.first} | cut -c 3- | head -1`
    ))
      .replace(/\r?\n|\r/g, '') // replace line breaks
      .replace(/^remotes\/origin\//, '') // replace remote path
      .trim()
    if (branch) {
      searchSpin.succeed()

      // Checkout branch
      const remoteBranch = await system.run(
        `git ls-remote --heads origin ${branch}`
      )
      const checkout = await prompt.confirm(
        'Checkout ' + (remoteBranch ? 'remote' : 'local') + ' branch ' + branch
      )
      if (checkout) {
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
        if (filesystem.exists('package.json')) {
          const npmSpin = spin('Install npm packages')
          await system.run('npm i')
          npmSpin.succeed()
        }

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
      }
    } else {
      searchSpin.fail()
      error(`Branch ${parameters.first} not found!`)
    }
    info('')

    // For tests
    return `new server ${toolbox.parameters.first}`
  }
}

export default NewCommand
