import { join } from 'path';

import { ExtendedGluegunCommand } from '../../interfaces/extended-gluegun-command';
import { ExtendedGluegunToolbox } from '../../interfaces/extended-gluegun-toolbox';

/**
 * Known configuration keys based on LtConfig interface
 * Used for validation against unknown keys
 */
const KNOWN_KEYS: Record<string, Record<string, any>> = {
  commands: {
    blocks: {
      add: { noConfirm: 'boolean' },
    },
    cli: {
      create: { author: 'string', link: 'boolean', noConfirm: 'boolean' },
    },
    components: {
      add: { noConfirm: 'boolean' },
    },
    config: {
      init: { noConfirm: 'boolean' },
    },
    deployment: {
      domain: 'string',
      gitHub: 'boolean',
      gitLab: 'boolean',
      noConfirm: 'boolean',
      prodRunner: 'string',
      testRunner: 'string',
    },
    frontend: {
      angular: { branch: 'string', copy: 'string', link: 'string', localize: 'boolean', noConfirm: 'boolean' },
      nuxt: { branch: 'string', copy: 'string', link: 'string' },
    },
    fullstack: {
      apiBranch: 'string',
      apiCopy: 'string',
      apiLink: 'string',
      frontend: ['angular', 'nuxt'],
      frontendBranch: 'string',
      frontendCopy: 'string',
      frontendLink: 'string',
      git: 'boolean',
      gitLink: 'string',
      noConfirm: 'boolean',
    },
    git: {
      baseBranch: 'string',
      clean: { noConfirm: 'boolean' },
      clear: { noConfirm: 'boolean' },
      create: { base: 'string', noConfirm: 'boolean' },
      defaultBranch: 'string',
      forcePull: { noConfirm: 'boolean' },
      get: { mode: ['hard'], noConfirm: 'boolean' },
      noConfirm: 'boolean',
      rebase: { base: 'string', noConfirm: 'boolean' },
      rename: { noConfirm: 'boolean' },
      reset: { noConfirm: 'boolean' },
      squash: { author: 'string', base: 'string', noConfirm: 'boolean' },
      undo: { noConfirm: 'boolean' },
      update: { skipInstall: 'boolean' },
    },
    npm: {
      reinit: { noConfirm: 'boolean', update: 'boolean' },
    },
    server: {
      addProp: { skipLint: 'boolean' },
      create: {
        author: 'string',
        branch: 'string',
        controller: ['Rest', 'GraphQL', 'Both', 'auto'],
        copy: 'string',
        description: 'string',
        git: 'boolean',
        link: 'string',
        noConfirm: 'boolean',
      },
      module: {
        controller: ['Rest', 'GraphQL', 'Both', 'auto'],
        noConfirm: 'boolean',
        skipLint: 'boolean',
      },
      object: { skipLint: 'boolean' },
    },
    typescript: {
      create: { author: 'string', noConfirm: 'boolean', updatePackages: 'boolean' },
    },
  },
  defaults: {
    author: 'string',
    baseBranch: 'string',
    controller: ['Rest', 'GraphQL', 'Both', 'auto'],
    domain: 'string',
    noConfirm: 'boolean',
    skipInstall: 'boolean',
    skipLint: 'boolean',
  },
  meta: {
    // meta allows additional properties
    _additionalProperties: true,
    description: 'string',
    name: 'string',
    tags: 'array',
    version: 'string',
  },
};

interface ValidationResult {
  errors: string[];
  warnings: string[];
}

/**
 * Validate a config object against known keys
 */
function validateConfig(config: any, knownKeys: Record<string, any>, path = ''): ValidationResult {
  const result: ValidationResult = { errors: [], warnings: [] };

  if (typeof config !== 'object' || config === null) {
    return result;
  }

  for (const key of Object.keys(config)) {
    const currentPath = path ? `${path}.${key}` : key;
    const value = config[key];
    const expectedType = knownKeys[key];

    // Skip $schema key (used for IDE support)
    if (key === '$schema') {
      continue;
    }

    // Check if key is known
    if (expectedType === undefined) {
      // Check if additional properties are allowed
      if (knownKeys._additionalProperties) {
        continue;
      }
      result.warnings.push(`Unknown key: ${currentPath}`);
      continue;
    }

    // Validate type
    if (typeof expectedType === 'string') {
      // Simple type check
      if (expectedType === 'string' && typeof value !== 'string') {
        result.errors.push(`${currentPath}: expected string, got ${typeof value}`);
      } else if (expectedType === 'boolean' && typeof value !== 'boolean') {
        result.errors.push(`${currentPath}: expected boolean, got ${typeof value}`);
      } else if (expectedType === 'array' && !Array.isArray(value)) {
        result.errors.push(`${currentPath}: expected array, got ${typeof value}`);
      }
    } else if (Array.isArray(expectedType)) {
      // Enum check
      if (!expectedType.includes(value)) {
        result.errors.push(`${currentPath}: expected one of [${expectedType.join(', ')}], got "${value}"`);
      }
    } else if (typeof expectedType === 'object') {
      // Nested object - recurse
      if (typeof value !== 'object' || value === null) {
        result.errors.push(`${currentPath}: expected object, got ${typeof value}`);
      } else {
        const nested = validateConfig(value, expectedType, currentPath);
        result.errors.push(...nested.errors);
        result.warnings.push(...nested.warnings);
      }
    }
  }

  return result;
}

