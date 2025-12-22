/**
 * Configuration for lenne.tech CLI
 * Can be stored in lt.config, lt.config.json, or lt.config.yaml in project root or parent directories
 *
 * Supported file formats (in priority order):
 * 1. lt.config.json - explicit JSON format
 * 2. lt.config.yaml - explicit YAML format
 * 3. lt.config - auto-detected format (tries JSON first, then YAML)
 *
 * Configuration files are searched from the current directory up to the root.
 * Configurations are merged hierarchically, with closer configs taking precedence.
 *
 * Priority (lowest to highest):
 * 1. Code default values
 * 2. Global defaults (from 'defaults' section)
 * 3. Config from parent directories
 * 4. Config from current directory (commands section)
 * 5. CLI parameters
 * 6. Interactive user input
 */
export interface LtConfig {
  /**
   * Command-specific configuration
   */
  commands?: {
    /**
     * Blocks-related configuration
     */
    blocks?: {
      /**
       * Configuration for 'lt blocks add' command
       */
      add?: {
        /**
         * Skip confirmation prompts when adding blocks
         */
        noConfirm?: boolean;
      };
    };

    /**
     * CLI-related configuration
     */
    cli?: {
      /**
       * Configuration for 'lt cli create' command
       */
      create?: {
        /**
         * Default author for new CLI projects
         * @example "John Doe <john@example.com>"
         */
        author?: string;

        /**
         * Link the CLI after creation
         */
        link?: boolean;

        /**
         * Skip confirmation prompts
         */
        noConfirm?: boolean;
      };
    };

    /**
     * Components-related configuration
     */
    components?: {
      /**
       * Configuration for 'lt components add' command
       */
      add?: {
        /**
         * Skip confirmation prompts when adding components
         */
        noConfirm?: boolean;
      };
    };

    /**
     * Config command configuration
     */
    config?: {
      /**
       * Configuration for 'lt config init' command
       */
      init?: {
        /**
         * Skip confirmation prompts when initializing config
         */
        noConfirm?: boolean;
      };
    };

    /**
     * Deployment-related configuration for 'lt deployment create'
     */
    deployment?: {
      /**
       * Default domain for deployments
       * @example "myproject.lenne.tech"
       */
      domain?: string;

      /**
       * Enable GitHub pipeline by default
       */
      gitHub?: boolean;

      /**
       * Enable GitLab pipeline by default
       */
      gitLab?: boolean;

      /**
       * Skip confirmation prompts
       */
      noConfirm?: boolean;

      /**
       * Default GitLab production runner tag
       * @example "docker-landing"
       */
      prodRunner?: string;

      /**
       * Default GitLab test runner tag
       * @example "docker-swarm"
       */
      testRunner?: string;
    };

    /**
     * Frontend-related configuration
     */
    frontend?: {
      /**
       * Configuration for 'lt frontend angular' command
       */
      angular?: {
        /**
         * Branch of ng-base-starter to use as template
         * @example "feature/new-auth"
         */
        branch?: string;

        /**
         * Path to local template directory to copy instead of cloning
         * @example "/path/to/local/ng-base-starter"
         */
        copy?: string;

        /**
         * Path to local template directory to symlink instead of cloning
         * Fastest option for testing local changes (changes affect original)
         * @example "/path/to/local/ng-base-starter"
         */
        link?: string;

        /**
         * Enable Angular localize by default
         */
        localize?: boolean;

        /**
         * Skip confirmation prompts
         */
        noConfirm?: boolean;
      };

      /**
       * Configuration for 'lt frontend nuxt' command
       */
      nuxt?: {
        /**
         * Branch of nuxt-base-starter to use as template
         * When specified, uses git clone instead of create-nuxt-base
         * @example "feature/new-auth"
         */
        branch?: string;

        /**
         * Path to local template directory to copy instead of cloning
         * @example "/path/to/local/nuxt-base-starter"
         */
        copy?: string;

        /**
         * Path to local template directory to symlink instead of cloning
         * Fastest option for testing local changes (changes affect original)
         * @example "/path/to/local/nuxt-base-starter"
         */
        link?: string;
      };
    };

    /**
     * Fullstack-related configuration for 'lt fullstack init'
     */
    fullstack?: {
      /**
       * Branch of nest-server-starter to use for API
       * @example "feature/new-auth"
       */
      apiBranch?: string;

      /**
       * Path to local API template directory to copy instead of cloning
       * @example "/path/to/local/nest-server-starter"
       */
      apiCopy?: string;

      /**
       * Path to local API template directory to symlink instead of cloning
       * Fastest option for testing local changes (changes affect original)
       * @example "/path/to/local/nest-server-starter"
       */
      apiLink?: string;

      /**
       * Default frontend framework
       * @example "angular" | "nuxt"
       */
      frontend?: 'angular' | 'nuxt';

      /**
       * Branch of frontend starter to use (ng-base-starter or nuxt-base-starter)
       * @example "feature/new-design"
       */
      frontendBranch?: string;

      /**
       * Path to local frontend template directory to copy instead of cloning
       * @example "/path/to/local/ng-base-starter"
       */
      frontendCopy?: string;

      /**
       * Path to local frontend template directory to symlink instead of cloning
       * Fastest option for testing local changes (changes affect original)
       * @example "/path/to/local/ng-base-starter"
       */
      frontendLink?: string;

      /**
       * Initialize git by default
       */
      git?: boolean;

      /**
       * Default git repository link
       * Only used when git is true
       */
      gitLink?: string;

      /**
       * Skip confirmation prompts
       */
      noConfirm?: boolean;
    };

    /**
     * Git-related configuration
     */
    git?: {
      /**
       * Default base branch for new feature branches
       * Used in 'lt git create'
       * @example "develop"
       */
      baseBranch?: string;

      /**
       * Configuration for 'lt git clean' command
       */
      clean?: {
        /**
         * Skip confirmation prompts when cleaning merged branches
         */
        noConfirm?: boolean;
      };

      /**
       * Configuration for 'lt git clear' command
       */
      clear?: {
        /**
         * Skip confirmation prompts when clearing changes
         */
        noConfirm?: boolean;
      };

      /**
       * Configuration for 'lt git create' command
       */
      create?: {
        /**
         * Default base branch for new feature branches
         * Overrides git.baseBranch for this specific command
         * @example "develop"
         */
        base?: string;

        /**
         * Skip confirmation prompts when creating branches
         */
        noConfirm?: boolean;
      };

      /**
       * Default branch name for new repositories
       * @example "main" | "develop"
       */
      defaultBranch?: string;

      /**
       * Configuration for 'lt git force-pull' command
       */
      forcePull?: {
        /**
         * Skip confirmation prompts when force pulling
         */
        noConfirm?: boolean;
      };

      /**
       * Configuration for 'lt git get' command
       */
      get?: {
        /**
         * Default mode for handling local commits
         * 'hard' will delete local commits without asking
         * @example "hard"
         */
        mode?: 'hard';

        /**
         * Skip confirmation prompts when checking out branches
         */
        noConfirm?: boolean;
      };

      /**
       * Skip confirmation prompts
       */
      noConfirm?: boolean;

      /**
       * Configuration for 'lt git rebase' command
       */
      rebase?: {
        /**
         * Default base branch for rebase operations
         * @example "dev" | "develop" | "main"
         */
        base?: string;

        /**
         * Skip confirmation prompts during rebase
         */
        noConfirm?: boolean;
      };

      /**
       * Configuration for 'lt git rename' command
       */
      rename?: {
        /**
         * Skip confirmation prompts when renaming branches
         */
        noConfirm?: boolean;
      };

      /**
       * Configuration for 'lt git reset' command
       */
      reset?: {
        /**
         * Skip confirmation prompts when resetting
         */
        noConfirm?: boolean;
      };

      /**
       * Configuration for 'lt git squash' command
       */
      squash?: {
        /**
         * Default author for squash commits
         * @example "John Doe <john@example.com>"
         */
        author?: string;

        /**
         * Default base branch for squash operations
         * @example "dev" | "develop" | "main"
         */
        base?: string;

        /**
         * Skip confirmation prompts during squash
         */
        noConfirm?: boolean;
      };

      /**
       * Configuration for 'lt git undo' command
       */
      undo?: {
        /**
         * Skip confirmation prompts when undoing commits
         */
        noConfirm?: boolean;
      };

      /**
       * Configuration for 'lt git update' command
       */
      update?: {
        /**
         * Skip npm install after update
         */
        skipInstall?: boolean;
      };
    };

    /**
     * NPM-related configuration
     */
    npm?: {
      /**
       * Configuration for 'lt npm reinit'
       */
      reinit?: {
        /**
         * Skip confirmation prompts
         */
        noConfirm?: boolean;

        /**
         * Update package.json before reinitializing
         */
        update?: boolean;
      };

    };

    /**
     * Server-related configuration
     */
    server?: {
      /**
       * Configuration for 'lt server addProp' command
       */
      addProp?: {
        /**
         * Skip lint after adding property
         */
        skipLint?: boolean;
      };

      /**
       * Configuration for 'lt server create' command
       */
      create?: {
        /**
         * Default author for new server projects
         * @example "John Doe <john@example.com>"
         */
        author?: string;

        /**
         * Branch of nest-server-starter to use as template
         * @example "feature/new-auth"
         */
        branch?: string;

        /**
         * Default controller type for new server projects
         * @example "Rest" | "GraphQL" | "Both" | "auto"
         */
        controller?: 'auto' | 'Both' | 'GraphQL' | 'Rest';

        /**
         * Path to local template directory to copy instead of cloning
         * @example "/path/to/local/nest-server-starter"
         */
        copy?: string;

        /**
         * Default description for new server projects
         */
        description?: string;

        /**
         * Initialize git for new server projects
         */
        git?: boolean;

        /**
         * Path to local template directory to symlink instead of cloning
         * Fastest option for testing local changes (changes affect original)
         * @example "/path/to/local/nest-server-starter"
         */
        link?: string;

        /**
         * Skip confirmation prompts
         */
        noConfirm?: boolean;
      };

      /**
       * Configuration for 'lt server module' command
       */
      module?: {
        /**
         * Default controller type for new modules
         * @example "Rest" | "GraphQL" | "Both" | "auto"
         */
        controller?: 'auto' | 'Both' | 'GraphQL' | 'Rest';

        /**
         * Skip confirmation prompts
         */
        noConfirm?: boolean;

        /**
         * Skip lint after module creation
         */
        skipLint?: boolean;
      };

      /**
       * Configuration for 'lt server object' command
       */
      object?: {
        /**
         * Skip lint after object creation
         */
        skipLint?: boolean;
      };
    };

    /**
     * TypeScript-related configuration
     */
    typescript?: {
      /**
       * Configuration for 'lt typescript create' command
       */
      create?: {
        /**
         * Default author for new TypeScript projects
         * @example "John Doe <john@example.com>"
         */
        author?: string;

        /**
         * Skip confirmation prompts
         */
        noConfirm?: boolean;

        /**
         * Update packages to latest versions during creation
         */
        updatePackages?: boolean;
      };
    };
  };
  /**
   * Global default settings that apply across multiple commands
   * These are overridden by command-specific settings in the 'commands' section
   */
  defaults?: {
    /**
     * Default author for commits and project creation
     * Used by: git/squash, server/create, cli/create
     * @example "John Doe <john@example.com>"
     */
    author?: string;

    /**
     * Default base branch for git operations
     * Used by: git/create, git/squash, git/rebase
     * @example "develop"
     */
    baseBranch?: string;

    /**
     * Default controller type for server modules and projects
     * Used by: server/module, server/create
     * @example "Rest" | "GraphQL" | "Both" | "auto"
     */
    controller?: 'auto' | 'Both' | 'GraphQL' | 'Rest';

    /**
     * Default domain pattern for deployments
     * Use {name} as placeholder for project name
     * Used by: deployment/create
     * @example "{name}.lenne.tech"
     */
    domain?: string;

    /**
     * Skip confirmation prompts globally
     * Used by: blocks/add, components/add, config/init, git/get, git/squash, git/create, git/clear, git/force-pull, git/rebase, git/rename, git/reset, git/undo, npm/reinit
     */
    noConfirm?: boolean;

    /**
     * Skip npm install operations globally
     * Used by: git/update
     */
    skipInstall?: boolean;

    /**
     * Skip lint operations globally
     * Used by: server/module, server/object, server/addProp
     */
    skipLint?: boolean;
  };

  /**
   * Metadata for the configuration file and project
   */
  meta?: {
    /**
     * Any additional metadata
     */
    [key: string]: any;

    /**
     * Project description
     */
    description?: string;

    /**
     * Project name
     */
    name?: string;

    /**
     * Tags for categorization
     */
    tags?: string[];

    /**
     * Configuration file version
     */
    version?: string;
  };
}
