import { Server } from '../src/extensions/server';

const { filesystem } = require('gluegun');

/**
 * Create a minimal mock toolbox for Server instantiation
 */
function createMockToolbox() {
  return {
    filesystem,
    print: { info: () => {} },
    prompt: { ask: async () => ({}), confirm: async () => true },
    strings: {
      camelCase: (s: string) => s,
      kebabCase: (s: string) => s,
      pascalCase: (s: string) => s,
    },
  } as any;
}

describe('patchClaudeMdApiMode', () => {
  let server: Server;
  let tempDir: string;

  beforeEach(() => {
    server = new Server(createMockToolbox());
    tempDir = filesystem.path(
      '__tests__',
      `temp-patch-claude-md-${Date.now()}`,
    );
    filesystem.dir(tempDir);
  });

  afterEach(() => {
    filesystem.remove(tempDir);
  });

  test('should no-op when CLAUDE.md does not exist', () => {
    (server as any).patchClaudeMdApiMode(tempDir, 'Rest');
    expect(filesystem.exists(filesystem.path(tempDir, 'CLAUDE.md'))).toBeFalsy();
  });

  test('should no-op when apiMode is undefined', () => {
    const content = '- **API Mode:** REST (default) or GraphQL or Both';
    filesystem.write(filesystem.path(tempDir, 'CLAUDE.md'), content);

    (server as any).patchClaudeMdApiMode(tempDir, undefined);
    expect(filesystem.read(filesystem.path(tempDir, 'CLAUDE.md'))).toBe(content);
  });

  test('should no-op when CLAUDE.md is empty', () => {
    filesystem.write(filesystem.path(tempDir, 'CLAUDE.md'), '');

    (server as any).patchClaudeMdApiMode(tempDir, 'Rest');
    // Empty file — filesystem.read returns '' which is falsy, so early return
    const result = filesystem.read(filesystem.path(tempDir, 'CLAUDE.md'));
    expect(result).toBe('');
  });

  test('should replace API mode placeholder for Rest mode', () => {
    const content = [
      '# Project',
      '- **API Mode:** REST (default) or GraphQL or Both',
      '',
      '## API Mode System',
      'This section explains the API mode system.',
      'It has multiple lines.',
      '',
      '## Tooling',
      'Some tooling info.',
    ].join('\n');
    filesystem.write(filesystem.path(tempDir, 'CLAUDE.md'), content);

    (server as any).patchClaudeMdApiMode(tempDir, 'Rest');
    const result = filesystem.read(filesystem.path(tempDir, 'CLAUDE.md'));

    expect(result).toContain('- **API Mode:** Rest');
    expect(result).not.toContain('REST (default) or GraphQL or Both');
    expect(result).not.toContain('## API Mode System');
    expect(result).toContain('This project uses **Rest** mode');
    expect(result).toContain('## Tooling');
    expect(result).toContain('Some tooling info.');
  });

  test('should replace API mode placeholder for GraphQL mode', () => {
    const content = [
      '# Project',
      '- **API Mode:** REST (default) or GraphQL or Both',
      '',
      '## API Mode System',
      'GraphQL details here.',
      '',
      '## Framework:',
      'Framework info.',
    ].join('\n');
    filesystem.write(filesystem.path(tempDir, 'CLAUDE.md'), content);

    (server as any).patchClaudeMdApiMode(tempDir, 'GraphQL');
    const result = filesystem.read(filesystem.path(tempDir, 'CLAUDE.md'));

    expect(result).toContain('- **API Mode:** GraphQL');
    expect(result).not.toContain('## API Mode System');
    expect(result).toContain('This project uses **GraphQL** mode');
    expect(result).toContain('## Framework:');
    expect(result).toContain('Framework info.');
  });

  test('should only replace placeholder line for Both mode (keep section)', () => {
    const content = [
      '# Project',
      '- **API Mode:** REST (default) or GraphQL or Both',
      '',
      '## API Mode System',
      'Detailed API mode system docs.',
      '',
      '## Tooling',
      'Tooling info.',
    ].join('\n');
    filesystem.write(filesystem.path(tempDir, 'CLAUDE.md'), content);

    (server as any).patchClaudeMdApiMode(tempDir, 'Both');
    const result = filesystem.read(filesystem.path(tempDir, 'CLAUDE.md'));

    expect(result).toContain('- **API Mode:** Both');
    expect(result).not.toContain('REST (default) or GraphQL or Both');
    // Section should be preserved in Both mode
    expect(result).toContain('## API Mode System');
    expect(result).toContain('Detailed API mode system docs.');
  });

  test('should handle $ anchor when no next section header exists', () => {
    const content = [
      '# Project',
      '- **API Mode:** REST (default) or GraphQL or Both',
      '',
      '## API Mode System',
      'This is the last section.',
    ].join('\n');
    filesystem.write(filesystem.path(tempDir, 'CLAUDE.md'), content);

    (server as any).patchClaudeMdApiMode(tempDir, 'Rest');
    const result = filesystem.read(filesystem.path(tempDir, 'CLAUDE.md'));

    expect(result).toContain('- **API Mode:** Rest');
    expect(result).toContain('This project uses **Rest** mode');
    expect(result).not.toContain('This is the last section.');
  });
});
