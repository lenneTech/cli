import { Config } from '../src/extensions/config';
import { LtConfig } from '../src/interfaces/lt-config.interface';

const { filesystem } = require('gluegun');

describe('Config Extension', () => {
  let config: Config;
  let tempDir: string;

  beforeEach(() => {
    // Suppress warnings by default to avoid console spam in tests
    config = new Config(filesystem, { suppressWarnings: true });
    // Create a unique temp directory for each test
    tempDir = filesystem.path(filesystem.cwd(), '__tests__', 'temp-config-' + Date.now());
    filesystem.dir(tempDir);
  });

  afterEach(() => {
    // Clean up temp directory
    if (filesystem.exists(tempDir)) {
      filesystem.remove(tempDir);
    }
  });

  describe('File Format Support', () => {
    describe('lt.config.json', () => {
      it('should load configuration from lt.config.json', () => {
        const configContent: LtConfig = {
          commands: {
            server: {
              module: {
                controller: 'Rest',
              },
            },
          },
        };
        filesystem.write(filesystem.path(tempDir, 'lt.config.json'), configContent);

        const result = config.loadConfig(tempDir);

        expect(result.commands?.server?.module?.controller).toBe('Rest');
      });
    });

    describe('lt.config.yaml', () => {
      it('should load configuration from lt.config.yaml', () => {
        const yamlContent = `
commands:
  server:
    module:
      controller: GraphQL
`;
        filesystem.write(filesystem.path(tempDir, 'lt.config.yaml'), yamlContent);

        const result = config.loadConfig(tempDir);

        expect(result.commands?.server?.module?.controller).toBe('GraphQL');
      });

      it('should handle complex YAML structures', () => {
        const yamlContent = `
commands:
  server:
    module:
      controller: Both
      skipLint: true
  fullstack:
    frontend: nuxt
    git: false
meta:
  name: test-project
  version: "1.0.0"
`;
        filesystem.write(filesystem.path(tempDir, 'lt.config.yaml'), yamlContent);

        const result = config.loadConfig(tempDir);

        expect(result.commands?.server?.module?.controller).toBe('Both');
        expect(result.commands?.server?.module?.skipLint).toBe(true);
        expect(result.commands?.fullstack?.frontend).toBe('nuxt');
        expect(result.commands?.fullstack?.git).toBe(false);
        expect(result.meta?.name).toBe('test-project');
      });
    });

    describe('lt.config (auto-detect)', () => {
      it('should auto-detect JSON format in lt.config file', () => {
        const configContent: LtConfig = {
          commands: {
            server: {
              module: {
                controller: 'Rest',
              },
            },
          },
        };
        filesystem.write(filesystem.path(tempDir, 'lt.config'), JSON.stringify(configContent, null, 2));

        const result = config.loadConfig(tempDir);

        expect(result.commands?.server?.module?.controller).toBe('Rest');
      });

      it('should auto-detect YAML format in lt.config file', () => {
        const yamlContent = `
commands:
  server:
    module:
      controller: GraphQL
`;
        filesystem.write(filesystem.path(tempDir, 'lt.config'), yamlContent);

        const result = config.loadConfig(tempDir);

        expect(result.commands?.server?.module?.controller).toBe('GraphQL');
      });

      it('should fallback to JSON parsing for ambiguous lt.config content', () => {
        // Valid JSON that might look like YAML
        const jsonContent = '{"commands":{"server":{"module":{"controller":"Rest"}}}}';
        filesystem.write(filesystem.path(tempDir, 'lt.config'), jsonContent);

        const result = config.loadConfig(tempDir);

        expect(result.commands?.server?.module?.controller).toBe('Rest');
      });
    });

    describe('File Priority', () => {
      it('should prioritize lt.config.json over lt.config', () => {
        const jsonConfig: LtConfig = {
          commands: { server: { module: { controller: 'Rest' } } },
        };
        const genericConfig: LtConfig = {
          commands: { server: { module: { controller: 'GraphQL' } } },
        };

        filesystem.write(filesystem.path(tempDir, 'lt.config.json'), jsonConfig);
        filesystem.write(filesystem.path(tempDir, 'lt.config'), JSON.stringify(genericConfig));

        const result = config.loadConfig(tempDir);

        expect(result.commands?.server?.module?.controller).toBe('Rest');
      });

      it('should prioritize lt.config.yaml over lt.config when no json exists', () => {
        const yamlContent = `
commands:
  server:
    module:
      controller: GraphQL
`;
        const genericConfig: LtConfig = {
          commands: { server: { module: { controller: 'Both' } } },
        };

        filesystem.write(filesystem.path(tempDir, 'lt.config.yaml'), yamlContent);
        filesystem.write(filesystem.path(tempDir, 'lt.config'), JSON.stringify(genericConfig));

        const result = config.loadConfig(tempDir);

        expect(result.commands?.server?.module?.controller).toBe('GraphQL');
      });

      it('should warn when multiple config files exist in same directory', () => {
        const warnSpy = jest.spyOn(console, 'warn').mockImplementation();

        // Create config instance without suppressWarnings
        const configWithWarnings = new Config(filesystem, { suppressWarnings: false });

        const jsonConfig: LtConfig = {
          commands: { server: { module: { controller: 'Rest' } } },
        };
        const yamlContent = `
commands:
  server:
    module:
      controller: GraphQL
`;
        const genericConfig: LtConfig = {
          commands: { server: { module: { controller: 'Both' } } },
        };

        filesystem.write(filesystem.path(tempDir, 'lt.config.json'), jsonConfig);
        filesystem.write(filesystem.path(tempDir, 'lt.config.yaml'), yamlContent);
        filesystem.write(filesystem.path(tempDir, 'lt.config'), JSON.stringify(genericConfig));

        const result = configWithWarnings.loadConfig(tempDir);

        // Should use highest priority (JSON)
        expect(result.commands?.server?.module?.controller).toBe('Rest');

        // Should have warned about multiple files
        expect(warnSpy).toHaveBeenCalledWith(
          expect.stringContaining('Multiple config files found')
        );
        expect(warnSpy).toHaveBeenCalledWith(
          expect.stringContaining('Using:    lt.config.json')
        );
        expect(warnSpy).toHaveBeenCalledWith(
          expect.stringContaining('Ignored:  lt.config.yaml, lt.config')
        );

        warnSpy.mockRestore();
      });

      it('should not warn when suppressWarnings is true', () => {
        const warnSpy = jest.spyOn(console, 'warn').mockImplementation();

        // Create config instance with suppressWarnings
        const configSuppressed = new Config(filesystem, { suppressWarnings: true });

        filesystem.write(filesystem.path(tempDir, 'lt.config.json'), { meta: { version: '1.0.0' } });
        filesystem.write(filesystem.path(tempDir, 'lt.config.yaml'), 'meta:\n  version: "2.0.0"');

        configSuppressed.loadConfig(tempDir);

        // Should not have warned
        expect(warnSpy).not.toHaveBeenCalledWith(
          expect.stringContaining('Multiple config files found')
        );

        warnSpy.mockRestore();
      });
    });
  });

  describe('Hierarchical Configuration', () => {
    let childDir: string;
    let grandchildDir: string;

    beforeEach(() => {
      childDir = filesystem.path(tempDir, 'child');
      grandchildDir = filesystem.path(childDir, 'grandchild');
      filesystem.dir(grandchildDir);
    });

    it('should merge configs from parent to child directories', () => {
      // Parent config
      filesystem.write(filesystem.path(tempDir, 'lt.config.json'), {
        commands: {
          server: {
            module: { controller: 'Rest' },
          },
          fullstack: {
            frontend: 'angular',
          },
        },
      });

      // Child config (overrides controller, inherits fullstack)
      filesystem.write(filesystem.path(childDir, 'lt.config.json'), {
        commands: {
          server: {
            module: { controller: 'GraphQL' },
          },
        },
      });

      const result = config.loadConfig(childDir);

      expect(result.commands?.server?.module?.controller).toBe('GraphQL');
      expect(result.commands?.fullstack?.frontend).toBe('angular');
    });

    it('should merge configs across three levels', () => {
      // Root config
      filesystem.write(filesystem.path(tempDir, 'lt.config.json'), {
        commands: {
          server: {
            module: { controller: 'Rest', skipLint: false },
          },
          fullstack: { frontend: 'angular', git: true },
        },
        meta: { version: '1.0.0' },
      });

      // Child config
      filesystem.write(filesystem.path(childDir, 'lt.config.json'), {
        commands: {
          server: {
            module: { skipLint: true },
          },
        },
        meta: { name: 'child-project' },
      });

      // Grandchild config
      filesystem.write(filesystem.path(grandchildDir, 'lt.config.json'), {
        commands: {
          fullstack: { frontend: 'nuxt' },
        },
      });

      const result = config.loadConfig(grandchildDir);

      // From root
      expect(result.commands?.server?.module?.controller).toBe('Rest');
      expect(result.commands?.fullstack?.git).toBe(true);
      expect(result.meta?.version).toBe('1.0.0');
      // From child
      expect(result.commands?.server?.module?.skipLint).toBe(true);
      expect(result.meta?.name).toBe('child-project');
      // From grandchild
      expect(result.commands?.fullstack?.frontend).toBe('nuxt');
    });

    it('should handle mixed file formats in hierarchy', () => {
      // Parent: JSON
      filesystem.write(filesystem.path(tempDir, 'lt.config.json'), {
        commands: {
          server: { module: { controller: 'Rest' } },
        },
      });

      // Child: YAML
      const yamlContent = `
commands:
  server:
    module:
      skipLint: true
`;
      filesystem.write(filesystem.path(childDir, 'lt.config.yaml'), yamlContent);

      const result = config.loadConfig(childDir);

      expect(result.commands?.server?.module?.controller).toBe('Rest');
      expect(result.commands?.server?.module?.skipLint).toBe(true);
    });
  });

  describe('Null Value Handling', () => {
    let childDir: string;

    beforeEach(() => {
      childDir = filesystem.path(tempDir, 'child');
      filesystem.dir(childDir);
    });

    it('should remove parent value when child sets null', () => {
      // Parent config with controller set
      filesystem.write(filesystem.path(tempDir, 'lt.config.json'), {
        commands: {
          server: {
            module: { controller: 'Rest', skipLint: true },
          },
        },
      });

      // Child config sets controller to null
      filesystem.write(filesystem.path(childDir, 'lt.config.json'), {
        commands: {
          server: {
            module: { controller: null },
          },
        },
      });

      const result = config.loadConfig(childDir);

      // controller should be undefined (deleted by null)
      expect(result.commands?.server?.module?.controller).toBeUndefined();
      // skipLint should still be inherited
      expect(result.commands?.server?.module?.skipLint).toBe(true);
    });

    it('should remove entire nested object when set to null', () => {
      // Parent config
      filesystem.write(filesystem.path(tempDir, 'lt.config.json'), {
        commands: {
          server: {
            module: { controller: 'Rest' },
            object: { skipLint: true },
          },
        },
      });

      // Child config removes entire server.module
      filesystem.write(filesystem.path(childDir, 'lt.config.json'), {
        commands: {
          server: {
            module: null,
          },
        },
      });

      const result = config.loadConfig(childDir);

      // module should be removed
      expect(result.commands?.server?.module).toBeUndefined();
      // object should still exist
      expect(result.commands?.server?.object?.skipLint).toBe(true);
    });

    it('should handle null in YAML format', () => {
      // Parent config with multiple properties
      filesystem.write(filesystem.path(tempDir, 'lt.config.json'), {
        commands: {
          server: {
            module: { controller: 'Rest', skipLint: true },
          },
        },
      });

      // Child YAML with null for controller
      const yamlContent = `
commands:
  server:
    module:
      controller: ~
`;
      filesystem.write(filesystem.path(childDir, 'lt.config.yaml'), yamlContent);

      const result = config.loadConfig(childDir);

      // controller should be undefined (deleted by null)
      expect(result.commands?.server?.module?.controller).toBeUndefined();
      // skipLint should still be inherited
      expect(result.commands?.server?.module?.skipLint).toBe(true);
    });
  });

  describe('Array Handling', () => {
    let childDir: string;

    beforeEach(() => {
      childDir = filesystem.path(tempDir, 'child');
      filesystem.dir(childDir);
    });

    it('should completely replace arrays (not merge them)', () => {
      // Parent config with array
      filesystem.write(filesystem.path(tempDir, 'lt.config.json'), {
        meta: {
          tags: ['tag1', 'tag2', 'tag3'],
        },
      });

      // Child config with different array
      filesystem.write(filesystem.path(childDir, 'lt.config.json'), {
        meta: {
          tags: ['newTag'],
        },
      });

      const result = config.loadConfig(childDir);

      expect(result.meta?.tags).toEqual(['newTag']);
      expect(result.meta?.tags).not.toContain('tag1');
    });

    it('should allow clearing arrays with empty array', () => {
      // Parent config with array
      filesystem.write(filesystem.path(tempDir, 'lt.config.json'), {
        meta: {
          tags: ['tag1', 'tag2'],
        },
      });

      // Child config with empty array
      filesystem.write(filesystem.path(childDir, 'lt.config.json'), {
        meta: {
          tags: [],
        },
      });

      const result = config.loadConfig(childDir);

      expect(result.meta?.tags).toEqual([]);
    });
  });

  describe('getValue Priority', () => {
    it('should return cliValue when all values provided', () => {
      const result = config.getValue({
        cliValue: 'cli',
        configValue: 'config',
        defaultValue: 'default',
        interactiveValue: undefined,
      });

      expect(result).toBe('cli');
    });

    it('should return configValue when no cliValue', () => {
      const result = config.getValue({
        cliValue: undefined,
        configValue: 'config',
        defaultValue: 'default',
      });

      expect(result).toBe('config');
    });

    it('should return defaultValue when no cli or config value', () => {
      const result = config.getValue({
        cliValue: undefined,
        configValue: undefined,
        defaultValue: 'default',
      });

      expect(result).toBe('default');
    });

    it('should return interactiveValue with highest priority when provided', () => {
      const result = config.getValue({
        cliValue: 'cli',
        configValue: 'config',
        defaultValue: 'default',
        interactiveValue: 'interactive',
      });

      expect(result).toBe('interactive');
    });

    it('should handle boolean false values correctly', () => {
      const result = config.getValue({
        cliValue: undefined,
        configValue: false,
        defaultValue: true,
      });

      expect(result).toBe(false);
    });

    it('should handle numeric zero values correctly', () => {
      const result = config.getValue({
        cliValue: undefined,
        configValue: 0,
        defaultValue: 10,
      });

      expect(result).toBe(0);
    });

    it('should treat null as unset value', () => {
      const result = config.getValue({
        cliValue: null,
        configValue: 'config',
        defaultValue: 'default',
      });

      expect(result).toBe('config');
    });

    it('should return globalValue when no cli or config value', () => {
      const result = config.getValue({
        cliValue: undefined,
        configValue: undefined,
        defaultValue: 'default',
        globalValue: 'global',
      });

      expect(result).toBe('global');
    });

    it('should prioritize configValue over globalValue', () => {
      const result = config.getValue({
        cliValue: undefined,
        configValue: 'config',
        defaultValue: 'default',
        globalValue: 'global',
      });

      expect(result).toBe('config');
    });

    it('should prioritize cliValue over globalValue', () => {
      const result = config.getValue({
        cliValue: 'cli',
        configValue: undefined,
        defaultValue: 'default',
        globalValue: 'global',
      });

      expect(result).toBe('cli');
    });

    it('should handle boolean false globalValue correctly', () => {
      const result = config.getValue({
        cliValue: undefined,
        configValue: undefined,
        defaultValue: true,
        globalValue: false,
      });

      expect(result).toBe(false);
    });
  });

  describe('getGlobalDefault', () => {
    it('should return global default value when present', () => {
      const ltConfig: LtConfig = {
        defaults: {
          author: 'Test Author <test@example.com>',
          noConfirm: true,
        },
      };

      expect(config.getGlobalDefault<string>(ltConfig, 'author')).toBe('Test Author <test@example.com>');
      expect(config.getGlobalDefault<boolean>(ltConfig, 'noConfirm')).toBe(true);
    });

    it('should return undefined when global default not present', () => {
      const ltConfig: LtConfig = {
        defaults: {
          author: 'Test Author',
        },
      };

      expect(config.getGlobalDefault<boolean>(ltConfig, 'noConfirm')).toBeUndefined();
      expect(config.getGlobalDefault<string>(ltConfig, 'baseBranch')).toBeUndefined();
    });

    it('should return undefined when defaults section is missing', () => {
      const ltConfig: LtConfig = {
        commands: {
          server: {
            module: { controller: 'Rest' },
          },
        },
      };

      expect(config.getGlobalDefault<string>(ltConfig, 'author')).toBeUndefined();
    });

    it('should return undefined when config is empty', () => {
      const ltConfig: LtConfig = {};

      expect(config.getGlobalDefault<string>(ltConfig, 'author')).toBeUndefined();
    });

    it('should handle all default keys', () => {
      const ltConfig: LtConfig = {
        defaults: {
          author: 'Author',
          baseBranch: 'develop',
          controller: 'Both',
          domain: '{name}.example.com',
          noConfirm: false,
          skipLint: true,
        },
      };

      expect(config.getGlobalDefault<string>(ltConfig, 'author')).toBe('Author');
      expect(config.getGlobalDefault<string>(ltConfig, 'baseBranch')).toBe('develop');
      expect(config.getGlobalDefault<string>(ltConfig, 'controller')).toBe('Both');
      expect(config.getGlobalDefault<string>(ltConfig, 'domain')).toBe('{name}.example.com');
      expect(config.getGlobalDefault<boolean>(ltConfig, 'noConfirm')).toBe(false);
      expect(config.getGlobalDefault<boolean>(ltConfig, 'skipLint')).toBe(true);
    });
  });

  describe('saveConfig', () => {
    it('should save configuration as JSON', () => {
      const newConfig: LtConfig = {
        commands: {
          server: {
            module: { controller: 'Rest' },
          },
        },
      };

      config.saveConfig(newConfig, tempDir);

      const savedContent = filesystem.read(filesystem.path(tempDir, 'lt.config.json'), 'json');
      expect(savedContent.commands.server.module.controller).toBe('Rest');
    });

    it('should save configuration as YAML when format specified', () => {
      const newConfig: LtConfig = {
        commands: {
          server: {
            module: { controller: 'GraphQL' },
          },
        },
      };

      config.saveConfig(newConfig, tempDir, { format: 'yaml' });

      const savedContent = filesystem.read(filesystem.path(tempDir, 'lt.config.yaml'));
      expect(savedContent).toContain('controller: GraphQL');
    });
  });

  describe('updateConfig', () => {
    it('should merge new config with existing config', () => {
      // Create initial config
      filesystem.write(filesystem.path(tempDir, 'lt.config.json'), {
        commands: {
          server: {
            module: { controller: 'Rest' },
          },
        },
        meta: { version: '1.0.0' },
      });

      // Update with new values
      config.updateConfig(
        {
          commands: {
            server: {
              module: { skipLint: true },
            },
          },
        },
        tempDir,
      );

      const result = config.loadConfig(tempDir);

      // Original value preserved
      expect(result.commands?.server?.module?.controller).toBe('Rest');
      expect(result.meta?.version).toBe('1.0.0');
      // New value added
      expect(result.commands?.server?.module?.skipLint).toBe(true);
    });
  });

  describe('Error Handling', () => {
    it('should return empty config when no config files exist', () => {
      const emptyDir = filesystem.path(tempDir, 'empty');
      filesystem.dir(emptyDir);

      const result = config.loadConfig(emptyDir);

      expect(result).toEqual({});
    });

    it('should skip invalid JSON files and continue', () => {
      filesystem.write(filesystem.path(tempDir, 'lt.config.json'), 'invalid json {{{');

      // Should not throw
      const result = config.loadConfig(tempDir);

      expect(result).toEqual({});
    });

    it('should skip invalid YAML files and continue', () => {
      filesystem.write(filesystem.path(tempDir, 'lt.config.yaml'), 'invalid: yaml: ::: :::');

      // Should not throw
      const result = config.loadConfig(tempDir);

      expect(result).toEqual({});
    });
  });

  describe('Real-world Scenarios', () => {
    it('should support complete lt.config example', () => {
      const fullConfig: LtConfig = {
        commands: {
          fullstack: {
            frontend: 'nuxt',
            git: true,
          },
          git: {
            defaultBranch: 'develop',
          },
          server: {
            addProp: {
              skipLint: false,
            },
            module: {
              controller: 'Both',
              skipLint: false,
            },
            object: {
              skipLint: false,
            },
          },
        },
        meta: {
          description: 'Test project configuration',
          name: 'test-project',
          version: '1.0.0',
        },
      };

      filesystem.write(filesystem.path(tempDir, 'lt.config.json'), fullConfig);

      const result = config.loadConfig(tempDir);

      expect(result).toEqual(fullConfig);
    });

    it('should handle monorepo structure with shared config', () => {
      // Root config (shared settings)
      filesystem.write(filesystem.path(tempDir, 'lt.config.json'), {
        commands: {
          server: {
            module: { controller: 'Both', skipLint: false },
          },
        },
        meta: { name: 'monorepo' },
      });

      // Projects directory
      const projectsDir = filesystem.path(tempDir, 'projects');
      filesystem.dir(projectsDir);

      // API project config
      const apiDir = filesystem.path(projectsDir, 'api');
      filesystem.dir(apiDir);
      filesystem.write(filesystem.path(apiDir, 'lt.config.json'), {
        commands: {
          server: {
            module: { controller: 'GraphQL' },
          },
        },
        meta: { name: 'api' },
      });

      // App project config
      const appDir = filesystem.path(projectsDir, 'app');
      filesystem.dir(appDir);
      filesystem.write(filesystem.path(appDir, 'lt.config.json'), {
        commands: {
          fullstack: { frontend: 'nuxt' },
        },
        meta: { name: 'app' },
      });

      // Test API project
      const apiResult = config.loadConfig(apiDir);
      expect(apiResult.commands?.server?.module?.controller).toBe('GraphQL');
      expect(apiResult.commands?.server?.module?.skipLint).toBe(false);
      expect(apiResult.meta?.name).toBe('api');

      // Test App project
      const appResult = config.loadConfig(appDir);
      expect(appResult.commands?.server?.module?.controller).toBe('Both');
      expect(appResult.commands?.fullstack?.frontend).toBe('nuxt');
      expect(appResult.meta?.name).toBe('app');
    });
  });
});
