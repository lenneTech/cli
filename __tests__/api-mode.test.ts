import { ApiMode } from '../src/extensions/api-mode';

const { filesystem } = require('gluegun');

/**
 * Create a minimal mock toolbox with only filesystem
 */
function createMockToolbox() {
  return { filesystem } as any;
}

/**
 * Create a test project directory with typical starter files
 */
function createTestProject(tempDir: string) {
  // package.json
  filesystem.write(filesystem.path(tempDir, 'package.json'), {
    dependencies: {
      '@lenne.tech/nest-server': '11.15.0',
      '@nestjs/common': '11.1.13',
      '@nestjs/graphql': '13.2.4',
      'graphql-subscriptions': '3.0.0',
      'graphql-upload': '15.0.2',
      'multer': '2.0.2',
    },
    devDependencies: {
      'json-to-graphql-query': '2.3.0',
      'supertest': '7.2.2',
    },
    name: 'test-project',
    scripts: {
      build: 'tsc',
      copy: 'npm run copy:assets && npm run copy:spectaql',
      'copy:spectaql': 'cpy ./spectaql.yml ./dist/',
      docs: 'compodoc',
      'docs:bootstrap': 'node scripts/run-spectaql.mjs',
      'docs:ci': 'ts-node ./scripts/init-server.ts && npm run docs:bootstrap',
      'strip-markers': 'node scripts/strip-api-mode-markers.mjs',
      test: 'vitest',
    },
    version: '0.0.1',
  }, { jsonIndent: 2 });

  // api-mode.manifest.json
  filesystem.write(filesystem.path(tempDir, 'api-mode.manifest.json'), {
    modes: {
      graphql: {
        devPackages: ['json-to-graphql-query'],
        filePatterns: [
          'src/server/modules/*/*.resolver.ts',
          'tests/**/*-graphql.e2e-spec.ts',
          'schema.gql',
        ],
        packages: ['graphql-subscriptions', 'graphql-upload'],
        regionMarker: 'graphql',
        scriptEdits: {
          copy: { remove: ' && npm run copy:spectaql' },
        },
        scripts: ['docs', 'docs:bootstrap', 'docs:ci', 'copy:spectaql'],
      },
      rest: {
        devPackages: [],
        filePatterns: [
          'src/server/modules/user/user.controller.ts',
          'src/server/modules/meta/meta.controller.ts',
          'tests/**/*-rest.e2e-spec.ts',
        ],
        packages: [],
        regionMarker: 'rest',
        scripts: [],
      },
    },
    version: '1.0.0',
  }, { jsonIndent: 2 });

  // strip-markers script
  filesystem.dir(filesystem.path(tempDir, 'scripts'));
  filesystem.write(filesystem.path(tempDir, 'scripts', 'strip-api-mode-markers.mjs'), '// strip markers');

  // Source files with region markers
  filesystem.dir(filesystem.path(tempDir, 'src', 'server', 'modules', 'user'));
  filesystem.dir(filesystem.path(tempDir, 'src', 'server', 'modules', 'meta'));

  filesystem.write(filesystem.path(tempDir, 'src', 'server', 'modules', 'user', 'user.module.ts'), [
    "import { Module } from '@nestjs/common';",
    '// #region graphql',
    "import { UserResolver } from './user.resolver';",
    '// #endregion graphql',
    '// #region rest',
    "import { UserController } from './user.controller';",
    '// #endregion rest',
    "import { UserService } from './user.service';",
    '',
    '@Module({',
    '  // #region rest',
    '  controllers: [UserController],',
    '  // #endregion rest',
    '  providers: [',
    '    // #region graphql',
    '    UserResolver,',
    '    // #endregion graphql',
    '    UserService,',
    '  ],',
    '})',
    'export class UserModule {}',
    '',
  ].join('\n'));

  filesystem.write(filesystem.path(tempDir, 'src', 'server', 'modules', 'user', 'user.resolver.ts'), 'export class UserResolver {}');
  filesystem.write(filesystem.path(tempDir, 'src', 'server', 'modules', 'user', 'user.controller.ts'), 'export class UserController {}');
  filesystem.write(filesystem.path(tempDir, 'src', 'server', 'modules', 'user', 'user.service.ts'), 'export class UserService {}');

  filesystem.write(filesystem.path(tempDir, 'src', 'server', 'modules', 'meta', 'meta.resolver.ts'), 'export class MetaResolver {}');
  filesystem.write(filesystem.path(tempDir, 'src', 'server', 'modules', 'meta', 'meta.controller.ts'), 'export class MetaController {}');

  // Schema file (GraphQL-only)
  filesystem.write(filesystem.path(tempDir, 'schema.gql'), 'type Query { hello: String }');

  // Test files
  filesystem.dir(filesystem.path(tempDir, 'tests', 'modules'));
  filesystem.write(filesystem.path(tempDir, 'tests', 'modules', 'user-graphql.e2e-spec.ts'), 'describe("GraphQL", () => {});');
  filesystem.write(filesystem.path(tempDir, 'tests', 'modules', 'user-rest.e2e-spec.ts'), 'describe("REST", () => {});');
  filesystem.write(filesystem.path(tempDir, 'tests', 'common.e2e-spec.ts'), 'describe("Common", () => {});');
}

