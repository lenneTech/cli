import { filesystem, system } from 'gluegun';

const src = filesystem.path(__dirname, '..');

const cli = async (cmd: string, timeout = 10000) =>
  system.run(`node ${filesystem.path(src, 'bin', 'lt')} ${cmd}`, { timeout });

// Check if Qdrant is running
const isQdrantRunning = async (): Promise<boolean> => {
  try {
    await system.run(
      'curl -s -o /dev/null -w "%{http_code}" --connect-timeout 2 http://localhost:6333/collections',
      { timeout: 5000 },
    );
    return true;
  } catch {
    return false;
  }
};

export {};

// Database commands require running services (MongoDB, Qdrant, Redis)
// These tests only verify the commands exist and can be invoked
// They will fail gracefully when services are not available

describe('Database Commands - Service Check', () => {
  let qdrantRunning: boolean;

  beforeAll(async () => {
    qdrantRunning = await isQdrantRunning();
  });

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
    test('attempts to connect to Qdrant or handles interactive mode', async () => {
      // Skip this test when Qdrant is running because the command is interactive
      // and waits for user input to select a collection
      if (qdrantRunning) {
        // When Qdrant is running, just verify qdrant stats works (non-interactive)
        // This confirms the qdrant subcommands are functional
        const output = await cli('qdrant stats');
        expect(output).toBeDefined();
        return;
      }

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
