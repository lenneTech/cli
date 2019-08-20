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

    // Check changes in current branch
    if (!(await git.askForReset())) {
      return
    }

    // Get current branch
    const branch = await git.currentBranch()

    // Get new name
    const name = parameters.first

    // Check branch
    if (branch === 'master' || branch === 'release' || branch === 'develop') {
      error(`Rename branch ${branch} is not allowed!`)
      return
    }

    // Check for changes
    if (await git.changes()) {
      error('Please commit changes before renaming the branch.')
      return
    }

    // Check name
    if (await git.existBranch(name, { exact: true })) {
      error(`Rename branch ${branch} already exists`)
      return
    }

    // Ask to rename branch
    if (!(await confirm(`Rename branch ${branch} into ${name}?`))) {
      return
    }

    // Start timer
    let timer = startTimer()

    // Rename branch
    const renameSpin = spin(`Rename ${branch} into ${name}`)
    await run(`git branch -m ${name} && git push origin ${name}`)
    renameSpin.succeed()

    // Save time
    let time = timer()

    // Ask to delete remote branch
    if (await confirm(`Delete remote branch ${branch}?`)) {
      timer = startTimer()
      const deleteSpin = spin(`Delete remote branch ${branch}`)
      await run(`git push origin :${branch}`)
      deleteSpin.succeed()
      time += timer()
    }

    // Success
    success(
      `Renamed ${branch} to ${name} in ${helper.msToMinutesAndSeconds(time)}.`
    )
    info('')

    // For tests
    return `renamed ${branch} to ${name}`
  }
}

export default NewCommand
