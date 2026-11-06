import { mkdirSync, mkdtempSync, realpathSync, rmSync, writeFileSync } from 'fs';
import { tmpdir } from 'os';
import { dirname, join } from 'path';

import { detectStandaloneKind } from '../src/lib/dev-identity';
import { hasFrontendBlocks, selectFrontendBlocks } from '../src/lib/frontend-claude-blocks';
import {
  detectFrontendFramework,
  detectFrontendKind,
  findFrontendAppDir,
  frontendFrameworkModeLabel,
} from '../src/lib/frontend-kind';
import { resolveFrontendFrameworkMode } from '../src/lib/frontend-mode-resolution';

let root: string;

function write(file: string, content: string): void {
  mkdirSync(dirname(file), { recursive: true });
  writeFileSync(file, content);
}

beforeEach(() => {
  root = realpathSync(mkdtempSync(join(tmpdir(), 'lt-frontend-kind-')));
});

afterEach(() => {
  rmSync(root, { force: true, recursive: true });
});

describe('detectFrontendKind', () => {
  test('decides by the config file first, then by the framework package', () => {
    write(join(root, 'nuxt', 'nuxt.config.ts'), '');
    write(join(root, 'ng', 'angular.json'), '{}');
    write(join(root, 'ng-deps', 'package.json'), JSON.stringify({ dependencies: { '@angular/core': '^22.2.0' } }));
    write(join(root, 'nuxt-deps', 'package.json'), JSON.stringify({ devDependencies: { nuxt: '^4.2.0' } }));
    write(join(root, 'api', 'package.json'), JSON.stringify({ dependencies: { '@nestjs/core': '^11.0.0' } }));
    expect(detectFrontendKind(join(root, 'nuxt'))).toBe('nuxt');
    expect(detectFrontendKind(join(root, 'ng'))).toBe('angular');
    expect(detectFrontendKind(join(root, 'ng-deps'))).toBe('angular');
    expect(detectFrontendKind(join(root, 'nuxt-deps'))).toBe('nuxt');
    expect(detectFrontendKind(join(root, 'api'))).toBeUndefined();
    expect(detectFrontendKind(join(root, 'missing'))).toBeUndefined();
  });

  test('detectFrontendFramework reports the mode of the lt library, null without one', () => {
    write(join(root, 'ng', 'angular.json'), '{}');
    write(join(root, 'ng', 'package.json'), JSON.stringify({ dependencies: { '@lenne.tech/ng-base': '^22.0.0' } }));
    write(join(root, 'plain', 'angular.json'), '{}');
    write(join(root, 'nuxt', 'nuxt.config.ts'), '');
    write(join(root, 'nuxt', 'app', 'core', 'VENDOR.md'), '# @lenne.tech/nuxt-extensions (vendored)');
    expect(detectFrontendFramework(join(root, 'ng'))).toEqual({ kind: 'angular', mode: 'npm' });
    expect(detectFrontendFramework(join(root, 'plain'))).toEqual({ kind: 'angular', mode: null });
    expect(detectFrontendFramework(join(root, 'nuxt'))).toEqual({ kind: 'nuxt', mode: 'vendor' });
  });

  test('findFrontendAppDir walks up to the Angular app', () => {
    write(join(root, 'app', 'angular.json'), '{}');
    mkdirSync(join(root, 'app', 'src', 'app', 'pages'), { recursive: true });
    expect(findFrontendAppDir(join(root, 'app', 'src', 'app', 'pages'))).toBe(join(root, 'app'));
  });

  test('labels name the library and its directory', () => {
    expect(frontendFrameworkModeLabel('angular', 'vendor')).toBe('vendor (src/core/, VENDOR.md)');
    expect(frontendFrameworkModeLabel('angular', 'npm')).toBe('npm (@lenne.tech/ng-base dependency)');
    expect(frontendFrameworkModeLabel('nuxt', 'npm')).toBe('npm (@lenne.tech/nuxt-extensions dependency)');
  });

  test('lt dev recognises a standalone Angular app', () => {
    write(join(root, 'ng', 'angular.json'), '{}');
    expect(detectStandaloneKind(join(root, 'ng'))).toEqual({ isApi: false, isApp: true });
  });
});

