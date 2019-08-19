import { GluegunToolbox } from 'gluegun'

/**
 * Git functions
 */
export class Git {
  /**
   * Constructor for integration of toolbox
   */
  constructor(protected toolbox: GluegunToolbox) {}

  /**
   * Ask for reset
   */
  public async askForReset(options: { text?: string } = {}) {
    // Process options
    const opts = Object.assign(
      {
        text: 'There are changes, reset?'
      },
      options
    )

    // Toolbox features
    const { prompt, system } = this.toolbox

    // Check changes in current branch
    const changes = await system.run('git status --porcelain')
    if (changes) {
      const reset = await prompt.confirm(opts.text)
      if (!reset) {
        return false
      }
      await system.run('git reset --hard && git clean -fd')
    }

    // Return changes
    return true
  }

  /**
   * Get branches
   */
  public async getBranches() {
    // Prepare results
    const result = []

    // Toolbox features
    const { system } = this.toolbox

    // Get branches
    const branches = await system.run('git fetch && git show-branch --list')
    branches.split('\n').forEach(item => {
      const matches = item.match(/\[(.*?)\]/)
      if (matches) {
        result.push(matches[1])
      }
    })

    // Return result
    return result
  }

  /**
   * Check if git is installed
   */
  public async gitInstalled() {
    // Toolbox features
    const {
      print: { error },
      system
    } = this.toolbox

    const gitInstalled = !!system.which('git')
    if (!gitInstalled) {
      error('Please install git')
      return false
    }

    return true
  }

  /**
   * Check if branch exists
   */
  public async existBranch(
    branch: string,
    options: {
      error?: boolean // show error via print.error
      errorText?: string // text for error shown via print.error
      exact?: boolean // exact branch name or included branch name
      remote?: boolean // must the branch exist remotely
      spin?: boolean // show spinner
      spinText?: string // text of spinner
    } = {}
  ) {
    // Check branch
    if (!branch) {
      return
    }

    // Process options
    const opts = Object.assign(
      {
        error: false,
        errorText: `Branch ${branch} not found!`,
        exact: true,
        remote: false,
        spin: false,
        spinText: 'Search branch'
      },
      options
    )

    // Toolbox features
    const {
      print: { error, spin },
      system
    } = this.toolbox

    // Prepare spinner
    let searchSpin
    if (opts.spin) {
      searchSpin = spin(opts.spinText)
    }

    // Search branch
    if (opts.exact) {
      if (opts.remote) {
        branch = await system.run(`git ls-remote --heads origin ${branch}`)
      } else {
        branch = await system.run(`git rev-parse --verify ${branch}`)
      }
    } else {
      branch = (await system.run(
        `git fetch && git branch -a | grep ${branch} | cut -c 3- | head -1`
      ))
        .replace(/\r?\n|\r/g, '') // replace line breaks
        .replace(/^remotes\/origin\//, '') // replace remote path
        .trim()
    }
    if (!branch) {
      if (opts.spin) {
        searchSpin.fail()
      }
      if (opts.error) {
        error(opts.errorText)
      }
      return
    }

    // End spinner
    if (opts.spin) {
      searchSpin.succeed()
    }

    // Check remote, if not done before
    if (opts.remote && !opts.exact) {
      const remoteBranch = await system.run(
        `git ls-remote --heads origin ${branch}`
      )
      if (!remoteBranch) {
        return
      }
    }

    // Return branch
    return branch
  }

  /**
   * Select a branch
   */
  public async selectBranch(
    options: { defaultBranch?: string; text?: string } = {}
  ) {
    // Process options
    const opts = Object.assign(
      {
        defaultBranch: 'develop',
        text: 'Select branch'
      },
      options
    )

    // Toolbox features
    const {
      prompt: { ask }
    } = this.toolbox

    // Get branches
    let branches = await this.getBranches()
    if (!branches || branches.length === 0) {
      return
    }

    // Check default branch
    if (!branches.includes(opts.defaultBranch) && branches.includes('master')) {
      opts.defaultBranch = 'master'
    }

    // Prepare branches
    if (branches.includes(opts.defaultBranch)) {
      branches = [opts.defaultBranch].concat(
        branches.filter(item => item !== opts.defaultBranch)
      )
    }

    // Select branch
    const { branch } = await ask({
      type: 'select',
      name: 'branch',
      message: 'Select branch',
      choices: branches
    })

    // Return selected branch
    return branch
  }
}

/**
 * Extend toolbox
 */
export default (toolbox: GluegunToolbox) => {
  toolbox.git = new Git(toolbox)
}
