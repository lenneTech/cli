import { GluegunFilesystem } from 'gluegun';
import * as yaml from 'js-yaml';
import * as _ from 'lodash';
import { join } from 'path';

import { LtConfig } from '../interfaces/lt-config.interface';

/**
 * Supported config file names in priority order (highest priority first)
 */
const CONFIG_FILES = ['lt.config.json', 'lt.config.yaml', 'lt.config'];

/**
 * Config helper functions for loading and merging lt.config files
 * Supports JSON and YAML formats with hierarchical merging
 */
export class Config {
  filesystem: GluegunFilesystem;
  private suppressWarnings: boolean;

  constructor(filesystem: GluegunFilesystem, options?: { suppressWarnings?: boolean }) {
    this.filesystem = filesystem;
    this.suppressWarnings = options?.suppressWarnings ?? false;
  }

  /**
   * Load configuration from lt.config files (JSON or YAML)
   * Searches from current directory up to root, merging configurations
   *
   * Supported file formats (in priority order):
   * 1. lt.config.json - explicit JSON format
   * 2. lt.config.yaml - explicit YAML format
   * 3. lt.config - auto-detected format (tries JSON first, then YAML)
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
      const config = this.loadConfigFromDirectory(currentPath);
      if (config) {
        // Add to beginning (parent configs have lower priority)
        configs.unshift(config);
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
   * Load config from a single directory
   * Checks for config files in priority order
   * Warns if multiple config file variants exist
   *
   * @param dirPath - Directory to search in
   * @returns Config object or null if no valid config found
   */
  private loadConfigFromDirectory(dirPath: string): LtConfig | null {
    // Find all existing config files in this directory
    const existingFiles: string[] = [];
    for (const configFile of CONFIG_FILES) {
      const configPath = join(dirPath, configFile);
      if (this.filesystem.exists(configPath)) {
        existingFiles.push(configFile);
      }
    }

    // No config files found
    if (existingFiles.length === 0) {
      return null;
    }

    // Warn if multiple config files exist
    if (existingFiles.length > 1 && !this.suppressWarnings) {
      const used = existingFiles[0];
      const ignored = existingFiles.slice(1);
      console.warn(
        `Warning: Multiple config files found in ${dirPath}:\n` +
          `  Using:    ${used}\n` +
          `  Ignored:  ${ignored.join(', ')}\n` +
          `  Priority: lt.config.json > lt.config.yaml > lt.config`,
      );
    }

    // Return the highest priority config (first in the list)
    for (const configFile of existingFiles) {
      const configPath = join(dirPath, configFile);
      const config = this.parseConfigFile(configPath, configFile);
      if (config) {
        return config;
      }
    }

    return null;
  }

  /**
   * Parse a config file based on its name/format
   *
   * @param configPath - Full path to config file
   * @param fileName - Name of the config file
   * @returns Parsed config object or null on error
   */
  private parseConfigFile(configPath: string, fileName: string): LtConfig | null {
    try {
      const content = this.filesystem.read(configPath);
      if (!content || content.trim() === '') {
        if (!this.suppressWarnings) {
          console.warn(`Warning: Config file is empty: ${configPath}`);
        }
        return null;
      }

      // Explicit JSON file
      if (fileName === 'lt.config.json') {
        try {
          return JSON.parse(content) as LtConfig;
        } catch (e) {
          if (!this.suppressWarnings) {
            this.logParseError(configPath, 'JSON', e);
          }
          return null;
        }
      }

      // Explicit YAML file
      if (fileName === 'lt.config.yaml') {
        try {
          return yaml.load(content) as LtConfig;
        } catch (e) {
          if (!this.suppressWarnings) {
            this.logParseError(configPath, 'YAML', e);
          }
          return null;
        }
      }

      // Auto-detect format for lt.config
      return this.parseAutoDetect(content, configPath);
    } catch (error) {
      if (!this.suppressWarnings) {
        console.warn(`Warning: Could not read config file ${configPath}`);
        if (error instanceof Error) {
          console.warn(`  Error: ${error.message}`);
        }
      }
      return null;
    }
  }

