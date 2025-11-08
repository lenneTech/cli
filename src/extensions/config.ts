import { GluegunFilesystem } from 'gluegun';
import * as _ from 'lodash';
import { join } from 'path';

import { LtConfig } from '../interfaces/lt-config.interface';

/**
 * Config helper functions for loading and merging lt.config.json files
 */
export class Config {
  filesystem: GluegunFilesystem;

  constructor(filesystem: GluegunFilesystem) {
    this.filesystem = filesystem;
  }

  /**
   * Load configuration from lt.config.json files
   * Searches from current directory up to root, merging configurations
   *
   * Priority (lowest to highest):
   * 1. Default values
   * 2. Config from parent directories (higher up = lower priority)
   * 3. Config from current directory
   * 4. CLI parameters
   * 5. Interactive user input
   *
   * @param startPath - Starting directory (defaults to current working directory)
   * @returns Merged configuration object
   */
  loadConfig(startPath?: string): LtConfig {
    const start = startPath || this.filesystem.cwd();
    const configs: LtConfig[] = [];

    // Search from current directory up to root
    let currentPath = start;
    const root = this.filesystem.separator === '/' ? '/' : /^[A-Z]:\\$/i;

    while (true) {
      const configPath = join(currentPath, 'lt.config.json');

      if (this.filesystem.exists(configPath)) {
        try {
          const config = this.filesystem.read(configPath, 'json') as LtConfig;
          if (config) {
            // Add to beginning (parent configs have lower priority)
            configs.unshift(config);
          }
        } catch (error) {
          // Invalid JSON, skip this config file
           
          console.warn(`Warning: Invalid JSON in ${configPath}`);
        }
      }

      // Check if we've reached the root
      const parent = this.filesystem.path(currentPath, '..');
      if (parent === currentPath || (typeof root !== 'string' && root.test(currentPath))) {
        break;
      }
      currentPath = parent;
    }

    // Merge all configs (later configs override earlier ones)
    return this.mergeConfigs(...configs);
  }

  /**
   * Merge multiple config objects
   * Later configs override earlier ones
   *
   * Uses lodash mergeWith with custom handling:
   * - Source objects are merged into the destination object
   * - Source objects are applied from left to right
   * - Subsequent sources overwrite property assignments of previous sources
   * - Arrays are not merged but overwrite arrays of previous sources
   *
   * @param configs - Config objects to merge
   * @returns Merged configuration
   */
  mergeConfigs(...configs: LtConfig[]): LtConfig {
    const merged: LtConfig = {};

    // Filter out null/undefined configs
    const validConfigs = configs.filter((c) => c !== null && c !== undefined);

    if (validConfigs.length === 0) {
      return merged;
    }

    // Use lodash mergeWith with array override behavior
    return _.mergeWith(merged, ...validConfigs, (objValue: any, srcValue: any) => {
      // If source value is an array, replace rather than merge
      if (Array.isArray(srcValue)) {
        return srcValue;
      }
      // Otherwise, use default merge behavior
      return undefined;
    });
  }

  /**
   * Get a configuration value with priority handling
   *
   * Priority (lowest to highest):
   * 1. defaultValue
   * 2. Config file value
   * 3. CLI parameter value
   * 4. Interactive value (if provided)
   *
   * @param options - Configuration options
   * @returns The value according to priority
   */
  getValue<T>(options: {
    cliValue?: T;
    configValue?: T;
    defaultValue?: T;
    interactiveValue?: T;
  }): T | undefined {
    const { cliValue, configValue, defaultValue, interactiveValue } = options;

    // Priority: interactive > cli > config > default
    if (interactiveValue !== undefined && interactiveValue !== null) {
      return interactiveValue;
    }
    if (cliValue !== undefined && cliValue !== null) {
      return cliValue;
    }
    if (configValue !== undefined && configValue !== null) {
      return configValue;
    }
    return defaultValue;
  }

  /**
   * Save configuration to lt.config.json in the specified directory
   *
   * @param config - Configuration to save
   * @param targetPath - Directory to save config in (defaults to current directory)
   */
  saveConfig(config: LtConfig, targetPath?: string): void {
    const path = targetPath || this.filesystem.cwd();
    const configPath = join(path, 'lt.config.json');

    this.filesystem.write(configPath, config, { jsonIndent: 2 });
  }

  /**
   * Update an existing configuration file or create a new one
   * Merges with existing config if it exists
   *
   * @param config - Configuration updates to apply
   * @param targetPath - Directory containing config file (defaults to current directory)
   */
  updateConfig(config: LtConfig, targetPath?: string): void {
    const path = targetPath || this.filesystem.cwd();
    const configPath = join(path, 'lt.config.json');

    let existing: LtConfig = {};

    if (this.filesystem.exists(configPath)) {
      try {
        existing = this.filesystem.read(configPath, 'json') as LtConfig;
      } catch (error) {
        // Invalid JSON, will overwrite
        existing = {};
      }
    }

    const merged = this.mergeConfigs(existing, config);
    this.saveConfig(merged, path);
  }
}

/**
 * Extension function to add config helper to toolbox
 */
export default (toolbox) => {
  const config = new Config(toolbox.filesystem);
  toolbox.config = config;
};
