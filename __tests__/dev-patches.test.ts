import { mkdtempSync, readFileSync, rmSync, writeFileSync } from 'fs';
import { tmpdir } from 'os';
import { join } from 'path';

import {
  addToGitignore,
  autoPatch,
  canonicaliseBridgeSpan,
  patchApiConfig,
  patchClaudeMd,
  patchNuxtConfig,
  patchPlaywrightConfig,
} from '../src/lib/dev-patches';
import { DevIdentity } from '../src/lib/dev-identity';

const fullIdentity: DevIdentity = {
  root: '/tmp/fake',
  slug: 'crm',
  subdomains: {
    api: { hostname: 'api.crm.localhost', isPrimaryApp: false, subdir: 'projects/api' },
    app: { hostname: 'crm.localhost', isPrimaryApp: true, subdir: 'projects/app' },
  },
};

describe('dev-patches', () => {
  let tmp: string;
  beforeEach(() => {
    tmp = mkdtempSync(join(tmpdir(), 'lt-dev-patches-'));
  });
  afterEach(() => {
    rmSync(tmp, { recursive: true, force: true });
  });

  describe('patchApiConfig', () => {
    test('replaces hardcoded port', () => {
      const f = join(tmp, 'config.env.ts');
      writeFileSync(f, 'export default {\n    port: 3000,\n};');
      const r = patchApiConfig(f);
      expect(r.patched).toBe(true);
      expect(r.replacements).toBe(1);
      expect(readFileSync(f, 'utf8')).toContain('port: Number(process.env.PORT) || 3000');
    });
    test('idempotent on already-patched file', () => {
      const f = join(tmp, 'config.env.ts');
      writeFileSync(f, '    port: Number(process.env.PORT) || 3000,');
      const r = patchApiConfig(f);
      expect(r.patched).toBe(false);
    });
    test('replaces the localConfig NSC__PORT pattern', () => {
      const f = join(tmp, 'config.env.ts');
      writeFileSync(f, 'export default {\n    port: process.env.NSC__PORT ? parseInt(process.env.NSC__PORT, 10) : 3000,\n};');
      const r = patchApiConfig(f);
      expect(r.patched).toBe(true);
      expect(r.replacements).toBe(1);
      const out = readFileSync(f, 'utf8');
      expect(out).toContain('port: Number(process.env.PORT) || (process.env.NSC__PORT ? parseInt(process.env.NSC__PORT, 10) : 3000),');
    });
    test('patches both deployedConfig literal and localConfig NSC__PORT pattern', () => {
      const f = join(tmp, 'config.env.ts');
      writeFileSync(
        f,
        'function deployed() { return {\n    port: 3000,\n  }; }\n' +
          'function local() { return {\n    port: process.env.NSC__PORT ? parseInt(process.env.NSC__PORT, 10) : 3000,\n  }; }',
      );
      const r = patchApiConfig(f);
      expect(r.patched).toBe(true);
      expect(r.replacements).toBe(2);
    });
    test('idempotent on already-patched NSC__PORT pattern', () => {
      const f = join(tmp, 'config.env.ts');
      writeFileSync(f, '    port: Number(process.env.PORT) || (process.env.NSC__PORT ? parseInt(process.env.NSC__PORT, 10) : 3000),');
      const r = patchApiConfig(f);
      expect(r.patched).toBe(false);
    });
    test('missing file is no-op', () => {
      const r = patchApiConfig(join(tmp, 'missing.ts'));
      expect(r.patched).toBe(false);
    });
  });

  describe('patchNuxtConfig', () => {
    test('replaces hardcoded port + vite proxy target', () => {
      const f = join(tmp, 'nuxt.config.ts');
      writeFileSync(f, "    port: 3001,\n    target: 'http://localhost:3000',\n");
      const r = patchNuxtConfig(f);
      expect(r.patched).toBe(true);
      expect(r.replacements).toBe(2);
      const out = readFileSync(f, 'utf8');
      expect(out).toContain('port: Number(process.env.PORT) || 3001');
      expect(out).toContain("target: process.env.NUXT_API_URL || 'http://localhost:3000'");
    });
  });

  describe('patchPlaywrightConfig', () => {
    test('replaces baseURL/host/url', () => {
      const f = join(tmp, 'playwright.config.ts');
      writeFileSync(
        f,
        [
          "    baseURL: 'http://localhost:3001',",
          "    host: 'http://localhost:3001',",
          "    url: 'http://localhost:3001',",
        ].join('\n'),
      );
      const r = patchPlaywrightConfig(f);
      // 3 URL replacements + 1 bridge-block insertion = 4
      expect(r.replacements).toBe(4);
      const out = readFileSync(f, 'utf8');
      expect(out).toContain("baseURL: process.env.NUXT_PUBLIC_SITE_URL || 'http://localhost:3001'");
      expect(out).toContain("host: process.env.NUXT_PUBLIC_SITE_URL || 'http://localhost:3001'");
      expect(out).toContain("url: process.env.NUXT_PUBLIC_SITE_URL || 'http://localhost:3001'");
    });

    test('inserts the .lt-dev/.env bridge loader at the top of the file', () => {
      const f = join(tmp, 'playwright.config.ts');
      writeFileSync(f, "    baseURL: 'http://localhost:3001',\n");
      patchPlaywrightConfig(f);
      const out = readFileSync(f, 'utf8');
      expect(out).toMatch(/^\/\/ >>> lt-dev:bridge v\d+ >>>/);
      expect(out).toMatch(/\/\/ <<< lt-dev:bridge v\d+ <<</);
      expect(out).toContain(".lt-dev/.env");
      expect(out).toMatch(/process\.env\[.+\] === undefined/); // existing env wins
    });

    test('bridge block is oxfmt-compliant (expanded if + single-quoted utf8) so `lt dev` leaves no format-dirty config', () => {
      const f = join(tmp, 'playwright.config.ts');
      writeFileSync(f, "    baseURL: 'http://localhost:3001',\n");
      patchPlaywrightConfig(f);
      const out = readFileSync(f, 'utf8');
      // oxfmt expands a multi-statement `if` body onto its own lines — the
      // one-line form was the form `lt dev` used to inject and oxfmt rejected.
      expect(out).toContain('  if (__ltDevExists(__candidate)) {\n    __ltDevEnvFile = __candidate;\n    break;\n  }');
      expect(out).not.toContain('if (__ltDevExists(__candidate)) { __ltDevEnvFile = __candidate; break; }');
      // oxfmt prefers single quotes; a double-quoted literal here left every
      // `lt dev` run with a format-dirty playwright.config.ts (failing format:check).
      expect(out).toContain("__ltDevRead(__ltDevEnvFile, 'utf8')");
      expect(out).not.toContain('__ltDevRead(__ltDevEnvFile, "utf8")');
    });

    test('idempotent — bridge inserted only once', () => {
      const f = join(tmp, 'playwright.config.ts');
      writeFileSync(f, "    baseURL: 'http://localhost:3001',\n");
      patchPlaywrightConfig(f);
      patchPlaywrightConfig(f);
      const out = readFileSync(f, 'utf8');
      const matches = (out.match(/>>> lt-dev:bridge/g) || []).length;
      expect(matches).toBe(1);
    });

    test('idempotent against the consumer project formatter — no phantom diff after every run', () => {
      const f = join(tmp, 'playwright.config.ts');
      writeFileSync(f, "    baseURL: 'http://localhost:3001',\n");
      patchPlaywrightConfig(f);

      // Simulate the consumer's formatter normalising the injected block. Which
      // direction it flips is project-specific — do not assume one — so the
      // patcher must not care: rewriting the block back on every run leaves
      // playwright.config.ts permanently dirty in the working tree after each
      // `lt dev test`, with formatter and patcher flipping it forever.
      const formatted = readFileSync(f, 'utf8').replace(/'/g, '"');
      writeFileSync(f, formatted);

      // "after EVERY run" is the actual contract, so assert it stays stable.
      for (let i = 0; i < 3; i++) {
        const r = patchPlaywrightConfig(f);
        expect(r.patched).toBe(false);
        expect(r.replacements).toBe(0);
        expect(readFileSync(f, 'utf8')).toBe(formatted);
      }
    });

    test('leaves a block the formatter reflowed (whitespace only) alone', () => {
      const f = join(tmp, 'playwright.config.ts');
      writeFileSync(f, "    baseURL: 'http://localhost:3001',\n");
      patchPlaywrightConfig(f);

      // The whitespace axis of the comparison: re-indent every line and collapse
      // the multi-line `if` body onto one line — both things a formatter with a
      // different config legitimately does.
      const reflowed = readFileSync(f, 'utf8')
        .replace(/^ {2}/gm, '    ')
        .replace(
          '    if (__ltDevExists(__candidate)) {\n        __ltDevEnvFile = __candidate;\n        break;\n    }',
          '    if (__ltDevExists(__candidate)) { __ltDevEnvFile = __candidate; break; }',
        );
      expect(reflowed).not.toBe(readFileSync(f, 'utf8')); // guard: mutation applied
      writeFileSync(f, reflowed);

      const r = patchPlaywrightConfig(f);
      expect(r.patched).toBe(false);
      expect(readFileSync(f, 'utf8')).toBe(reflowed);
    });

    test('CRLF line endings are not treated as an outdated block', () => {
      const f = join(tmp, 'playwright.config.ts');
      writeFileSync(f, "    baseURL: 'http://localhost:3001',\n");
      patchPlaywrightConfig(f);
      const crlf = readFileSync(f, 'utf8').replace(/\n/g, '\r\n');
      writeFileSync(f, crlf);

      const r = patchPlaywrightConfig(f);
      expect(r.patched).toBe(false);
      expect(readFileSync(f, 'utf8')).toBe(crlf);
    });

    test('re-injects when the loader was folded behind a comment (inert block)', () => {
      const f = join(tmp, 'playwright.config.ts');
      writeFileSync(f, "    baseURL: 'http://localhost:3001',\n");
      patchPlaywrightConfig(f);

      // Merging a comment line with the following import swallows the loader:
      // every character survives, only a newline became a space. A comparison
      // that collapses `\s+` into ' ' cannot see the difference — and would
      // leave the bridge silently inert, so `.lt-dev/.env` never loads and
      // Playwright falls back to localhost:3001 (possibly another project).
      const inert = readFileSync(f, 'utf8').replace(
        'projects/app.\nimport { existsSync',
        'projects/app. import { existsSync',
      );
      expect(inert).not.toBe(readFileSync(f, 'utf8')); // guard: mutation applied
      writeFileSync(f, inert);

      const r = patchPlaywrightConfig(f);
      expect(r.patched).toBe(true);
      const out = readFileSync(f, 'utf8');
      expect(out).not.toMatch(/\/\/[^\n]*import \{ existsSync as __ltDevExists/);
      expect((out.match(/>>> lt-dev:bridge/g) || []).length).toBe(1);
    });

    test('re-injects when the whole block was flattened into one comment', () => {
      const f = join(tmp, 'playwright.config.ts');
      writeFileSync(f, "    baseURL: 'http://localhost:3001',\n");
      patchPlaywrightConfig(f);
      const flattened = readFileSync(f, 'utf8').replace(/\n/g, ' ');
      writeFileSync(f, flattened);

      expect(patchPlaywrightConfig(f).patched).toBe(true);
      expect(readFileSync(f, 'utf8')).toMatch(/^\/\/ >>> lt-dev:bridge v\d+ >>>\n/);
    });

    test('upgrades an unversioned (v1) block even when it differs only in formatting', () => {
      const f = join(tmp, 'playwright.config.ts');
      writeFileSync(f, "    baseURL: 'http://localhost:3001',\n");
      patchPlaywrightConfig(f);
      // Take the CURRENT block and downgrade it to the unversioned v1 marker,
      // changing nothing else. Content-wise it is semantically identical, so a
      // pure content comparison would call it up to date — but shipping a
      // formatting-only fix (as 1.32.1 did) must still reach such a project.
      const v1 = readFileSync(f, 'utf8')
        .replace(/\/\/ >>> lt-dev:bridge v\d+ >>>/, '// >>> lt-dev:bridge >>>')
        .replace(/\/\/ <<< lt-dev:bridge v\d+ <<</, '// <<< lt-dev:bridge <<<');
      writeFileSync(f, v1);

      const r = patchPlaywrightConfig(f);
      expect(r.patched).toBe(true);
      const out = readFileSync(f, 'utf8');
      expect(out).toMatch(/>>> lt-dev:bridge v\d+ >>>/);
      expect((out.match(/>>> lt-dev:bridge/g) || []).length).toBe(1);
    });

    test('drops bridge imports a formatter hoisted above the start marker', () => {
      const f = join(tmp, 'playwright.config.ts');
      writeFileSync(f, "    baseURL: 'http://localhost:3001',\n");
      patchPlaywrightConfig(f);
      // organize-imports moves the two bridge imports to the very top, i.e.
      // OUTSIDE the markers. Re-injecting the block verbatim would then declare
      // `__ltDevExists` twice → duplicate-identifier error in the consumer.
      const hoisted = readFileSync(f, 'utf8');
      const importLines = (hoisted.match(/^import \{[^}]*__ltDev[^}]*\} from '[^']*';$/gm) || []).join('\n');
      expect(importLines).not.toBe('');
      writeFileSync(f, `${importLines}\n${hoisted.replace(/\/\/ >>> lt-dev:bridge v\d+ >>>/, '// >>> lt-dev:bridge >>>')}`);

      patchPlaywrightConfig(f);
      const out = readFileSync(f, 'utf8');
      expect((out.match(/__ltDevExists as|as __ltDevExists/g) || []).length).toBe(1);
      expect((out.match(/as __ltDevDirname/g) || []).length).toBe(1);
    });

    test('reversed markers do not duplicate the surrounding user code', () => {
      const f = join(tmp, 'playwright.config.ts');
      writeFileSync(
        f,
        ['// <<< lt-dev:bridge <<<', "const keep = 'USER CODE';", '// >>> lt-dev:bridge >>>', 'export default {};'].join('\n'),
      );
      patchPlaywrightConfig(f);
      const out = readFileSync(f, 'utf8');
      expect((out.match(/const keep = 'USER CODE';/g) || []).length).toBe(1);
      expect((out.match(/>>> lt-dev:bridge/g) || []).length).toBe(1);
      expect((out.match(/<<< lt-dev:bridge/g) || []).length).toBe(1);
    });

    test('replaces an outdated bridge block with the upward-searching loader', () => {
      const f = join(tmp, 'playwright.config.ts');
      const oldBlock = [
        '// >>> lt-dev:bridge >>>',
        "import { existsSync as __ltDevExists, readFileSync as __ltDevRead } from 'node:fs';",
        "import { resolve as __ltDevResolve } from 'node:path';",
        "const __ltDevEnvFile = __ltDevResolve(process.cwd(), '.lt-dev/.env');",
        '// <<< lt-dev:bridge <<<',
      ].join('\n');
      writeFileSync(f, `${oldBlock}\nexport default {};\n`);
      const r = patchPlaywrightConfig(f);
      expect(r.patched).toBe(true);
      const out = readFileSync(f, 'utf8');
      expect((out.match(/>>> lt-dev:bridge/g) || []).length).toBe(1);
      expect(out).toMatch(/>>> lt-dev:bridge v\d+ >>>/); // upgraded to a versioned marker
      expect(out).toContain('__ltDevDirname');
      expect(out).not.toContain("__ltDevResolve(process.cwd(), '.lt-dev/.env')");
    });

    test('only inserts bridge when at least one URL patch happens or bridge is missing', () => {
      const f = join(tmp, 'playwright.config.ts');
      // Already env-aware, no bridge yet → bridge should be added
      writeFileSync(f, "    baseURL: process.env.NUXT_PUBLIC_SITE_URL || 'http://localhost:3001',\n");
      const r = patchPlaywrightConfig(f);
      expect(r.patched).toBe(true);
      expect(readFileSync(f, 'utf8')).toContain('lt-dev:bridge');
    });

    test('completely already-patched file: no-op', () => {
      const f = join(tmp, 'playwright.config.ts');
      writeFileSync(f, "    baseURL: 'http://localhost:3001',\n");
      // First pass applies the URL patch and inserts the current bridge block;
      // a second pass on the now fully-patched file must be a no-op. (A block
      // that is stale by VERSION or differs SEMANTICALLY is intentionally NOT a
      // no-op — see the outdated-block / v1-upgrade tests. A merely
      // formatting-stale block IS a no-op — see the formatter test.)
      patchPlaywrightConfig(f);
      const r = patchPlaywrightConfig(f);
      expect(r.patched).toBe(false);
    });

    test('wraps an unguarded webServer array in an LT_DEV_ACTIVE guard', () => {
      const f = join(tmp, 'playwright.config.ts');
      writeFileSync(f, ['export default {', '  webServer: [', "    { command: 'npm run start' },", '  ],', '};'].join('\n'));
      const r = patchPlaywrightConfig(f);
      expect(r.patched).toBe(true);
      const out = readFileSync(f, 'utf8');
      expect(out).toContain('webServer: process.env.LT_DEV_ACTIVE ? undefined : [');
      // The original array's closing bracket is preserved as the ternary's false branch.
      expect(out).toContain('  ],');
    });

    test('wraps an unguarded webServer object too', () => {
      const f = join(tmp, 'playwright.config.ts');
      writeFileSync(f, ['export default {', '  webServer: {', "    command: 'npm run start',", '  },', '};'].join('\n'));
      patchPlaywrightConfig(f);
      const out = readFileSync(f, 'utf8');
      expect(out).toContain('webServer: process.env.LT_DEV_ACTIVE ? undefined : {');
    });

    test('idempotent — does not double-wrap an already-guarded webServer', () => {
      const f = join(tmp, 'playwright.config.ts');
      writeFileSync(
        f,
        ['export default {', '  webServer: process.env.LT_DEV_ACTIVE ? undefined : [', "    { command: 'npm run start' },", '  ],', '};'].join('\n'),
      );
      patchPlaywrightConfig(f);
      const out = readFileSync(f, 'utf8');
      expect((out.match(/process\.env\.LT_DEV_ACTIVE \? undefined/g) || []).length).toBe(1);
    });

    test('no webServer present → no guard added', () => {
      const f = join(tmp, 'playwright.config.ts');
      writeFileSync(f, "    baseURL: process.env.NUXT_PUBLIC_SITE_URL || 'http://localhost:3001',\n");
      patchPlaywrightConfig(f);
      expect(readFileSync(f, 'utf8')).not.toContain('LT_DEV_ACTIVE');
    });

    test('adds lt-dev-test shard-readiness: ignoreHTTPSErrors + shard-aware timeouts + slowMo:0', () => {
      const f = join(tmp, 'playwright.config.ts');
      writeFileSync(
        f,
        [
          "import { defineConfig } from '@playwright/test';",
          "import { isWindows } from 'std-env';",
          'export default defineConfig({',
          '  timeout: isWindows ? 60_000 : 90_000,',
          '  expect: { timeout: 10_000 },',
          '  use: {',
          "    baseURL: process.env.NUXT_PUBLIC_SITE_URL || 'http://localhost:3001',",
          '    launchOptions: { slowMo: 10 },',
          '  },',
          '});',
        ].join('\n'),
      );
      const r = patchPlaywrightConfig(f);
      expect(r.patched).toBe(true);
      const out = readFileSync(f, 'utf8');
      expect(out).toContain('ignoreHTTPSErrors: true');
      expect(out).toMatch(/const SHARDED = Number\(process\.env\.LT_DEV_TEST_SHARDS/);
      expect(out).toContain('timeout: isWindows ? 60_000 : SHARDED ? 180_000 : 90_000');
      expect(out).toContain('expect: { timeout: SHARDED ? 30_000 : 10_000 }');
      expect(out).toMatch(/navigationTimeout:\s*SHARDED\s*\?\s*60_000/);
      expect(out).toMatch(/actionTimeout:\s*SHARDED\s*\?\s*30_000/);
      expect(out).toContain('slowMo: 0');
      expect(out).not.toMatch(/slowMo:\s*10\b/);
      // Idempotent: a second pass changes nothing.
      expect(patchPlaywrightConfig(f).patched).toBe(false);
    });
  });

  describe('bridge block invariants', () => {
    // The comparison maps BOTH quote characters to one and collapses runs of
    // whitespace. That is only semantics-preserving because no string literal
    // in the emitted block contains a quote or meaningful internal whitespace
    // (`normalise("const S = \"'\"")` === `normalise("const S = '\"'")`, which
    // are different values). Pin the assumption so a future edit to the block
    // fails here rather than silently making two different blocks compare equal.
    test('no emitted string literal contains a quote or whitespace', () => {
      const f = join(tmp, 'playwright.config.ts');
      writeFileSync(f, "    baseURL: 'http://localhost:3001',\n");
      patchPlaywrightConfig(f);
      const out = readFileSync(f, 'utf8');
      const block = out.slice(out.indexOf('// >>>'), out.indexOf('// <<<'));
      const literals = block
        .split(/\r?\n/)
        .filter((l) => !l.trim().startsWith('//'))
        .join('\n')
        .match(/'[^']*'|"[^"]*"/g) || [];
      expect(literals.length).toBeGreaterThan(0);
      for (const lit of literals) {
        expect(lit.slice(1, -1)).not.toMatch(/['"\s]/);
      }
    });

    test('canonicaliseBridgeSpan ignores block restyling but nothing outside it', () => {
      const f = join(tmp, 'playwright.config.ts');
      writeFileSync(f, "    baseURL: 'http://localhost:3001',\n");
      patchPlaywrightConfig(f);
      const original = readFileSync(f, 'utf8');

      // Restyling INSIDE the markers must compare equal...
      const endsAt = original.indexOf('// <<<');
      const restyled = original.slice(0, endsAt).replace(/'/g, '"') + original.slice(endsAt);
      expect(restyled).not.toBe(original); // guard: mutation applied
      expect(canonicaliseBridgeSpan(restyled)).toBe(canonicaliseBridgeSpan(original));

      // ...while a real edit OUTSIDE them must not.
      const edited = `${original}\nconst mine = 1;\n`;
      expect(canonicaliseBridgeSpan(edited)).not.toBe(canonicaliseBridgeSpan(original));
    });

    test('canonicaliseBridgeSpan is a no-op without a well-formed span', () => {
      expect(canonicaliseBridgeSpan('export default {};')).toBe('export default {};');
      const reversed = '// <<< lt-dev:bridge <<<\nx\n// >>> lt-dev:bridge >>>';
      expect(canonicaliseBridgeSpan(reversed)).toBe(reversed);
    });
  });

  describe('autoPatch dispatcher', () => {
    test('routes by filename suffix', () => {
      const a = join(tmp, 'config.env.ts');
      writeFileSync(a, '    port: 3000,');
      expect(autoPatch(a).patched).toBe(true);
      const b = join(tmp, 'unknown.ts');
      writeFileSync(b, 'whatever');
      expect(autoPatch(b).patched).toBe(false);
    });
  });

  describe('patchClaudeMd', () => {
    test('appends URL block to existing CLAUDE.md', () => {
      const f = join(tmp, 'CLAUDE.md');
      writeFileSync(f, '# Project notes\n');
      const r = patchClaudeMd(f, { dbName: 'crm-local', identity: fullIdentity });
      expect(r.patched).toBe(true);
      const out = readFileSync(f, 'utf8');
      expect(out).toContain('https://crm.localhost');
      expect(out).toContain('https://api.crm.localhost');
      expect(out).toContain('mongodb://127.0.0.1/crm-local');
      expect(out).toContain('<!-- lt-dev:url-block:start -->');
      expect(out).toContain('<!-- lt-dev:url-block:end -->');
    });
    test('idempotent: re-applies replace block in-place', () => {
      const f = join(tmp, 'CLAUDE.md');
      writeFileSync(f, '# X\n');
      patchClaudeMd(f, { dbName: 'crm-local', identity: fullIdentity });
      const r = patchClaudeMd(f, { dbName: 'crm-local', identity: fullIdentity });
      expect(r.patched).toBe(false);
      const matches = (readFileSync(f, 'utf8').match(/<!-- lt-dev:url-block:start -->/g) || []).length;
      expect(matches).toBe(1);
    });
    test('does not create CLAUDE.md from scratch', () => {
      const r = patchClaudeMd(join(tmp, 'missing.md'), { identity: fullIdentity });
      expect(r.patched).toBe(false);
    });
  });

  describe('addToGitignore', () => {
    test('appends entry when missing', () => {
      writeFileSync(join(tmp, '.gitignore'), 'node_modules/\n');
      expect(addToGitignore(tmp, '.lt-dev/')).toBe(true);
      expect(readFileSync(join(tmp, '.gitignore'), 'utf8')).toContain('.lt-dev/');
    });
    test('idempotent when already present', () => {
      writeFileSync(join(tmp, '.gitignore'), 'node_modules/\n.lt-dev/\n');
      expect(addToGitignore(tmp, '.lt-dev/')).toBe(false);
    });
    test('creates .gitignore when missing', () => {
      expect(addToGitignore(tmp, '.lt-dev/')).toBe(true);
      expect(readFileSync(join(tmp, '.gitignore'), 'utf8')).toContain('.lt-dev/');
    });
  });
});
