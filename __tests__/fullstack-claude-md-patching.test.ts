// `export {}` keeps this file a TypeScript module so its top-level
// `filesystem` / `patching` do not collide with neighbouring test
// files that use the same names (TS2451 under ts-jest's shared
// program).
export {};

// eslint-disable-next-line @typescript-eslint/no-require-imports
const { filesystem, patching } = require('gluegun');

describe('Fullstack init CLAUDE.md patching', () => {
  let tempDir: string;

  beforeEach(() => {
    tempDir = filesystem.path(
      '__tests__',
      `temp-fullstack-claude-md-${Date.now()}`,
    );
    filesystem.dir(tempDir);
  });

  afterEach(() => {
    filesystem.remove(tempDir);
  });

  const claudeMdTemplate = [
    '# {{PROJECT_NAME}}',
    '',
    '## Overview',
    '- **Project:** {{PROJECT_NAME}}',
    '- **Directory:** {{PROJECT_DIR}}',
    '- **API Mode:** {{API_MODE}}',
    '- **Frontend:** {{FRONTEND_FRAMEWORK}}',
    '',
    '## Development',
    'Run `cd {{PROJECT_DIR}} && npm run dev`',
  ].join('\n');

  test('should replace all placeholders for nuxt frontend', async () => {
    const claudeMdPath = filesystem.path(tempDir, 'CLAUDE.md');
    filesystem.write(claudeMdPath, claudeMdTemplate);

    const name = 'my-awesome-project';
    const projectDir = '/home/user/projects/my-awesome-project';
    const apiMode = 'Rest';
    const frontend = 'nuxt';
    const frontendName = frontend === 'nuxt' ? 'Nuxt 4' : 'Angular';

    await patching.update(claudeMdPath, (content: string) =>
      content
        .replace(/\{\{PROJECT_NAME\}\}/g, () => name)
        .replace(/\{\{PROJECT_DIR\}\}/g, () => projectDir)
        .replace(/\{\{API_MODE\}\}/g, () => apiMode)
        .replace(/\{\{FRONTEND_FRAMEWORK\}\}/g, () => frontendName),
    );

    const result = filesystem.read(claudeMdPath);
    expect(result).toContain('# my-awesome-project');
    expect(result).toContain('- **Project:** my-awesome-project');
    expect(result).toContain('- **Directory:** /home/user/projects/my-awesome-project');
    expect(result).toContain('- **API Mode:** Rest');
    expect(result).toContain('- **Frontend:** Nuxt 4');
    expect(result).toContain('Run `cd /home/user/projects/my-awesome-project && npm run dev`');
    expect(result).not.toContain('{{');
  });

  test('should replace all placeholders for angular frontend', async () => {
    const claudeMdPath = filesystem.path(tempDir, 'CLAUDE.md');
    filesystem.write(claudeMdPath, claudeMdTemplate);

    const name = 'angular-app';
    const projectDir = '/tmp/angular-app';
    const apiMode = 'GraphQL';
    const frontend: string = 'angular';
    const frontendName = frontend === 'nuxt' ? 'Nuxt 4' : 'Angular';

    await patching.update(claudeMdPath, (content: string) =>
      content
        .replace(/\{\{PROJECT_NAME\}\}/g, () => name)
        .replace(/\{\{PROJECT_DIR\}\}/g, () => projectDir)
        .replace(/\{\{API_MODE\}\}/g, () => apiMode)
        .replace(/\{\{FRONTEND_FRAMEWORK\}\}/g, () => frontendName),
    );

    const result = filesystem.read(claudeMdPath);
    expect(result).toContain('# angular-app');
    expect(result).toContain('- **API Mode:** GraphQL');
    expect(result).toContain('- **Frontend:** Angular');
    expect(result).not.toContain('{{');
  });

  test('should handle name with special regex replacement characters', async () => {
    const claudeMdPath = filesystem.path(tempDir, 'CLAUDE.md');
    filesystem.write(claudeMdPath, claudeMdTemplate);

    // $& and $` are special replacement patterns in String.replace()
    // Using () => name prevents them from being interpreted
    const name = 'test$&project$`end';
    const projectDir = '/tmp/test';
    const apiMode = 'Both';
    const frontend = 'nuxt';
    const frontendName = frontend === 'nuxt' ? 'Nuxt 4' : 'Angular';

    await patching.update(claudeMdPath, (content: string) =>
      content
        .replace(/\{\{PROJECT_NAME\}\}/g, () => name)
        .replace(/\{\{PROJECT_DIR\}\}/g, () => projectDir)
        .replace(/\{\{API_MODE\}\}/g, () => apiMode)
        .replace(/\{\{FRONTEND_FRAMEWORK\}\}/g, () => frontendName),
    );

    const result = filesystem.read(claudeMdPath);
    // The special characters should be preserved literally, not interpreted
    expect(result).toContain('test$&project$`end');
    expect(result).not.toContain('{{');
  });

  test('should skip patching when CLAUDE.md does not exist', async () => {
    const claudeMdPath = filesystem.path(tempDir, 'CLAUDE.md');
    // Do NOT create the file

    if (filesystem.exists(claudeMdPath)) {
      await patching.update(claudeMdPath, (content: string) =>
        content.replace(/\{\{PROJECT_NAME\}\}/g, () => 'test'),
      );
    }

    // File should still not exist
    expect(filesystem.exists(claudeMdPath)).toBeFalsy();
  });
});