  /**
   * Log a detailed parse error message
   */
  private logParseError(configPath: string, format: string, error: unknown): void {
    console.warn(`Warning: Could not parse ${format} config file: ${configPath}`);

    if (error instanceof SyntaxError) {
      // JSON parse error - extract position info
      const match = error.message.match(/position\s+(\d+)/i);
      if (match) {
        const position = parseInt(match[1], 10);
        console.warn(`  Syntax error at position ${position}: ${error.message}`);
      } else {
        console.warn(`  Syntax error: ${error.message}`);
      }
    } else if (error instanceof yaml.YAMLException) {
      // YAML parse error - has line/column info
      console.warn(`  ${error.message}`);
      if (error.mark) {
        console.warn(`  at line ${error.mark.line + 1}, column ${error.mark.column + 1}`);
      }
    } else if (error instanceof Error) {
      console.warn(`  Error: ${error.message}`);
    }
  }

  /**
   * Auto-detect and parse config content (JSON or YAML)
   * Tries JSON first, then YAML as fallback
   *
   * @param content - Raw config file content
   * @param configPath - Path to the config file (for error reporting)
   * @returns Parsed config object or null on error
   */
  private parseAutoDetect(content: string, configPath?: string): LtConfig | null {
    let jsonError: Error | null = null;
    let yamlError: Error | null = null;

    // Try JSON first
    try {
      return JSON.parse(content) as LtConfig;
    } catch (e) {
      jsonError = e instanceof Error ? e : new Error(String(e));
    }

    // Try YAML
    try {
      return yaml.load(content) as LtConfig;
    } catch (e) {
      yamlError = e instanceof Error ? e : new Error(String(e));
    }

    // Neither JSON nor YAML - report both errors
    if (!this.suppressWarnings && configPath) {
      console.warn(`Warning: Could not parse config file: ${configPath}`);
      console.warn(`  File format could not be auto-detected.`);
      console.warn(`  JSON error: ${jsonError?.message}`);
      console.warn(`  YAML error: ${yamlError?.message}`);
    }

    return null;
  }

  /**
   * Merge multiple config objects
   * Later configs override earlier ones
   *
   * Merge behavior:
   * - Objects are deeply merged
   * - Arrays are completely replaced (not merged)
   * - null values delete the corresponding key from parent configs
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

    // Use lodash mergeWith with custom handling for arrays and null values
    const result = _.mergeWith(merged, ...validConfigs, (_objValue: any, srcValue: any) => {
      // If source value is null, delete the key from target
      if (srcValue === null) {
        return undefined; // This tells lodash to use undefined, which we'll clean up later
      }

      // If source value is an array, replace rather than merge
      if (Array.isArray(srcValue)) {
        return srcValue;
      }

      // Otherwise, use default merge behavior
      return undefined;
    });

    // Clean up null values (remove keys that were set to null)
    return this.removeNullValues(result);
  }

  /**
   * Recursively remove keys with null values from an object
   *
   * @param obj - Object to clean
   * @returns Cleaned object without null values
   */
  private removeNullValues(obj: any): any {
    if (obj === null || obj === undefined) {
      return undefined;
    }

    if (Array.isArray(obj)) {
      return obj.map((item) => this.removeNullValues(item)).filter((item) => item !== undefined);
    }

    if (typeof obj === 'object') {
      const result: any = {};
      for (const key of Object.keys(obj)) {
        const value = this.removeNullValues(obj[key]);
        if (value !== undefined) {
          result[key] = value;
        }
      }
      return Object.keys(result).length > 0 ? result : undefined;
    }

    return obj;
  }

