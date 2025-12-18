import { filesystem, system } from 'gluegun';

const src = filesystem.path(__dirname, '..');

const cli = async (cmd: string) =>
  system.run(`node ${filesystem.path(src, 'bin', 'lt')} ${cmd}`);

export {};

describe('Server Commands', () => {
  describe('lt server createSecret', () => {
    test('generates a secret', async () => {
      const output = await cli('server createSecret');
      // Should output a base64 string (at least 20 chars)
      expect(output.trim().length).toBeGreaterThan(20);
    });

    test('generates secret with custom length', async () => {
      const output = await cli('server createSecret --length 64');
      // Should output a longer base64 string
      expect(output.trim().length).toBeGreaterThan(80);
    });
  });
});
