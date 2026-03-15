import { execSync } from 'child_process';

import { filesystem, system } from 'gluegun';

const src = filesystem.path(__dirname, '..');

const cli = async (cmd: string, timeout = 30000) =>
  system.run(`node ${filesystem.path(src, 'bin', 'lt')} ${cmd}`, { timeout });

// Synchronous check so test.skip can be determined at module load time
const isQdrantRunning = (): boolean => {
  try {
    execSync('curl -s -o /dev/null -w "%{http_code}" --connect-timeout 2 http://localhost:6333/collections', {
      timeout: 5000,
    });
    return true;
  } catch {
    return false;
  }
};

const qdrantRunning = isQdrantRunning();
const itRequiresQdrant = qdrantRunning ? test : test.skip;

export {};

// Database commands require running services (MongoDB, Qdrant, Redis)
// Tests are skipped when the required service is not available

describe('Database Commands', () => {
  describe('lt qdrant stats', () => {
    itRequiresQdrant('returns collection statistics', async () => {
      const output = await cli('qdrant stats');
      expect(output).toBeDefined();
    });
  });

  describe('lt qdrant delete', () => {
    itRequiresQdrant('can list collections for deletion', async () => {
      const output = await cli('qdrant stats');
      expect(output).toBeDefined();
    });
  });
});