describe('selectFrontendBlocks', () => {
  const template = [
    '# Project',
    '',
    'Frontend: {{FRONTEND_FRAMEWORK}}',
    '',
    '<!-- lt:frontend nuxt -->',
    'Nuxt rules',
    '<!-- /lt:frontend -->',
    '',
    '<!-- lt:frontend angular -->',
    'Angular rules',
    '<!-- /lt:frontend -->',
    '',
    '## Shared',
    '',
  ].join('\n');

  test('keeps the chosen block without markers and drops the other', () => {
    // The blank lines around the dropped Nuxt block collapse into one.
    expect(selectFrontendBlocks(template, 'angular')).toEqual({
      content: ['# Project', '', 'Frontend: {{FRONTEND_FRAMEWORK}}', '', 'Angular rules', '', '## Shared', ''].join(
        '\n',
      ),
    });
    const nuxt = selectFrontendBlocks(template, 'nuxt').content;
    expect(nuxt).toContain('Nuxt rules');
    expect(nuxt).not.toContain('Angular rules');
    expect(hasFrontendBlocks(nuxt)).toBe(false);
  });

  test('keeps CRLF line endings', () => {
    const crlf = template.replace(/\n/g, '\r\n');
    const result = selectFrontendBlocks(crlf, 'nuxt').content;
    expect(result).toContain('Nuxt rules\r\n');
    expect(result).not.toMatch(/[^\r]\n/);
  });

  test.each([
    ['an unclosed block', '<!-- lt:frontend nuxt -->\nrest of the file\n'],
    ['a stray end marker', 'text\n<!-- /lt:frontend -->\n'],
    ['a nested block', '<!-- lt:frontend nuxt -->\n<!-- lt:frontend angular -->\nx\n<!-- /lt:frontend -->\n'],
  ])('leaves %s untouched and says why', (_label, content) => {
    const result = selectFrontendBlocks(content, 'angular');
    expect(result.content).toBe(content);
    expect(result.problem).toBeDefined();
  });

  test('a file without markers is unchanged', () => {
    expect(selectFrontendBlocks('# Plain\n', 'angular')).toEqual({ content: '# Plain\n' });
  });
});

describe('resolveFrontendFrameworkMode', () => {
  test('vendor is the default', () => {
    expect(resolveFrontendFrameworkMode({})).toEqual({ mode: 'vendor' });
  });

  test('precedence: frontend flag > workspace flag > frontend config > workspace config', () => {
    expect(
      resolveFrontendFrameworkMode({
        cliFrameworkMode: 'vendor',
        cliFrontendFrameworkMode: 'npm',
        configFrameworkMode: 'vendor',
        configFrontendFrameworkMode: 'vendor',
      }).mode,
    ).toBe('npm');
    expect(resolveFrontendFrameworkMode({ cliFrameworkMode: 'npm', configFrontendFrameworkMode: 'vendor' })).toEqual({
      mode: 'npm',
      source: '--framework-mode',
    });
    expect(
      resolveFrontendFrameworkMode({ configFrameworkMode: 'vendor', configFrontendFrameworkMode: 'npm' }).mode,
    ).toBe('npm');
    expect(resolveFrontendFrameworkMode({ configFrameworkMode: 'npm' }).mode).toBe('npm');
  });

  test('an invalid frontend flag is an error, an invalid workspace flag is ignored here', () => {
    expect(resolveFrontendFrameworkMode({ cliFrontendFrameworkMode: 'vendored' }).error).toContain('"vendored"');
    expect(resolveFrontendFrameworkMode({ cliFrameworkMode: 'x' })).toEqual({ mode: 'vendor' });
  });
});
