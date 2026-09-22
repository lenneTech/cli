import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from 'fs';
import { filesystem } from 'gluegun';
import { tmpdir } from 'os';
import { join } from 'path';

import {
  apiNeedsPortPatch,
  appNeedsPortPatch,
  deriveDbName,
  deriveTestDbName,
  resolveLayout,
} from '../src/lib/dev-project';

describe('dev-project', () => {
  let tmp: string;
  beforeEach(() => {
    tmp = mkdtempSync(join(tmpdir(), 'lt-dev-project-'));
  });
  afterEach(() => {
    rmSync(tmp, { recursive: true, force: true });
  });

  describe('resolveLayout — standalone API', () => {
    test('detects API by config.env.ts', () => {
      mkdirSync(join(tmp, 'src'));
      writeFileSync(join(tmp, 'src', 'config.env.ts'), '');
      writeFileSync(join(tmp, 'package.json'), JSON.stringify({ name: 'svc' }));
      const layout = resolveLayout(tmp, filesystem);
      expect(layout.apiDir).toBe(tmp);
      expect(layout.appDir).toBeNull();
      expect(layout.workspace).toBe(false);
    });
  });

  describe('resolveLayout — standalone App', () => {
    test('detects App by nuxt.config.ts', () => {
      writeFileSync(join(tmp, 'nuxt.config.ts'), '');
      writeFileSync(join(tmp, 'package.json'), JSON.stringify({ name: 'web' }));
      const layout = resolveLayout(tmp, filesystem);
      expect(layout.appDir).toBe(tmp);
      expect(layout.apiDir).toBeNull();
    });
  });

  // Regression: a settings-only `pnpm-workspace.yaml` (no `packages:`) is the
  // pnpm 10/11 home for `overrides` / `allowBuilds` and ships with BOTH
  // standalone starters. It used to satisfy the workspace marker, so
  // resolveLayout looked for projects/api|app, found neither, and `lt dev up`
  // aborted with "No API or App project detected at this path".
  describe('resolveLayout — settings-only pnpm-workspace.yaml', () => {
    const settingsOnlyYaml = 'overrides:\n  lodash: 4.18.1\nallowBuilds:\n  esbuild: true\n';

    test('App-only project is still detected', () => {
      writeFileSync(join(tmp, 'pnpm-workspace.yaml'), settingsOnlyYaml);
      writeFileSync(join(tmp, 'nuxt.config.ts'), '');
      writeFileSync(join(tmp, 'package.json'), JSON.stringify({ name: 'web' }));
      const layout = resolveLayout(tmp, filesystem);
      expect(layout.appDir).toBe(tmp);
      expect(layout.apiDir).toBeNull();
      expect(layout.workspace).toBe(false);
    });

    test('API-only project is still detected', () => {
      writeFileSync(join(tmp, 'pnpm-workspace.yaml'), settingsOnlyYaml);
      mkdirSync(join(tmp, 'src'));
      writeFileSync(join(tmp, 'src', 'config.env.ts'), '');
      writeFileSync(join(tmp, 'package.json'), JSON.stringify({ name: 'svc' }));
      const layout = resolveLayout(tmp, filesystem);
      expect(layout.apiDir).toBe(tmp);
      expect(layout.appDir).toBeNull();
    });
  });

  describe('resolveLayout — workspace marker without lt subprojects', () => {
    test('npm workspace using packages/* falls back to the standalone probe', () => {
      writeFileSync(join(tmp, 'package.json'), JSON.stringify({ name: 'web', workspaces: ['packages/*'] }));
      writeFileSync(join(tmp, 'nuxt.config.ts'), '');
      expect(resolveLayout(tmp, filesystem).appDir).toBe(tmp);
    });

    test('bare projects/ directory does not shadow a standalone App', () => {
      mkdirSync(join(tmp, 'projects'));
      writeFileSync(join(tmp, 'nuxt.config.ts'), '');
      writeFileSync(join(tmp, 'package.json'), JSON.stringify({ name: 'web' }));
      expect(resolveLayout(tmp, filesystem).appDir).toBe(tmp);
    });

    test('real monorepo still wins over the standalone probe', () => {
      writeFileSync(join(tmp, 'pnpm-workspace.yaml'), "packages:\n  - 'projects/*'\n");
      writeFileSync(join(tmp, 'package.json'), JSON.stringify({ name: 'crm' }));
      mkdirSync(join(tmp, 'projects', 'app'), { recursive: true });
      const layout = resolveLayout(tmp, filesystem);
      expect(layout.workspace).toBe(true);
      expect(layout.appDir).toBe(join(tmp, 'projects', 'app'));
      expect(layout.apiDir).toBeNull();
    });
  });

  describe('apiNeedsPortPatch', () => {
    test('flags hardcoded port', () => {
      mkdirSync(join(tmp, 'src'));
      writeFileSync(join(tmp, 'src', 'config.env.ts'), '    port: 3000,');
      expect(apiNeedsPortPatch(tmp)).toBe(join(tmp, 'src', 'config.env.ts'));
    });
    test('null when env-aware', () => {
      mkdirSync(join(tmp, 'src'));
      writeFileSync(join(tmp, 'src', 'config.env.ts'), 'port: Number(process.env.PORT) || 3000,');
      expect(apiNeedsPortPatch(tmp)).toBeNull();
    });
  });

  describe('appNeedsPortPatch', () => {
    test('flags hardcoded port + proxy target', () => {
      writeFileSync(join(tmp, 'nuxt.config.ts'), "port: 3001,\n target: 'http://localhost:3000'");
      writeFileSync(join(tmp, 'playwright.config.ts'), "baseURL: 'http://localhost:3001'");
      const out = appNeedsPortPatch(tmp);
      expect(out).toContain(join(tmp, 'nuxt.config.ts'));
      expect(out).toContain(join(tmp, 'playwright.config.ts'));
    });

    test('flags an unguarded Playwright webServer even when URLs are already env-aware', () => {
      writeFileSync(
        join(tmp, 'playwright.config.ts'),
        "baseURL: process.env.NUXT_PUBLIC_SITE_URL || 'http://localhost:3001',\n  webServer: [{ command: 'npm run start' }],",
      );
      expect(appNeedsPortPatch(tmp)).toContain(join(tmp, 'playwright.config.ts'));
    });

    test('does NOT flag a Playwright webServer that is already LT_DEV_ACTIVE-guarded', () => {
      writeFileSync(
        join(tmp, 'playwright.config.ts'),
        "baseURL: process.env.NUXT_PUBLIC_SITE_URL || 'http://localhost:3001',\n  webServer: process.env.LT_DEV_ACTIVE ? undefined : [{ command: 'npm run start' }],",
      );
      expect(appNeedsPortPatch(tmp)).not.toContain(join(tmp, 'playwright.config.ts'));
    });
  });

  describe('deriveDbName', () => {
    test('reads from config.env.ts when present', () => {
      mkdirSync(join(tmp, 'src'));
      writeFileSync(join(tmp, 'src', 'config.env.ts'), "    dbName: 'custom-name',");
      expect(deriveDbName(tmp, 'fallback')).toBe('custom-name');
    });
    test('falls back to <slug>-local', () => {
      expect(deriveDbName(null, 'crm')).toBe('crm-local');
    });
  });

  describe('deriveTestDbName', () => {
    test('strips -local suffix and appends -test', () => {
      expect(deriveTestDbName('crm-local')).toBe('crm-test');
    });
    test('strips -dev suffix too', () => {
      expect(deriveTestDbName('crm-dev')).toBe('crm-test');
    });
    test('case-insensitive suffix strip', () => {
      expect(deriveTestDbName('crm-LOCAL')).toBe('crm-test');
    });
    test('multi-segment slug stays intact', () => {
      expect(deriveTestDbName('svl-sports-system-local')).toBe('svl-sports-system-test');
    });
    test('no suffix to strip → still appends -test', () => {
      // Defensive: deriveDbName may return a custom name without -local.
      expect(deriveTestDbName('custom')).toBe('custom-test');
    });
  });
});

