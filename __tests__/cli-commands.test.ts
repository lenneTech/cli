const { filesystem, system } = require('gluegun');

const src = filesystem.path(__dirname, '..');

const cli = async (cmd: string) =>
  system.run(`node ${filesystem.path(src, 'bin', 'lt')} ${cmd}`);

describe('Config Commands', () => {
  describe('lt config show', () => {
    test('shows configuration or prompt to create', async () => {
      const output = await cli('config show');
      // Either shows config or prompts to create one
      expect(
        output.includes('Configuration') || output.includes('No configuration found')
      ).toBe(true);
    });
  });

  describe('lt config help', () => {
    test('shows config help', async () => {
      const output = await cli('config help');
      // Should contain configuration-related info
      expect(output.length).toBeGreaterThan(50);
    });
  });
});
