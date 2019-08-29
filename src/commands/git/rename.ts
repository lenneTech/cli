import { GluegunCommand } from 'gluegun'
import { ExtendedGluegunToolbox } from '../../interfaces/extended-gluegun-toolbox'

/**
 * Rename branch
 */
const NewCommand: GluegunCommand = {
  name: 'rename',
  alias: ['rn'],
  description: 'Rename branch',
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

    // Get new name
    const name = await helper.getInput(parameters.first, {
      name: 'new name',
      showError: true
    })
    if (!branch) {
      return
    }

    // Check branch
    if (branch === 'master' || branch === 'release' || branch === 'develop') {
      error(`Rename branch ${branch} is not allowed!`)
      return
    }

    // Check name
    if (await git.getBranch(name, { exact: true })) {
      error(`Branch with name ${name} already exists`)
      return
    }

    // Ask to rename branch
    if (
      !parameters.options.noConfirm &&
      !(await confirm(`Rename branch ${branch} into ${name}?`))
    ) {
      return
    }

    // Start timer
    let timer = startTimer()

    // Get remote
    const remote = await git.getBranch(name, { exact: true, remote: true })

    // Rename branch
    const renameSpin = spin(`Rename ${branch} into ${name}`)
    await run(`git branch -m ${name}`)

    // Ask to push branch
    if (
      remote &&
      (parameters.options.noConfirm ||
        (await confirm(`Push ${name} to remote?`)))
    ) {
      await run(`git push origin ${name}`)
    }
    renameSpin.succeed()

    // Save time
    let time = timer()

    // Ask to delete remote branch
    if (
      remote &&
      (parameters.options.deleteRemote ||
        (!parameters.options.noConfirm &&
          (await confirm(`Delete remote branch ${branch}?`))))
    ) {
      timer = startTimer()
      const deleteSpin = spin(`Delete remote branch ${branch}`)
      await run(`git push origin :${branch}`)
      deleteSpin.succeed()
      time += timer()
    }

    // Success
    success(
      `Renamed ${branch} to ${name} in ${helper.msToMinutesAndSeconds(time)}m.`
    )
    info('')

    // For tests
    return `renamed ${branch} to ${name}`
  }
}

export default NewCommand