  /**
   * Get a configuration value with priority handling
   *
   * Priority (lowest to highest):
   * 1. defaultValue (code default)
   * 2. globalValue (from defaults section)
   * 3. configValue (from commands section)
   * 4. cliValue (CLI parameter)
   * 5. interactiveValue (user input)
   *
   * @param options - Configuration options
   * @returns The value according to priority
   */
  getValue<T>(options: {
    cliValue?: null | T;
    configValue?: null | T;
    defaultValue?: T;
    globalValue?: null | T;
    interactiveValue?: null | T;
  }): T | undefined {
    const { cliValue, configValue, defaultValue, globalValue, interactiveValue } = options;

    // Priority: interactive > cli > config > global > default
    if (interactiveValue !== undefined && interactiveValue !== null) {
      return interactiveValue;
    }
    if (cliValue !== undefined && cliValue !== null) {
      return cliValue;
    }
    if (configValue !== undefined && configValue !== null) {
      return configValue;
    }
    if (globalValue !== undefined && globalValue !== null) {
      return globalValue;
    }
    return defaultValue;
  }

  /**
   * Get a global default value from the defaults section
   *
   * @param config - Loaded config object
   * @param key - Key in the defaults section
   * @returns The global default value or undefined
   */
  getGlobalDefault<T>(config: LtConfig, key: keyof NonNullable<LtConfig['defaults']>): T | undefined {
    return config?.defaults?.[key] as T | undefined;
  }

  /**
   * Check if a value should be considered as "set" (not undefined/null)
   * Useful for determining if a config value should skip interactive prompts
   *
   * @param value - Value to check
   * @returns true if the value is set
   */
  isSet<T>(value: null | T | undefined): value is T {
    return value !== undefined && value !== null;
  }

  /**
   * Get noConfirm setting with standard priority handling
   * Simplifies the common pattern used across many commands
   *
   * @param options - Configuration options
   * @returns The resolved noConfirm value
   */
  getNoConfirm(options: {
    cliValue?: boolean | null;
    commandConfig?: { noConfirm?: boolean };
    config: LtConfig;
    parentConfig?: { noConfirm?: boolean };
  }): boolean {
    const { cliValue, commandConfig, config, parentConfig } = options;
    const configNoConfirm = commandConfig?.noConfirm ?? parentConfig?.noConfirm;
    const globalNoConfirm = this.getGlobalDefault<boolean>(config, 'noConfirm');

    return (
      this.getValue({
        cliValue,
        configValue: configNoConfirm,
        defaultValue: false,
        globalValue: globalNoConfirm,
      }) ?? false
    );
  }

  /**
   * Get skipLint setting with standard priority handling
   *
   * @param options - Configuration options
   * @returns The resolved skipLint value
   */
  getSkipLint(options: {
    cliValue?: boolean | null;
    commandConfig?: { skipLint?: boolean };
    config: LtConfig;
  }): boolean {
    const { cliValue, commandConfig, config } = options;
    const globalSkipLint = this.getGlobalDefault<boolean>(config, 'skipLint');

    return (
      this.getValue({
        cliValue,
        configValue: commandConfig?.skipLint,
        defaultValue: false,
        globalValue: globalSkipLint,
      }) ?? false
    );
  }

  /**
   * Save configuration to a file in the specified directory
   *
   * @param config - Configuration to save
   * @param targetPath - Directory to save config in (defaults to current directory)
   * @param options - Save options
   * @param options.format - File format: 'json' (default) or 'yaml'
   */
  saveConfig(config: LtConfig, targetPath?: string, options?: { format?: 'json' | 'yaml' }): void {
    const path = targetPath || this.filesystem.cwd();
    const format = options?.format || 'json';

    if (format === 'yaml') {
      const configPath = join(path, 'lt.config.yaml');
      const yamlContent = yaml.dump(config, {
        indent: 2,
        lineWidth: -1,
        noRefs: true,
      });
      this.filesystem.write(configPath, yamlContent);
    } else {
      const configPath = join(path, 'lt.config.json');
      this.filesystem.write(configPath, config, { jsonIndent: 2 });
    }
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

    // Try to load existing config
    const existing = this.loadConfigFromDirectory(path) || {};

    const merged = this.mergeConfigs(existing, config);
    this.saveConfig(merged, path);
  }

