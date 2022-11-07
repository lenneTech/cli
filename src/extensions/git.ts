import { ExtendedGluegunToolbox } from '../interfaces/extended-gluegun-toolbox';

/**
 * Git functions
 */
export class Git {
  /**
   * Constructor for integration of toolbox
   */
  constructor(protected toolbox: ExtendedGluegunToolbox) {}

  /**
   * Ask for reset
   */
  public async askForReset(options: { errorMessage?: string; showError?: boolean; text?: string } = {}) {
    // Process options
    const opts = Object.assign(
      {
        errorMessage: 'Please commit or stash changes!',
        showError: false,
        text: 'There are changes, reset?',
      },
      options
    );

    // Toolbox features
    const {
      print: { error },
      prompt,
      system,
    } = this.toolbox;

    // Check changes in current branch
    const changes = await system.run('git status --porcelain');
    if (changes) {
      const reset = await prompt.confirm(opts.text);
      if (!reset) {
        if (opts.showError) {
          error(opts.errorMessage);
        }
        return false;
      }
      await system.run('git reset --hard && git clean -fd');
    }

    // Return changes
    return true;
  }

  /**
   * Check if current branch has changes
   */
  public async changes(options?: { errorMessage?: string; showError?: boolean }) {
    // Process options
    const opts = Object.assign(
      {
        showError: false,
        errorMessage: 'Please commit or stash changes!',
      },
      options
    );

    // Toolbox features
    const {
      print: { error },
      system,
    } = this.toolbox;

    // Check changes
    const changes = await system.run('git status --porcelain');
    if (changes && opts.showError) {
      error(opts.errorMessage);
    }
    return changes;
  }

  /**
   * Get current branch
   */
  public async currentBranch() {
    // Toolbox features
    const {
      helper: { trim },
      system,
    } = this.toolbox;
    return trim(await system.run('git rev-parse --abbrev-ref HEAD'));
  }

  /**
   * Get all relative files paths of files that differ between local branch and origin / other branch
   */
  public async diffFiles(
    branch: string,
    options?: {
      noDiffResult?: string;
      otherBranch?: string;
      showWarning?: boolean;
    }
  ) {
    // Process options
    const opts = Object.assign(
      {
        noDiffResult: null,
        otherBranch: `origin/${branch}`,
        showWarning: false,
      },
      options
    );

    // Toolbox features
    const {
      system,
      print: { warning },
    } = this.toolbox;

    // Get diff
    try {
      const diff = await system.run(`git --no-pager diff --name-only ${branch} ${opts.otherBranch}`);
      // Return relative file paths as array
      return diff.split(/\r?\n/).filter((item) => item);
    } catch (error) {
      if (opts.showWarning) {
        warning('Branch diff could not be performed!');
      }
      return opts.noDiffResult;
    }
  }

  /**
   * Get branches
   */
  public async getBranches() {
    // Prepare results
    const result = [];

    // Toolbox features
    const { system } = this.toolbox;

    // Get branches
    const branches = await system.run('git fetch && git show-branch --list');
    branches.split('\n').forEach((item) => {
      const matches = item.match(/\[(.*?)\]/);
      if (matches) {
        result.push(matches[1]);
      }
    });

    // Return result
    return result;
  }

  /**
   * Get merge base
   */
  public async getMergeBase(baseBranch = 'develop') {
    // Toolbox features
    const {
      helper: { trim },
      system: { run },
    } = this.toolbox;

    return trim(await run(`git merge-base HEAD ${baseBranch}`));
  }

  /**
   * Get first commit messages from branch
   */
  public async getFirstBranchCommit(branch: string, baseBranch: string) {
    if (!baseBranch) {
      baseBranch = (await this.getDefaultBranch()) || 'develop';
    }
    if (!branch) {
      throw new Error(`Missing branch`);
    }

    // Toolbox features
    const {
      helper: { trim },
      system: { run },
    } = this.toolbox;

    const message = await run(`git log ${baseBranch}..${branch} --oneline | tail -1`);
    const splitted = message.split(' ');
    splitted.shift();
    return trim(splitted.join(' '));
  }

  /**
   * Get default branch
   */
  public getDefaultBranch(): Promise<string> {
    // Toolbox features
    const {
      system: { run },
    } = this.toolbox;

    return run(`basename $(git symbolic-ref --short refs/remotes/origin/HEAD)`);
  }

  /**
   * Get git user
   */
  public async getUser() {
    // Toolbox features
    const {
      helper: { trim },
      system: { run },
    } = this.toolbox;

    // Get data
    const user: { email: string; name: string } = {
      email: trim(await run('git config user.email')),
      name: trim(await run('git config user.name')),
    };

    // Return user
    return user;
  }

