import { ExtendedGluegunToolbox } from '../interfaces/extended-gluegun-toolbox';

/**
 * Result of template setup operation
 */
export interface TemplateSetupResult {
  method: 'clone' | 'copy' | 'link';
  path: string;
  success: boolean;
}

/**
 * Template helper functions for project scaffolding
 * Provides reusable methods for copying, linking, and cloning templates
 * Named TemplateHelper to avoid conflict with Gluegun's built-in template
 */
export class TemplateHelper {
  /**
   * Constructor for integration of toolbox
   */
  constructor(protected toolbox: ExtendedGluegunToolbox) {}

  /**
   * Resolve nuxt-base-template subdirectory if it exists
   * Auto-detects when user specifies repository root instead of template directory
   *
   * @param basePath - The path provided by user
   * @returns Object with resolved path and whether it was adjusted
   */
  public resolveNuxtPath(basePath: string): { path: string; wasAdjusted: boolean } {
    const {
      filesystem,
      print: { info },
    } = this.toolbox;

    const resolvedPath = filesystem.path(basePath);
    const templateSubdir = filesystem.path(resolvedPath, 'nuxt-base-template');

    if (filesystem.isDirectory(templateSubdir)) {
      info(`Auto-detected nuxt-base-template subdirectory, using: ${templateSubdir}`);
      return { path: templateSubdir, wasAdjusted: true };
    }

    return { path: resolvedPath, wasAdjusted: false };
  }

  /**
   * Copy from local template directory
   *
   * @param source - Source template directory path
   * @param dest - Destination directory path
   * @param options - Optional settings
   * @returns TemplateResult with success status
   */
  public async copyLocal(
    source: string,
    dest: string,
    options: { removeGit?: boolean; showInfo?: boolean } = {},
  ): Promise<TemplateSetupResult> {
    const {
      filesystem,
      print: { error, info },
    } = this.toolbox;
    const opts = { removeGit: true, showInfo: true, ...options };

    const templatePath = filesystem.path(source);

    if (!filesystem.isDirectory(templatePath)) {
      error(`Copy source directory not found: ${templatePath}`);
      return { method: 'copy', path: templatePath, success: false };
    }

    filesystem.copy(templatePath, dest, { overwrite: true });

    if (opts.removeGit && filesystem.exists(`${dest}/.git`)) {
      filesystem.remove(`${dest}/.git`);
    }

    if (opts.showInfo) {
      info(`Copied from: ${templatePath}`);
    }

    return { method: 'copy', path: templatePath, success: true };
  }

  /**
   * Create symlink to local template directory
   * Fastest method for testing local template changes
   *
   * @param source - Source template directory path
   * @param dest - Destination symlink path
   * @param options - Optional settings
   * @returns TemplateResult with success status
   */
  public async linkLocal(
    source: string,
    dest: string,
    options: { showInfo?: boolean; showWarning?: boolean } = {},
  ): Promise<TemplateSetupResult> {
    const {
      filesystem,
      print: { error, info },
      system,
    } = this.toolbox;
    const opts = { showInfo: true, showWarning: true, ...options };

    const templatePath = filesystem.path(source);

    if (!filesystem.isDirectory(templatePath)) {
      error(`Link target directory not found: ${templatePath}`);
      return { method: 'link', path: templatePath, success: false };
    }

    try {
      await system.run(`ln -s "${templatePath}" "${dest}"`);

      if (opts.showInfo) {
        info(`Symlinked to: ${templatePath}`);
      }
      if (opts.showWarning) {
        info('Warning: Changes in this directory will affect the original template!');
      }

      return { method: 'link', path: templatePath, success: true };
    } catch (err) {
      error(`Failed to create symlink: ${err.message}`);
      return { method: 'link', path: templatePath, success: false };
    }
  }

  /**
   * Clone from remote git repository
   *
   * @param repoUrl - Git repository URL
   * @param dest - Destination directory path
   * @param options - Optional settings
   * @returns TemplateResult with success status
   */
  public async cloneRemote(
    repoUrl: string,
    dest: string,
    options: { branch?: string; removeGit?: boolean; showInfo?: boolean } = {},
  ): Promise<TemplateSetupResult> {
    const {
      filesystem,
      print: { error, info },
      system,
    } = this.toolbox;
    const opts = { removeGit: true, showInfo: true, ...options };

    const branchArg = opts.branch ? ` -b ${opts.branch}` : '';

    try {
      await system.run(`git clone${branchArg} ${repoUrl} "${dest}"`);

      if (opts.removeGit && filesystem.exists(`${dest}/.git`)) {
        filesystem.remove(`${dest}/.git`);
      }

      if (opts.showInfo && opts.branch) {
        info(`Cloned from ${repoUrl} (branch: ${opts.branch})`);
      }

      return { method: 'clone', path: dest, success: true };
    } catch (err) {
      error(`Failed to clone repository: ${err.message}`);
      return { method: 'clone', path: dest, success: false };
    }
  }

  /**
   * Setup template from either link, copy, or clone
   * Determines the method based on provided options and executes accordingly
   *
   * @param dest - Destination directory path
   * @param options - Configuration options
   * @returns TemplateResult with success status and method used
   */
  public async setup(
    dest: string,
    options: {
      branch?: string;
      copyPath?: string;
      isNuxt?: boolean;
      linkPath?: string;
      repoUrl?: string;
    },
  ): Promise<TemplateSetupResult> {
    let { copyPath, linkPath } = options;
    const { branch, isNuxt, repoUrl } = options;

    // Auto-detect nuxt-base-template subdirectory for Nuxt projects
    if (isNuxt) {
      if (linkPath) {
        const resolved = this.resolveNuxtPath(linkPath);
        linkPath = resolved.path;
      }
      if (copyPath) {
        const resolved = this.resolveNuxtPath(copyPath);
        copyPath = resolved.path;
      }
    }

    // Priority: link > copy > clone
    if (linkPath) {
      return this.linkLocal(linkPath, dest);
    }

    if (copyPath) {
      return this.copyLocal(copyPath, dest);
    }

    if (repoUrl) {
      return this.cloneRemote(repoUrl, dest, { branch });
    }

    // No template source specified
    return { method: 'clone', path: '', success: false };
  }
}

/**
 * Extend toolbox
 */
export default (toolbox: ExtendedGluegunToolbox) => {
  toolbox.templateHelper = new TemplateHelper(toolbox);
};