/**
 * Validate lt.config file
 */
const ValidateCommand: ExtendedGluegunCommand = {
  alias: ['v'],
  description: 'Validate config file',
  hidden: false,
  name: 'validate',
  run: async (toolbox: ExtendedGluegunToolbox) => {
    const {
      filesystem,
      print: { error, info, success, warning },
    } = toolbox;

    info('Validating lt.config...');
    info('');

    // Find config files
    const cwd = filesystem.cwd();
    const configFiles = ['lt.config.json', 'lt.config.yaml', 'lt.config'];
    const foundFiles: string[] = [];

    for (const file of configFiles) {
      if (filesystem.exists(join(cwd, file))) {
        foundFiles.push(file);
      }
    }

    if (foundFiles.length === 0) {
      error('No lt.config file found in current directory.');
      info('');
      info('Run "lt config init" to create a configuration file.');
      return 'config validate: no file';
    }

    // Warn about multiple files
    if (foundFiles.length > 1) {
      warning(`Multiple config files found: ${foundFiles.join(', ')}`);
      warning(`Only ${foundFiles[0]} will be used (highest priority).`);
      info('');
    }

    const configFile = foundFiles[0];
    const configPath = join(cwd, configFile);

    // Try to parse the config
    let parsedConfig: any;
    try {
      const content = filesystem.read(configPath);
      if (!content || content.trim() === '') {
        error(`${configFile}: File is empty`);
        return 'config validate: empty file';
      }

      if (configFile.endsWith('.json')) {
        parsedConfig = JSON.parse(content);
      } else if (configFile.endsWith('.yaml')) {
        const yaml = require('js-yaml');
        parsedConfig = yaml.load(content);
      } else {
        // Auto-detect
        try {
          parsedConfig = JSON.parse(content);
        } catch {
          const yaml = require('js-yaml');
          parsedConfig = yaml.load(content);
        }
      }
    } catch (e) {
      error(`${configFile}: Parse error`);
      error(`  ${e.message}`);
      return 'config validate: parse error';
    }

    success(`${configFile}: Syntax OK`);

    // Validate against schema
    const validation = validateConfig(parsedConfig, KNOWN_KEYS);

    // Report errors
    if (validation.errors.length > 0) {
      info('');
      error('Errors:');
      for (const err of validation.errors) {
        error(`  - ${err}`);
      }
    }

    // Report warnings
    if (validation.warnings.length > 0) {
      info('');
      warning('Warnings:');
      for (const warn of validation.warnings) {
        warning(`  - ${warn}`);
      }
    }

    // Summary
    info('');
    if (validation.errors.length === 0 && validation.warnings.length === 0) {
      success('Configuration is valid!');
    } else if (validation.errors.length === 0) {
      success(`Configuration is valid with ${validation.warnings.length} warning(s).`);
    } else {
      error(`Configuration has ${validation.errors.length} error(s) and ${validation.warnings.length} warning(s).`);
    }

    // Show schema hint
    info('');
    info('Tip: Add "$schema" to your config for IDE autocomplete:');
    if (configFile.endsWith('.json')) {
      info('  "$schema": "./node_modules/@lenne.tech/cli/schemas/lt.config.schema.json"');
    } else {
      info('  For YAML files, use a JSON Schema-aware editor with:');
      info('  # yaml-language-server: $schema=./node_modules/@lenne.tech/cli/schemas/lt.config.schema.json');
    }

    if (!toolbox.parameters.options.fromGluegunMenu) {
      process.exit();
    }

    return validation.errors.length === 0 ? 'config validate: valid' : 'config validate: invalid';
  },
};

export default ValidateCommand;
