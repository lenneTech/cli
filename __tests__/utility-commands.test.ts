const { filesystem, system } = require('gluegun');

const src = filesystem.path(__dirname, '..');

const cli = async (cmd: string) =>
  system.run(`node ${  filesystem.path(src, 'bin', 'lt')  } ${cmd}`);

describe('Utility Commands', () => {
  describe('lt status', () => {
    test('outputs project status', async () => {
      const output = await cli('status');
      expect(output).toContain('Project Status');
      expect(output).toContain('Directory:');
    });
  });

  describe('lt doctor', () => {
    test('runs doctor checks', async () => {
      const output = await cli('doctor');
      expect(output).toContain('lt doctor');
      // Check for doctor output (may contain ANSI codes)
      expect(output).toContain('Checks:');
    });
  });

  describe('lt completion', () => {
    test('outputs help without arguments', async () => {
      const output = await cli('completion');
      expect(output).toContain('Usage: lt completion');
      expect(output).toContain('bash');
      expect(output).toContain('zsh');
      expect(output).toContain('fish');
    });

    test('generates bash completion', async () => {
      const output = await cli('completion bash');
      expect(output).toContain('_lt_completions');
      expect(output).toContain('complete -F _lt_completions lt');
    });

    test('generates zsh completion', async () => {
      const output = await cli('completion zsh');
      expect(output).toContain('#compdef lt');
      expect(output).toContain('_lt()');
    });

    test('generates fish completion', async () => {
      const output = await cli('completion fish');
      expect(output).toContain('# lt completion for Fish shell');
      expect(output).toContain('complete -f -c lt');
    });
  });

  describe('lt history', () => {
    test('outputs history or empty message', async () => {
      const output = await cli('history');
      // Either shows history or "No command history yet"
      expect(output.includes('Command History') || output.includes('No command history')).toBe(true);
    });
  });

  describe('lt templates list', () => {
    test('lists available templates', async () => {
      const output = await cli('templates list');
      expect(output).toContain('Available Templates');
      expect(output).toContain('Built-in Templates');
    });
  });

  describe('lt config validate', () => {
    test('reports when no config file found', async () => {
      // Run in a temp directory without config
      const tempDir = filesystem.path(filesystem.homedir(), `.lt-test-${  Date.now()}`);
      filesystem.dir(tempDir);

      try {
        const output = await system.run(
          `cd ${tempDir} && node ${filesystem.path(src, 'bin', 'lt')} config validate`
        );
        expect(output).toContain('No lt.config file found');
      } finally {
        filesystem.remove(tempDir);
      }
    });
  });
});

describe('Dry-run flags', () => {
  describe('lt git clear --dry-run', () => {
    test('shows dry-run message', async () => {
      const output = await cli('git clear --dry-run');
      expect(output).toContain('DRY-RUN MODE');
    });
  });

  describe('lt git clean --dry-run', () => {
    test('shows dry-run message', async () => {
      const output = await cli('git clean --dry-run');
      expect(output).toContain('DRY-RUN MODE');
    });
  });
});