  /**
   * Get the effective configuration for a specific command
   * Combines loaded config with CLI parameters
   *
   * @param commandPath - Path to the command config (e.g., ['server', 'module'])
   * @param cliOptions - CLI parameters object
   * @returns Combined configuration for the command
   */
  getCommandConfig<T extends Record<string, any>>(commandPath: string[], cliOptions: Record<string, any> = {}): T {
    const loadedConfig = this.loadConfig();
    let configValue: any = loadedConfig.commands;

    // Navigate to the command config
    for (const key of commandPath) {
      configValue = configValue?.[key];
    }

    // Merge CLI options with config (CLI takes precedence)
    return { ...configValue, ...cliOptions } as T;
  }

  /**
   * Load configuration with origin tracking
   * Returns both the merged config and information about where each value came from
   *
   * @param startPath - Starting directory (defaults to current working directory)
   * @returns Object containing merged config and origins map
   */
  loadConfigWithOrigins(startPath?: string): {
    config: LtConfig;
    files: Array<{ config: LtConfig; path: string }>;
    origins: Map<string, string>;
  } {
    const start = startPath || this.filesystem.cwd();
    const configsWithPaths: Array<{ config: LtConfig; path: string }> = [];

    // Search from current directory up to root
    let currentPath = start;
    const root = this.filesystem.separator === '/' ? '/' : /^[A-Z]:\\$/i;

    while (true) {
      const result = this.loadConfigFromDirectoryWithPath(currentPath);
      if (result) {
        // Add to beginning (parent configs have lower priority)
        configsWithPaths.unshift(result);
      }

      // Check if we've reached the root
      const parent = this.filesystem.path(currentPath, '..');
      if (parent === currentPath || (typeof root !== 'string' && root.test(currentPath))) {
        break;
      }
      currentPath = parent;
    }

    // Track origins for each key path
    const origins = new Map<string, string>();

    // Process configs in order (lower priority first)
    for (const { config, path } of configsWithPaths) {
      this.trackOrigins(config, path, '', origins);
    }

    // Merge all configs
    const configs = configsWithPaths.map((c) => c.config);
    const mergedConfig = this.mergeConfigs(...configs);

    return {
      config: mergedConfig,
      files: configsWithPaths,
      origins,
    };
  }

  /**
   * Load config from a directory and return with its path
   */
  private loadConfigFromDirectoryWithPath(dirPath: string): null | { config: LtConfig; path: string } {
    // Find all existing config files in this directory
    const existingFiles: string[] = [];
    for (const configFile of CONFIG_FILES) {
      const configPath = join(dirPath, configFile);
      if (this.filesystem.exists(configPath)) {
        existingFiles.push(configFile);
      }
    }

    if (existingFiles.length === 0) {
      return null;
    }

    // Warn if multiple config files exist
    if (existingFiles.length > 1 && !this.suppressWarnings) {
      const used = existingFiles[0];
      const ignored = existingFiles.slice(1);
      console.warn(
        `Warning: Multiple config files found in ${dirPath}:\n` +
          `  Using:    ${used}\n` +
          `  Ignored:  ${ignored.join(', ')}\n` +
          `  Priority: lt.config.json > lt.config.yaml > lt.config`,
      );
    }

    // Return the highest priority config with its path
    for (const configFile of existingFiles) {
      const configPath = join(dirPath, configFile);
      const config = this.parseConfigFile(configPath, configFile);
      if (config) {
        return { config, path: configPath };
      }
    }

    return null;
  }

  /**
   * Recursively track the origin of each config value
   */
  private trackOrigins(obj: any, filePath: string, keyPath: string, origins: Map<string, string>): void {
    if (obj === null || obj === undefined) {
      return;
    }

    if (typeof obj === 'object' && !Array.isArray(obj)) {
      for (const key of Object.keys(obj)) {
        const newPath = keyPath ? `${keyPath}.${key}` : key;
        const value = obj[key];

        if (typeof value === 'object' && value !== null && !Array.isArray(value)) {
          // Recurse into nested objects
          this.trackOrigins(value, filePath, newPath, origins);
        } else {
          // Leaf value - record origin
          origins.set(newPath, filePath);
        }
      }
    }
  }
}

/**
 * Extension function to add config helper to toolbox
 */
export default (toolbox) => {
  const config = new Config(toolbox.filesystem);
  toolbox.config = config;
};
