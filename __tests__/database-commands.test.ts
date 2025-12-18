const { filesystem, system } = require('gluegun');

const src = filesystem.path(__dirname, '..');

const cli = async (cmd: string) =>
  system.run(`node ${filesystem.path(src, 'bin', 'lt')} ${cmd}`);

// Database commands require running services (MongoDB, Qdrant, Redis)
// These tests only verify the commands exist and can be invoked
// They will fail gracefully when services are not available

describe('Database Commands - Service Check', () => {
  describe('lt qdrant stats', () => {
    test('attempts to connect to Qdrant', async () => {
      try {
        const output = await cli('qdrant stats');
        // If Qdrant is running, we get stats
        expect(output).toBeDefined();
      } catch (e: any) {
        // If Qdrant is not running, we get an error message
        expect(e.message || e.stderr).toContain('Qdrant');
      }
    });
  });

  describe('lt qdrant delete', () => {
    test('attempts to connect to Qdrant', async () => {
      try {
        const output = await cli('qdrant delete');
        expect(output).toBeDefined();
      } catch (e: any) {
        // Expected when Qdrant is not running
        expect(e.message || e.stderr).toContain('Qdrant');
      }
    });
  });
});
