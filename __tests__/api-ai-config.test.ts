import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from 'fs';
import { filesystem, system } from 'gluegun';
import { tmpdir } from 'os';
import { join } from 'path';

import { apiConfiguresAi } from '../src/lib/api-ai-config';

/**
 * nest-server switches CoreAiModule and its /ai/* routes on when an `ai` block is present
 * ("presence implies enabled", core.module.ts), and the env merge turns `NSC__AI__ENCRYPTION_SECRET`
 * alone into such a block. `lt deployment create` recommended that variable for every project, so a
 * stage of a project without AI got the module, while the local start did not.
 */
describe('apiConfiguresAi', () => {
  let api: string;
  beforeEach(() => {
    api = mkdtempSync(join(tmpdir(), 'lt-api-ai-'));
    mkdirSync(join(api, 'src'));
  });
  afterEach(() => {
    rmSync(api, { force: true, recursive: true });
  });

  const config = (body: string) => writeFileSync(join(api, 'src', 'config.env.ts'), body);

  test('an ai block in any environment counts', () => {
    config("const config = { local: { ai: { encryptionSecret: 'x' }, port: 3000 } };\nexport default config;\n");
    expect(apiConfiguresAi(api)).toBe(true);
  });

  test('`ai: true` counts', () => {
    config('export default { production: { ai: true } };\n');
    expect(apiConfiguresAi(api)).toBe(true);
  });

  test('a config without ai does not, nor does a commented-out example', () => {
    config("export default { local: { port: 3000 /* ai: { enabled: true } */ },\n  // ai: { encryptionSecret: 'x' },\n};\n");
    expect(apiConfiguresAi(api)).toBe(false);
  });

  test('`ai: false` and `ai: { enabled: false }` switch it off', () => {
    config('export default { local: { ai: false }, production: { ai: { enabled: false } } };\n');
    expect(apiConfiguresAi(api)).toBe(false);
  });

  test('no config.env.ts means no ai', () => {
    expect(apiConfiguresAi(join(api, 'missing'))).toBe(false);
  });
});

describe('lt deployment create names the AI secret only for an API with AI', () => {
  const root = mkdtempSync(join(tmpdir(), 'lt-deploy-ai-'));
  const cli = filesystem.path(__dirname, '..', 'bin', 'lt');

  afterAll(() => {
    rmSync(root, { force: true, recursive: true });
  });

  async function deploy(name: string, configEnv: string): Promise<string> {
    const ws = filesystem.path(root, name);
    filesystem.write(filesystem.path(ws, 'pnpm-workspace.yaml'), "packages:\n  - 'projects/*'\n");
    filesystem.write(filesystem.path(ws, 'package.json'), { name: 'shop', version: '0.0.0' });
    filesystem.write(filesystem.path(ws, 'projects', 'api', 'package.json'), { name: 'api', version: '0.0.0' });
    filesystem.write(filesystem.path(ws, 'projects', 'api', 'src', 'config.env.ts'), configEnv);
    filesystem.write(filesystem.path(ws, 'projects', 'app', 'nuxt.config.ts'), 'export default {};\n');
    filesystem.write(filesystem.path(ws, 'projects', 'app', 'package.json'), { name: 'app' });
    try {
      return await system.run(
        `node "${cli}" deployment create Shop --domain shop.example.com --project shop --noConfirm`,
        { cwd: ws },
      );
    } catch (err) {
      const e = err as { stderr?: string; stdout?: string };
      return `${e.stdout ?? ''}\n${e.stderr ?? ''}`;
    }
  }

  test('without an ai block the variable is not recommended, and the reason is named', async () => {
    const output = await deploy('no-ai', 'export default { local: { port: 3000 } };\n');
    expect(output).toContain('NSC__BETTER_AUTH__SECRET');
    expect(output).not.toMatch(/NSC__BETTER_AUTH__SECRET, NSC__AI__ENCRYPTION_SECRET/);
    expect(output).toMatch(/NSC__AI__\* only with an `ai` block/);
  });

  test('with an ai block it is recommended', async () => {
    const output = await deploy('with-ai', "export default { local: { ai: { encryptionSecret: 'x' } } };\n");
    expect(output).toContain('NSC__BETTER_AUTH__SECRET, NSC__AI__ENCRYPTION_SECRET,');
  });
});
