import { execFileSync } from 'child_process';

import { filesystem, system } from 'gluegun';

const src = filesystem.path(__dirname, '..');

// Give each `node bin/lt qdrant stats` sub-process enough headroom to
// cover Node cold-start + N+1 HTTP roundtrips under parallel test load.
const cli = async (cmd: string, timeout = 60000) =>
  system.run(`node ${filesystem.path(src, 'bin', 'lt')} ${cmd}`, { timeout });

/**
 * Synchronous liveness probe so `test.skip` can be decided at module
 * load. Tries two strategies in order:
 *
 *   1. `curl` with `--max-time` and an HTTP-status-code check (old
 *      probe only looked at curl's exit code, which is `0` even for
 *      500 / 404 — masking a dead server as "up").
 *   2. Plain TCP connect via `node -e` as a curl-less fallback so
 *      the suite works on minimal images that ship without curl.
 *
 * Returns true only when we've seen a 2xx status (probe 1) or a
 * successful TCP handshake (probe 2).
 */
const isQdrantRunning = (): boolean => {
  try {
    const out = execFileSync(
      'curl',
      [
        '-s',
        '-o',
        '/dev/null',
        '-w',
        '%{http_code}',
        '--connect-timeout',
        '2',
        '--max-time',
        '3',
        'http://localhost:6333/collections',
      ],
      { encoding: 'utf8', timeout: 5000 },
    );
    return /^2\d\d$/.test(out.trim());
  } catch {
    // curl missing or failed — try a raw TCP probe.
  }

  try {
    // Synchronous-ish TCP probe: spawn a short node script that
    // resolves the handshake and exits with 0 on success.
    execFileSync(
      'node',
      [
        '-e',
        `const s=require('net').connect({host:'127.0.0.1',port:6333,timeout:2000});` +
          `s.on('connect',()=>{s.destroy();process.exit(0)});` +
          `s.on('error',()=>process.exit(1));` +
          `s.on('timeout',()=>process.exit(1));`,
      ],
      { timeout: 5000 },
    );
    return true;
  } catch {
    return false;
  }
};

const qdrantRunning = isQdrantRunning();
const itRequiresQdrant = qdrantRunning ? test : test.skip;

export {};

// Database commands require running services (MongoDB, Qdrant, Redis)
// Tests are skipped when the required service is not available.

describe('Database Commands', () => {
  describe('lt qdrant stats', () => {
    itRequiresQdrant('returns collection statistics', async () => {
      const output = await cli('qdrant stats');
      expect(output).toBeDefined();
    });
  });
});
