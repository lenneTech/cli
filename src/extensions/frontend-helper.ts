import { ExtendedGluegunToolbox } from '../interfaces/extended-gluegun-toolbox';

/**
 * Options for Angular frontend setup
 */
export interface AngularSetupOptions {
  branch?: string;
  copyPath?: string;
  gitLink?: string;
  linkPath?: string;
  localize?: boolean;
  skipGitInit?: boolean;
  skipHuskyRemoval?: boolean;
  skipInstall?: boolean;
}

/**
 * Result of frontend setup operation
 */
export interface FrontendSetupResult {
  method: 'clone' | 'copy' | 'link' | 'npx';
  path: string;
  success: boolean;
}

/**
 * Options for Nuxt frontend setup
 */
export interface NuxtSetupOptions {
  branch?: string;
  copyPath?: string;
  linkPath?: string;
  skipInstall?: boolean;
}

/**
 * Frontend helper functions for project scaffolding
 * Provides reusable methods for setting up Nuxt and Angular frontends
 */
export class FrontendHelper {
  /**
   * Constructor for integration of toolbox
   */
  constructor(protected toolbox: ExtendedGluegunToolbox) {}

  /**
   * Fix package name in package.json
   * Changes the name to "app" which is a valid npm package name for monorepos
   *
   * @param dest - Directory containing the package.json
   */
  private async fixPackageName(dest: string): Promise<void> {
    const { patching } = this.toolbox;
    await patching.update(`${dest}/package.json`, (data: Record<string, unknown>) => {
      data.name = 'app';
      return data;
    });
  }

  /**
   * Setup Nuxt frontend
   * Handles template setup (link/copy/clone) and optional npm install
   *
   * @param dest - Destination directory path
   * @param options - Setup options
   * @returns FrontendSetupResult with success status
   */
  public async setupNuxt(dest: string, options: NuxtSetupOptions = {}): Promise<FrontendSetupResult> {
    const { system, templateHelper } = this.toolbox;
    const { branch, copyPath, linkPath, skipInstall } = options;

    // Use template extension for link/copy/branch operations
    if (linkPath || copyPath || branch) {
      const result = await templateHelper.setup(dest, {
        branch,
        copyPath,
        isNuxt: true,
        linkPath,
        repoUrl: branch ? 'https://github.com/lenneTech/nuxt-base-starter.git' : undefined,
      });

      if (!result.success) {
        return { method: result.method, path: result.path, success: false };
      }

      // Run install if not skipped and not a symlink
      if (!skipInstall && result.method !== 'link') {
        try {
          const { pm } = this.toolbox;
          await system.run(`cd "${dest}" && ${pm.install(pm.detect(dest))}`);
        } catch (err) {
          return { method: result.method, path: dest, success: false };
        }
      }

      return { method: result.method, path: result.path, success: true };
    }

    // Default: use create-nuxt-base
    try {
      const { pm } = this.toolbox;
      await system.run(pm.exec(`create-nuxt-base@latest "${dest}"`));

      // Fix package name - create-nuxt-base uses path as name which is invalid for lerna
      await this.fixPackageName(dest);

      return { method: 'npx', path: dest, success: true };
    } catch (err) {
      return { method: 'npx', path: dest, success: false };
    }
  }

  /**
   * Setup Angular frontend
   * Handles template setup, npm install, husky removal, git init, and localize
   *
   * @param dest - Destination directory path
   * @param options - Setup options
   * @returns FrontendSetupResult with success status
   */
  public async setupAngular(dest: string, options: AngularSetupOptions = {}): Promise<FrontendSetupResult> {
    const { filesystem, patching, system, templateHelper } = this.toolbox;
    const {
      branch,
      copyPath,
      gitLink,
      linkPath,
      localize = false,
      skipGitInit = false,
      skipHuskyRemoval = false,
      skipInstall = false,
    } = options;

    // Setup template
    const result = await templateHelper.setup(dest, {
      branch,
      copyPath,
      linkPath,
      repoUrl: 'https://github.com/lenneTech/ng-base-starter',
    });

    if (!result.success) {
      return { method: result.method, path: result.path, success: false };
    }

    // Link mode: skip all post-processing
    if (result.method === 'link') {
      return { method: 'link', path: result.path, success: true };
    }

    // Install packages
    if (!skipInstall) {
      try {
        const { pm } = this.toolbox;
        await system.run(`cd "${dest}" && ${pm.install(pm.detect(dest))}`);
      } catch (err) {
        return { method: result.method, path: dest, success: false };
      }
    }

    // Initialize git
    if (!skipGitInit) {
      try {
        await system.run(`cd "${dest}" && git init --initial-branch=main`);
        if (gitLink) {
          await system.run(`cd "${dest}" && git remote add origin ${gitLink}`);
          await system.run(`cd "${dest}" && git add .`);
          await system.run(`cd "${dest}" && git commit -m "Initial commit"`);
          await system.run(`cd "${dest}" && git push -u origin main`);
        }
      } catch (err) {
        return { method: result.method, path: dest, success: false };
      }
    }

    // Remove husky
    if (!skipHuskyRemoval) {
      filesystem.remove(`${dest}/.husky`);
      await patching.update(`${dest}/package.json`, (data: Record<string, unknown>) => {
        if (data.scripts && typeof data.scripts === 'object') {
          delete (data.scripts as Record<string, unknown>).prepare;
        }
        if (data.devDependencies && typeof data.devDependencies === 'object') {
          delete (data.devDependencies as Record<string, unknown>).husky;
        }
        return data;
      });
    }

    // Add localize
    if (localize) {
      try {
        await system.run(`cd "${dest}" && ng add @angular/localize --skip-confirmation`);
      } catch {
        // Localize failure is not fatal
      }
    }

    // Run init script if exists
    if (!skipInstall) {
      try {
        const { pm: pmHelper } = this.toolbox;
        await system.run(`cd "${dest}" && ${pmHelper.run('init', pmHelper.detect(dest))}`);
      } catch {
        // Init script failure is not fatal
      }
    }

    return { method: result.method, path: dest, success: true };
  }
}

/**
 * Extend toolbox
 */
export default (toolbox: ExtendedGluegunToolbox) => {
  toolbox.frontendHelper = new FrontendHelper(toolbox);
};
