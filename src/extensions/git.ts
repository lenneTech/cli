import { ExtendedGluegunToolbox } from '../interfaces/extended-gluegun-toolbox';

/**
 * Git functions
 */
export class Git {
  /**
   * Cached result of gitInstalled check
   */
  private gitInstalledCache: boolean | null = null;

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
      options,
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
        errorMessage: 'Please commit or stash changes!',
        showError: false,
      },
      options,
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
    },
  ) {
    // Process options
    const opts = Object.assign(
      {
        noDiffResult: null,
        otherBranch: `origin/${branch}`,
        showWarning: false,
      },
      options,
    );

    // Toolbox features
    const {
      print: { warning },
      system,
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
      const matches = item.match(/\[(.*?)]/);
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
  public async getMergeBase(baseBranch = 'dev') {
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
  public async getFirstBranchCommit(branch: string, baseBranch?: string): Promise<string> {
    if (!baseBranch) {
      baseBranch = (await this.getDefaultBranch()) || 'dev';
    }
    if (!branch) {
      throw new Error('Missing branch');
    }

    // Toolbox features
    const {
      helper: { trim },
      system: { run },
    } = this.toolbox;

    try {
      const logCommand = `git log ${baseBranch}..${branch} --oneline`;
      const output = await run(logCommand);

      if (!output) {
        throw new Error('No commits found');
      }

      const commits = output.split('\n').filter((line) => line.trim());
      const firstCommit = commits[commits.length - 1];

      const messageStart = firstCommit.indexOf(' ');
      return trim(firstCommit.slice(messageStart + 1));
    } catch (error) {
      throw new Error(`Failed to get first commit message: ${error.message}`);
    }
  }

  /**
   * Get default branch
   */
  public getDefaultBranch(): Promise<string> {
    // Toolbox features
    const {
      system: { run },
    } = this.toolbox;

    return run('basename $(git symbolic-ref --short refs/remotes/origin/HEAD)');
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
   * Check if git is installed (cached for performance)
   */
  public async gitInstalled() {
    // Return cached result if available
    if (this.gitInstalledCache !== null) {
      if (!this.gitInstalledCache) {
        const {
          print: { error },
        } = this.toolbox;
        error('Please install git: https://git-scm.com');
      }
      return this.gitInstalledCache;
    }

    // Toolbox features
    const {
      print: { error },
      system,
    } = this.toolbox;

    const gitInstalled = !!system.which('git');
    this.gitInstalledCache = gitInstalled;

    if (!gitInstalled) {
      error('Please install git: https://git-scm.com');
      return false;
    }

    return true;
  }

  /**
   * Clear the gitInstalled cache (useful for testing)
   */
  public clearCache() {
    this.gitInstalledCache = null;
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
    } = {},
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
      options,
    );

    // Toolbox features
    const {
      helper: { trim },
      print: { error, info, spin },
      system,
    } = this.toolbox;

    // Prepare spinner
    let searchSpin;
    if (opts.spin) {
      searchSpin = spin(opts.spinText);
    }

    // Update infos
    const fetch = await system.run('git fetch');
    if (fetch.length && !fetch.startsWith('remote')) {
      info(`Could not update infos ${fetch.length}`);
      process.exit(1);
    }

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
      branch = (await system.run('git branch -a'))
        .split(/\r?\n/)
        .map((line) => line.trim())
        .find((line) => line.includes(branch))
        ?.replace(/^.*origin\//, '')
        .replace(/^.*github\//, '')
        .replace(/^\* /, '')
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
        defaultBranch: 'dev',
        text: 'Select branch',
      },
      options,
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
      choices: branches,
      message: opts.text,
      name: 'branch',
      type: 'select',
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

  /**
   * Display dry-run information for git operations
   * Shows what changes would be affected without making changes
   *
   * @param options - Configuration options
   * @returns Formatted dry-run result string or null if no changes
   */
  public async showDryRunInfo(options: { branch?: string; operation: string }): Promise<null | string> {
    const { branch, operation } = options;
    const {
      print: { info, warning },
      system: { run },
    } = this.toolbox;

    warning('DRY-RUN MODE - No changes will be made');
    info('');

    const status = await run('git status --porcelain');
    if (!status?.trim()) {
      info('No changes to process.');
      return null;
    }

    const lines = status.trim().split('\n');
    const modified = lines.filter((l) => l.startsWith(' M') || l.startsWith('M ')).length;
    const added = lines.filter((l) => l.startsWith('A ') || l.startsWith('??')).length;
    const deleted = lines.filter((l) => l.startsWith(' D') || l.startsWith('D ')).length;

    const branchInfo = branch ? ` on branch "${branch}"` : '';
    info(`Would ${operation}${branchInfo}:`);
    if (modified > 0) info(`  - ${modified} modified file(s)`);
    if (added > 0) info(`  - ${added} untracked/added file(s)`);
    if (deleted > 0) info(`  - ${deleted} deleted file(s)`);
    info('');
    info('Files:');
    lines.forEach((line) => info(`  ${line}`));

    return `dry-run ${operation} ${branch || ''}`.trim();
  }
}

/**
 * Extend toolbox
 */
export default (toolbox: ExtendedGluegunToolbox) => {
  toolbox.git = new Git(toolbox);
};
