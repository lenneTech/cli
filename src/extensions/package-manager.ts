import { GluegunFilesystem } from 'gluegun';
import { join } from 'path';

import { LtConfig } from '../interfaces/lt-config.interface';

export type PackageManagerType = 'npm' | 'pnpm' | 'yarn';

const LOCKFILE_MAP: Record<string, PackageManagerType> = {
  'package-lock.json': 'npm',
  'pnpm-lock.yaml': 'pnpm',
  'yarn.lock': 'yarn',
};

/**
 * Package manager detection and command builder
 * Automatically detects npm, pnpm, or yarn based on lockfiles and config
 */
export class PackageManager {
  private cache = new Map<string, PackageManagerType>();
  private filesystem: GluegunFilesystem;
  private ltConfig: () => LtConfig;

  constructor(filesystem: GluegunFilesystem, ltConfigFn: () => LtConfig) {
    this.filesystem = filesystem;
    this.ltConfig = ltConfigFn;
  }

  /**
   * Add a package to the project
   * @param pkg - Package name (with optional version)
   * @param flags - Additional flags (e.g., '--save-dev', '--save-exact')
   * @param pm - Override detected package manager
   */
  addPackage(pkg: string, flags?: string, pm?: PackageManagerType): string {
    const manager = pm || this.detect();
    const flagStr = flags ? ` ${flags}` : '';
    switch (manager) {
      case 'pnpm':
        return `pnpm add ${pkg}${flagStr}`;
      case 'yarn':
        return `yarn add ${pkg}${flagStr}`;
      default:
        return `npm install ${pkg}${flagStr}`;
    }
  }

  /**
   * Get the binary/executable runner command
   * @param pm - Override detected package manager
   */
  bin(pm?: PackageManagerType): string {
    const manager = pm || this.detect();
    return manager;
  }

  /**
   * Get the cache clean command
   * @param pm - Override detected package manager
   */
  cacheClean(pm?: PackageManagerType): string {
    const manager = pm || this.detect();
    switch (manager) {
      case 'pnpm':
        return 'pnpm store prune';
      case 'yarn':
        return 'yarn cache clean';
      default:
        return 'npm cache clean --force';
    }
  }

  /**
   * Detect the package manager for the given directory
   * Uses caching per directory for performance
   *
   * Priority:
   * 1. Lockfile in cwd
   * 2. packageManager field in package.json
   * 3. Lockfile in parent directories (monorepo support)
   * 4. Config fallback (defaults.packageManager)
   * 5. npm
   *
   * @param cwd - Directory to detect from (defaults to filesystem.cwd())
   */
  detect(cwd?: string): PackageManagerType {
    const dir = cwd || this.filesystem.cwd();

    if (this.cache.has(dir)) {
      return this.cache.get(dir)!;
    }

    const result = this.detectFromLockfile(dir)
      || this.detectFromPackageJson(dir)
      || this.detectFromParentDirs(dir)
      || this.detectFromConfig()
      || 'npm';

    this.cache.set(dir, result);
    return result;
  }

  /**
   * Get the npx/dlx equivalent command
   * @param cmd - Command to execute
   * @param pm - Override detected package manager
   */
  exec(cmd: string, pm?: PackageManagerType): string {
    const manager = pm || this.detect();
    switch (manager) {
      case 'pnpm':
        return `pnpm dlx ${cmd}`;
      case 'yarn':
        return `yarn dlx ${cmd}`;
      default:
        return `npx ${cmd}`;
    }
  }

  /**
   * Get the lockfile name for the given package manager
   * @param pm - Override detected package manager
   */
  getLockfileName(pm?: PackageManagerType): string {
    const manager = pm || this.detect();
    switch (manager) {
      case 'pnpm':
        return 'pnpm-lock.yaml';
      case 'yarn':
        return 'yarn.lock';
      default:
        return 'package-lock.json';
    }
  }

  /**
   * Get the global install command
   * @param pkg - Package name
   * @param pm - Override detected package manager
   */
  globalInstall(pkg: string, pm?: PackageManagerType): string {
    const manager = pm || this.detect();
    switch (manager) {
      case 'pnpm':
        return `pnpm add -g ${pkg}`;
      case 'yarn':
        return `yarn global add ${pkg}`;
      default:
        return `npm i -g ${pkg}`;
    }
  }

  /**
   * Get the install command (no arguments)
   * @param pm - Override detected package manager
   */
  install(pm?: PackageManagerType): string {
    const manager = pm || this.detect();
    switch (manager) {
      case 'pnpm':
        return 'pnpm install';
      case 'yarn':
        return 'yarn install';
      default:
        return 'npm i';
    }
  }

  /**
   * Get the run script command
   * @param script - Script name from package.json
   * @param pm - Override detected package manager
   */
  run(script: string, pm?: PackageManagerType): string {
    const manager = pm || this.detect();
    switch (manager) {
      case 'pnpm':
        return `pnpm run ${script}`;
      case 'yarn':
        return `yarn run ${script}`;
      default:
        return `npm run ${script}`;
    }
  }

  /**
   * Detect from lt.config defaults.packageManager
   */
  private detectFromConfig(): null | PackageManagerType {
    try {
      const config = this.ltConfig();
      const pm = config?.defaults?.packageManager;
      if (pm && ['npm', 'pnpm', 'yarn'].includes(pm)) {
        return pm;
      }
    } catch {
      // Config not available
    }
    return null;
  }

  /**
   * Detect package manager from lockfile in the given directory
   */
  private detectFromLockfile(dir: string): null | PackageManagerType {
    for (const [lockfile, pm] of Object.entries(LOCKFILE_MAP)) {
      if (this.filesystem.exists(join(dir, lockfile))) {
        return pm;
      }
    }
    return null;
  }

  /**
   * Detect from packageManager field in package.json (Corepack standard)
   */
  private detectFromPackageJson(dir: string): null | PackageManagerType {
    const pkgPath = join(dir, 'package.json');
    if (!this.filesystem.exists(pkgPath)) {
      return null;
    }

    try {
      const content = this.filesystem.read(pkgPath, 'json');
      const pmField = content?.packageManager;
      if (typeof pmField === 'string') {
        if (pmField.startsWith('pnpm')) {
          return 'pnpm';
        }
        if (pmField.startsWith('yarn')) {
          return 'yarn';
        }
        if (pmField.startsWith('npm')) {
          return 'npm';
        }
      }
    } catch {
      // Invalid package.json
    }
    return null;
  }

  /**
   * Detect from lockfile in parent directories (monorepo support)
   */
  private detectFromParentDirs(startDir: string): null | PackageManagerType {
    let dir = startDir;
    const root = this.filesystem.separator === '/' ? '/' : /^[A-Z]:\\$/i;

    while (true) {
      const parent = this.filesystem.path(dir, '..');
      if (parent === dir || (typeof root !== 'string' && root.test(dir))) {
        break;
      }
      dir = parent;

      const result = this.detectFromLockfile(dir);
      if (result) {
        return result;
      }
    }
    return null;
  }
}

/**
 * Extension function to add package manager helper to toolbox
 */
export default (toolbox: any) => {
  const pm = new PackageManager(
    toolbox.filesystem,
    () => toolbox.config?.loadConfig?.() || {},
  );
  toolbox.pm = pm;
};