describe('ApiMode Extension', () => {
  let apiMode: ApiMode;
  let tempDir: string;

  beforeEach(() => {
    apiMode = new ApiMode(createMockToolbox());
    tempDir = filesystem.path(filesystem.cwd(), '__tests__', 'temp-api-mode-' + Date.now());
    filesystem.dir(tempDir);
    createTestProject(tempDir);
  });

  afterEach(() => {
    if (filesystem.exists(tempDir)) {
      filesystem.remove(tempDir);
    }
  });

  describe('processApiMode - Rest', () => {
    it('should delete GraphQL files', async () => {
      await apiMode.processApiMode(tempDir, 'Rest');

      expect(filesystem.exists(filesystem.path(tempDir, 'src', 'server', 'modules', 'user', 'user.resolver.ts'))).toBeFalsy();
      expect(filesystem.exists(filesystem.path(tempDir, 'src', 'server', 'modules', 'meta', 'meta.resolver.ts'))).toBeFalsy();
      expect(filesystem.exists(filesystem.path(tempDir, 'schema.gql'))).toBeFalsy();
      expect(filesystem.exists(filesystem.path(tempDir, 'tests', 'modules', 'user-graphql.e2e-spec.ts'))).toBeFalsy();
    });

    it('should keep REST and shared files', async () => {
      await apiMode.processApiMode(tempDir, 'Rest');

      expect(filesystem.exists(filesystem.path(tempDir, 'src', 'server', 'modules', 'user', 'user.controller.ts'))).toBeTruthy();
      expect(filesystem.exists(filesystem.path(tempDir, 'src', 'server', 'modules', 'user', 'user.service.ts'))).toBeTruthy();
      expect(filesystem.exists(filesystem.path(tempDir, 'tests', 'modules', 'user-rest.e2e-spec.ts'))).toBeTruthy();
      expect(filesystem.exists(filesystem.path(tempDir, 'tests', 'common.e2e-spec.ts'))).toBeTruthy();
    });

    it('should remove GraphQL packages from package.json', async () => {
      await apiMode.processApiMode(tempDir, 'Rest');

      const pkg = JSON.parse(filesystem.read(filesystem.path(tempDir, 'package.json')));
      expect(pkg.dependencies['graphql-subscriptions']).toBeUndefined();
      expect(pkg.dependencies['graphql-upload']).toBeUndefined();
      expect(pkg.devDependencies['json-to-graphql-query']).toBeUndefined();
    });

    it('should keep non-GraphQL packages', async () => {
      await apiMode.processApiMode(tempDir, 'Rest');

      const pkg = JSON.parse(filesystem.read(filesystem.path(tempDir, 'package.json')));
      expect(pkg.dependencies['@lenne.tech/nest-server']).toBe('11.15.0');
      expect(pkg.dependencies['@nestjs/common']).toBe('11.1.13');
      expect(pkg.dependencies['multer']).toBe('2.0.2');
    });

    it('should remove GraphQL scripts', async () => {
      await apiMode.processApiMode(tempDir, 'Rest');

      const pkg = JSON.parse(filesystem.read(filesystem.path(tempDir, 'package.json')));
      expect(pkg.scripts.docs).toBeUndefined();
      expect(pkg.scripts['docs:bootstrap']).toBeUndefined();
      expect(pkg.scripts['docs:ci']).toBeUndefined();
      expect(pkg.scripts['copy:spectaql']).toBeUndefined();
    });

    it('should apply scriptEdits', async () => {
      await apiMode.processApiMode(tempDir, 'Rest');

      const pkg = JSON.parse(filesystem.read(filesystem.path(tempDir, 'package.json')));
      expect(pkg.scripts.copy).toBe('npm run copy:assets');
    });

    it('should strip graphql regions from source files', async () => {
      await apiMode.processApiMode(tempDir, 'Rest');

      const content = filesystem.read(filesystem.path(tempDir, 'src', 'server', 'modules', 'user', 'user.module.ts'));
      expect(content).not.toContain('UserResolver');
      expect(content).not.toContain('#region');
      expect(content).toContain('UserController');
      expect(content).toContain('UserService');
    });

    it('should clean orphan imports', async () => {
      await apiMode.processApiMode(tempDir, 'Rest');

      const content = filesystem.read(filesystem.path(tempDir, 'src', 'server', 'modules', 'user', 'user.module.ts'));
      expect(content).not.toContain('UserResolver');
      // UserController import should remain
      expect(content).toContain("import { UserController } from './user.controller'");
    });
  });

  describe('processApiMode - GraphQL', () => {
    it('should delete REST files', async () => {
      await apiMode.processApiMode(tempDir, 'GraphQL');

      expect(filesystem.exists(filesystem.path(tempDir, 'src', 'server', 'modules', 'user', 'user.controller.ts'))).toBeFalsy();
      expect(filesystem.exists(filesystem.path(tempDir, 'src', 'server', 'modules', 'meta', 'meta.controller.ts'))).toBeFalsy();
      expect(filesystem.exists(filesystem.path(tempDir, 'tests', 'modules', 'user-rest.e2e-spec.ts'))).toBeFalsy();
    });

    it('should keep GraphQL and shared files', async () => {
      await apiMode.processApiMode(tempDir, 'GraphQL');

      expect(filesystem.exists(filesystem.path(tempDir, 'src', 'server', 'modules', 'user', 'user.resolver.ts'))).toBeTruthy();
      expect(filesystem.exists(filesystem.path(tempDir, 'src', 'server', 'modules', 'user', 'user.service.ts'))).toBeTruthy();
      expect(filesystem.exists(filesystem.path(tempDir, 'schema.gql'))).toBeTruthy();
      expect(filesystem.exists(filesystem.path(tempDir, 'tests', 'modules', 'user-graphql.e2e-spec.ts'))).toBeTruthy();
    });

    it('should strip rest regions from source files', async () => {
      await apiMode.processApiMode(tempDir, 'GraphQL');

      const content = filesystem.read(filesystem.path(tempDir, 'src', 'server', 'modules', 'user', 'user.module.ts'));
      expect(content).not.toContain('UserController');
      expect(content).not.toContain('#region');
      expect(content).toContain('UserResolver');
      expect(content).toContain('UserService');
    });
  });

  describe('processApiMode - Both', () => {
    it('should keep all files', async () => {
      await apiMode.processApiMode(tempDir, 'Both');

      expect(filesystem.exists(filesystem.path(tempDir, 'src', 'server', 'modules', 'user', 'user.resolver.ts'))).toBeTruthy();
      expect(filesystem.exists(filesystem.path(tempDir, 'src', 'server', 'modules', 'user', 'user.controller.ts'))).toBeTruthy();
      expect(filesystem.exists(filesystem.path(tempDir, 'schema.gql'))).toBeTruthy();
    });

    it('should strip all markers but keep all content', async () => {
      await apiMode.processApiMode(tempDir, 'Both');

      const content = filesystem.read(filesystem.path(tempDir, 'src', 'server', 'modules', 'user', 'user.module.ts'));
      expect(content).not.toContain('#region');
      expect(content).toContain('UserResolver');
      expect(content).toContain('UserController');
      expect(content).toContain('UserService');
    });

    it('should not modify packages', async () => {
      await apiMode.processApiMode(tempDir, 'Both');

      const pkg = JSON.parse(filesystem.read(filesystem.path(tempDir, 'package.json')));
      expect(pkg.dependencies['graphql-subscriptions']).toBe('3.0.0');
      expect(pkg.dependencies['graphql-upload']).toBe('15.0.2');
      expect(pkg.dependencies['multer']).toBe('2.0.2');
    });
  });

  describe('Cleanup', () => {
    it('should remove manifest file', async () => {
      await apiMode.processApiMode(tempDir, 'Rest');
      expect(filesystem.exists(filesystem.path(tempDir, 'api-mode.manifest.json'))).toBeFalsy();
    });

    it('should remove strip-markers script file', async () => {
      await apiMode.processApiMode(tempDir, 'Rest');
      expect(filesystem.exists(filesystem.path(tempDir, 'scripts', 'strip-api-mode-markers.mjs'))).toBeFalsy();
    });

    it('should remove strip-markers from package.json scripts', async () => {
      await apiMode.processApiMode(tempDir, 'Rest');
      const pkg = JSON.parse(filesystem.read(filesystem.path(tempDir, 'package.json')));
      expect(pkg.scripts['strip-markers']).toBeUndefined();
    });

    it('should be a no-op without manifest', async () => {
      filesystem.remove(filesystem.path(tempDir, 'api-mode.manifest.json'));
      await apiMode.processApiMode(tempDir, 'Rest');
      // Should not crash, and resolver should still exist
      expect(filesystem.exists(filesystem.path(tempDir, 'src', 'server', 'modules', 'user', 'user.resolver.ts'))).toBeTruthy();
    });
  });

  describe('Region Processing Edge Cases', () => {
    it('should handle nested content between markers', async () => {
      filesystem.write(filesystem.path(tempDir, 'src', 'server', 'modules', 'user', 'user.module.ts'), [
        "import { Module } from '@nestjs/common';",
        '// #region graphql',
        "import { PubSub } from 'graphql-subscriptions';",
        "import { UserResolver } from './user.resolver';",
        '// #endregion graphql',
        "import { UserService } from './user.service';",
        '',
        '@Module({',
        '  providers: [',
        '    // #region graphql',
        '    UserResolver,',
        "    { provide: 'PUB_SUB', useValue: new PubSub() },",
        '    // #endregion graphql',
        '    UserService,',
        '  ],',
        '})',
        'export class UserModule {}',
        '',
      ].join('\n'));

      await apiMode.processApiMode(tempDir, 'Rest');

      const content = filesystem.read(filesystem.path(tempDir, 'src', 'server', 'modules', 'user', 'user.module.ts'));
      expect(content).not.toContain('UserResolver');
      expect(content).not.toContain('PubSub');
      expect(content).not.toContain('PUB_SUB');
      expect(content).toContain('UserService');
    });

    it('should collapse multiple blank lines after stripping', async () => {
      filesystem.write(filesystem.path(tempDir, 'src', 'server', 'modules', 'user', 'user.module.ts'), [
        'const a = 1;',
        '// #region graphql',
        'const b = 2;',
        '// #endregion graphql',
        '',
        '// #region graphql',
        'const c = 3;',
        '// #endregion graphql',
        '',
        'const d = 4;',
        '',
      ].join('\n'));

      await apiMode.processApiMode(tempDir, 'Rest');

      const content = filesystem.read(filesystem.path(tempDir, 'src', 'server', 'modules', 'user', 'user.module.ts'));
      // Should not have 3+ consecutive newlines
      expect(content).not.toMatch(/\n{3,}/);
      expect(content).toContain('const a = 1;');
      expect(content).toContain('const d = 4;');
    });

    it('should handle import alias resolution', async () => {
      filesystem.write(filesystem.path(tempDir, 'src', 'server', 'modules', 'user', 'user.module.ts'), [
        "import { Schema as MongooseSchema, UserResolver } from './types';",
        '',
        '// #region graphql',
        'const r = new UserResolver();',
        '// #endregion graphql',
        '',
        'const s = new MongooseSchema();',
        '',
      ].join('\n'));

      await apiMode.processApiMode(tempDir, 'Rest');

      const content = filesystem.read(filesystem.path(tempDir, 'src', 'server', 'modules', 'user', 'user.module.ts'));
      // MongooseSchema should be kept (alias is used)
      expect(content).toContain('Schema as MongooseSchema');
      // UserResolver should be removed (no longer used)
      expect(content).not.toContain('UserResolver');
    });
  });

  describe('config.env.ts Modification', () => {
    beforeEach(() => {
      filesystem.write(filesystem.path(tempDir, 'src', 'config.env.ts'), [
        "import { getEnvironmentConfig, IServerOptions } from '@lenne.tech/nest-server';",
        '',
        'const config: { [env: string]: IServerOptions } = {',
        '  local: {',
        '    graphQl: {',
        '      driver: { introspection: true, playground: true },',
        '      maxComplexity: 1000,',
        '    },',
        "    execAfterInit: 'npm run docs:bootstrap',",
        '    port: 3000,',
        '  },',
        '  develop: {',
        '    graphQl: {',
        '      driver: { introspection: true },',
        '    },',
        "    execAfterInit: 'npm run docs:bootstrap',",
        '    port: 3000,',
        '  },',
        '};',
        '',
        'export default getEnvironmentConfig({ config });',
        '',
      ].join('\n'));
    });

    it('should replace graphQl objects with false in REST mode', async () => {
      await apiMode.processApiMode(tempDir, 'Rest');

      const content = filesystem.read(filesystem.path(tempDir, 'src', 'config.env.ts'));
      expect(content).toContain('graphQl: false');
      expect(content).not.toContain('graphQl: {');
      expect(content).not.toContain('introspection');
    });

    it('should remove execAfterInit in REST mode', async () => {
      await apiMode.processApiMode(tempDir, 'Rest');

      const content = filesystem.read(filesystem.path(tempDir, 'src', 'config.env.ts'));
      expect(content).not.toContain('execAfterInit');
    });

    it('should preserve import statement', async () => {
      await apiMode.processApiMode(tempDir, 'Rest');

      const content = filesystem.read(filesystem.path(tempDir, 'src', 'config.env.ts'));
      expect(content).toContain("from '@lenne.tech/nest-server'");
    });

    it('should not modify config.env.ts in GraphQL mode', async () => {
      await apiMode.processApiMode(tempDir, 'GraphQL');
      const after = filesystem.read(filesystem.path(tempDir, 'src', 'config.env.ts'));

      expect(after).toContain('graphQl: {');
      expect(after).toContain('execAfterInit');
    });

    it('should not modify config.env.ts in Both mode', async () => {
      await apiMode.processApiMode(tempDir, 'Both');
      const content = filesystem.read(filesystem.path(tempDir, 'src', 'config.env.ts'));

      expect(content).toContain('graphQl: {');
      expect(content).toContain('execAfterInit');
    });
  });
});