  /**
   * Check if git is installed
   */
  public async gitInstalled() {
    // Toolbox features
    const {
      print: { error },
      system,
    } = this.toolbox;

    const gitInstalled = !!system.which('git');
    if (!gitInstalled) {
      error('Please install git: https://git-scm.com');
      return false;
    }

    return true;
  }

  /**
   * Get name of a branch
   */
  public async getBranch(
    branch: string,
    options: {
      error?: boolean; // show error via print.error
      errorText?: string; // text for error shown via print.error
      exact?: boolean; // exact branch name or included branch name
      local?: boolean; // must the branch exist local
      remote?: boolean; // must the branch exist remotely
      spin?: boolean; // show spinner
      spinText?: string; // text of spinner
    } = {}
  ) {
    // Check branch
    if (!branch) {
      return;
    }

    // Process options
    const opts = Object.assign(
      {
        error: false,
        errorText: `Branch ${branch} not found!`,
        exact: true,
        local: false,
        remote: false,
        spin: false,
        spinText: 'Search branch',
      },
      options
    );

    // Toolbox features
    const {
      helper: { trim },
      print: { error, spin },
      system,
    } = this.toolbox;

    // Prepare spinner
    let searchSpin;
    if (opts.spin) {
      searchSpin = spin(opts.spinText);
    }

    // Update infos
    await system.run(`git fetch`);

    // Search branch
    if (opts.exact) {
      if (opts.remote) {
        if (!(await system.run(`git ls-remote --heads origin ${branch}`))) {
          branch = null;
        }
      } else {
        try {
          await system.run(`git rev-parse --verify ${branch}`);
        } catch (e) {
          branch = null;
        }
      }
    } else {
      branch = (await system.run(`git branch -a | grep ${branch} | cut -c 3- | head -1`))
        .replace(/\r?\n|\r/g, '') // remove line breaks
        .replace(/^.*origin\//, '') // remove remote path
        .replace(/^.*github\//, '') // remove remote path
        .trim();
    }
    if (!branch) {
      if (opts.spin) {
        searchSpin.fail();
      }
      if (opts.error) {
        error(opts.errorText);
      }
      return;
    }

    // Trim branch
    branch = trim(branch);

    // Check remote, if not done before
    if (opts.remote && !opts.exact) {
      const remoteBranch = trim(await system.run(`git ls-remote --heads origin ${branch}`));
      if (!remoteBranch) {
        if (opts.spin) {
          searchSpin.fail();
        }
        if (opts.error) {
          error(opts.errorText);
        }
        return;
      }
    }

    // Check local
    if (opts.local) {
      const remoteBranch = trim(await system.run(`git rev-parse --verify --quiet ${branch}`));
      if (!remoteBranch) {
        if (opts.spin) {
          searchSpin.fail();
        }
        if (opts.error) {
          error(opts.errorText);
        }
        return;
      }
    }

    // End spinner
    if (opts.spin) {
      searchSpin.succeed();
    }

    // Return branch name
    return branch;
  }

  /**
   * Get last commit from current branch
   */
  public async lastCommitMessage() {
    // Toolbox features
    const {
      helper: { trim },
      system: { run },
    } = this.toolbox;

    return trim(await run('git show-branch --no-name HEAD'));
  }

  /**
   * Reset branch
   */
  public reset(mergeBase: string, soft = false) {
    // Toolbox features
    const {
      system: { run },
    } = this.toolbox;
    return run(soft ? `git reset --soft ${mergeBase}` : `git reset ${mergeBase}`);
  }

  /**
   * Select a branch
   */
  public async selectBranch(options: { defaultBranch?: string; text?: string } = {}) {
    // Process options
    const opts = Object.assign(
      {
        defaultBranch: 'develop',
        text: 'Select branch',
      },
      options
    );

    // Toolbox features
    const {
      prompt: { ask },
    } = this.toolbox;

    // Get branches
    let branches = await this.getBranches();
    if (!branches || branches.length === 0) {
      return;
    }

    // Check default branch
    if (!branches.includes(opts.defaultBranch) && branches.includes('main')) {
      opts.defaultBranch = 'main';
    }

    // Prepare branches
    if (branches.includes(opts.defaultBranch)) {
      branches = [opts.defaultBranch].concat(branches.filter((item) => item !== opts.defaultBranch));
    }

    // Select branch
    const { branch } = await ask({
      type: 'select',
      name: 'branch',
      message: opts.text,
      choices: branches,
    });

    // Return selected branch
    return branch;
  }

  /**
   * Get status
   */
  public status() {
    // Toolbox features
    const {
      system: { run },
    } = this.toolbox;
    return run('git status');
  }
}

/**
 * Extend toolbox
 */
export default (toolbox: ExtendedGluegunToolbox) => {
  toolbox.git = new Git(toolbox);
};
