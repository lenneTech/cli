/**
 * Configuration for lenne.tech CLI
 * Can be stored in lt.config.json in project root or parent directories
 */
export interface LtConfig {
  /**
   * Command-specific configuration
   */
  commands?: {
    /**
     * Fullstack-related configuration
     */
    fullstack?: {
      /**
       * Default frontend framework
       */
      frontend?: 'angular' | 'nuxt';
      /**
       * Initialize git by default
       */
      git?: boolean;
    };

    /**
     * Git-related configuration
     */
    git?: {
      /**
       * Default branch name for new repositories
       */
      defaultBranch?: string;
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
       * Configuration for 'lt server module' command
       */
      module?: {
        /**
         * Default controller type for new modules
         * @example "Rest" | "GraphQL" | "Both" | "auto"
         */
        controller?: 'auto' | 'Both' | 'GraphQL' | 'Rest';
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
     * Configuration file version
     */
    version?: string;
  };
}