describe('resolveLayout absolutises its root', () => {
  const { resolveLayout } = require('../src/lib/dev-project');
  const nodeOs = require('os');
  const nodeFs = require('fs');
  const nodePath = require('path');
  const jetpack = require('fs-jetpack');

  it('turns a relative cwd into an absolute root — the value that reaches the registry', () => {
    // `lt fullstack init` calls this with `kebabCase(name)`, a bare segment, and
    // `up.ts` writes `layout.root` straight into `~/.lenneTech/projects.json` as
    // the project's `path`. Absolutising at the call site would fix today's
    // caller and invite the next one to repeat it.
    const parent = nodeFs.realpathSync(nodeFs.mkdtempSync(nodePath.join(nodeOs.tmpdir(), 'lt-abs-')));
    const name = 'demo-project';
    nodeFs.mkdirSync(nodePath.join(parent, name));
    const previous = process.cwd();
    try {
      process.chdir(parent);
      const layout = resolveLayout(name, jetpack);
      expect(nodePath.isAbsolute(layout.root)).toBe(true);
      expect(nodeFs.realpathSync(layout.root)).toBe(nodePath.join(parent, name));
    } finally {
      process.chdir(previous);
      nodeFs.rmSync(parent, { force: true, recursive: true });
    }
  });

  it('leaves an already absolute cwd alone', () => {
    const dir = nodeFs.realpathSync(nodeFs.mkdtempSync(nodePath.join(nodeOs.tmpdir(), 'lt-abs2-')));
    try {
      expect(resolveLayout(dir, jetpack).root).toBe(dir);
    } finally {
      nodeFs.rmSync(dir, { force: true, recursive: true });
    }
  });
});
