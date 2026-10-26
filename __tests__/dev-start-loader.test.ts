/**
 * A nest-server 12 core imports `./x.js` everywhere, which ts-node 10 cannot resolve to `./x.ts`.
 * A vendored project's dev start therefore has to go through the core's own loader. Measured on a
 * real 12 vendor project: the starter's `ts-node -r tsconfig-paths/register src/main.ts` died with
 * `Cannot find module './core.module.js'`, the rewritten command answered on /health-check.
 */
import { toCoreLoaderCommand, VENDOR_CORE_LOADER } from '../src/lib/dev-start-loader';

const L = VENDOR_CORE_LOADER;

describe('toCoreLoaderCommand', () => {
  it("rewrites the starter's nodemon.json exec", () => {
    expect(toCoreLoaderCommand('ts-node -r tsconfig-paths/register src/main.ts')).toEqual({
      command: `node -r ${L} -r tsconfig-paths/register src/main.ts`,
      unconverted: [],
    });
  });

  it("swaps the register module in nodemon-debug.json's node call", () => {
    expect(
      toCoreLoaderCommand('node --inspect-brk -r ts-node/register -r tsconfig-paths/register src/main.ts').command,
    ).toBe(`node --inspect-brk -r ${L} -r tsconfig-paths/register src/main.ts`);
    expect(toCoreLoaderCommand('node -r ts-node/register/transpile-only x.ts').command).toBe(`node -r ${L} x.ts`);
  });

  it('rewrites only the ts-node link of a chain (docs:ci)', () => {
    expect(
      toCoreLoaderCommand('ts-node ./scripts/init-server.ts && pnpm run docs:bootstrap && compodoc -p tsconfig.json')
        .command,
    ).toBe(`node -r ${L} ./scripts/init-server.ts && pnpm run docs:bootstrap && compodoc -p tsconfig.json`);
  });

  it('keeps a cross-env / env prefix', () => {
    expect(toCoreLoaderCommand('cross-env NODE_ENV=local DEBUG=1 ts-node src/main.ts').command).toBe(
      `cross-env NODE_ENV=local DEBUG=1 node -r ${L} src/main.ts`,
    );
  });

  it('refuses a ts-node option node does not have, instead of guessing', () => {
    for (const command of ['ts-node -T src/main.ts', 'ts-node --project tsconfig.app.json src/main.ts', 'ts-node']) {
      expect(toCoreLoaderCommand(command)).toEqual({ command, unconverted: [command] });
    }
  });

  it('leaves everything else alone, and is idempotent', () => {
    for (const command of ['nest start --watch', 'vitest run --config vitest-e2e.config.ts', 'node dist/src/main.js']) {
      expect(toCoreLoaderCommand(command)).toEqual({ command, unconverted: [] });
    }
    const once = toCoreLoaderCommand('ts-node -r tsconfig-paths/register src/main.ts').command;
    expect(toCoreLoaderCommand(once).command).toBe(once);
  });
});
