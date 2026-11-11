/**
 * `lt server addProp --prop-enum-0 ProbeStatus` (and `lt server module` / `object` with an enum
 * property) wrote `ProbeStatus` into model, input and create input without importing it, so `tsc`
 * failed with TS2304 in all three files (found by nest-server-starter-c6 in the 12.8.6 smoke test).
 * The enum file is the developer's (src/server/common/enums/, see lt-dev generating-nest-servers),
 * so the generators import a declaration they find and name the one they do not.
 */
import { mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'fs';
import { tmpdir } from 'os';
import { dirname, join } from 'path';

import { addEnumImports, conventionalEnumPath, findEnumDeclaration } from '../src/lib/enum-imports';

describe('enum imports for generated files', () => {
  let api: string;
  beforeEach(() => {
    api = mkdtempSync(join(tmpdir(), 'lt-enum-imports-'));
  });
  afterEach(() => {
    rmSync(api, { force: true, recursive: true });
  });

  const write = (rel: string, content: string): string => {
    const file = join(api, rel);
    mkdirSync(dirname(file), { recursive: true });
    writeFileSync(file, content);
    return file;
  };
  const model = (enumName: string): string =>
    write(
      'src/server/modules/probe/probe.model.ts',
      `import { UnifiedField } from '@lenne.tech/nest-server';\n\nexport class Probe {\n  @UnifiedField({ enum: { enum: ${enumName} } })\n  status: ${enumName} = undefined;\n}\n`,
    );

  test('finds the declaration in the project, never in the vendored core', () => {
    write('src/core/common/enums/probe-status.enum.ts', 'export enum ProbeStatus { A = "A" }\n');
    expect(findEnumDeclaration(api, 'ProbeStatus')).toBeNull();

    const own = write('src/server/common/enums/probe-status.enum.ts', "export enum ProbeStatus {\n  OPEN = 'OPEN',\n}\n");
    expect(findEnumDeclaration(api, 'ProbeStatus')).toBe(own);
  });

  test('a const enum counts, a name that only starts the same does not', () => {
    write('src/server/common/enums/status.enum.ts', "export enum StatusEnumLegacy { A = 'A' }\n");
    expect(findEnumDeclaration(api, 'StatusEnum')).toBeNull();
    const file = write('src/server/common/enums/status.enum.ts', "export const enum StatusEnum { A = 'A' }\n");
    expect(findEnumDeclaration(api, 'StatusEnum')).toBe(file);
  });

  test('imports a found enum with a relative path into every file that uses it', () => {
    write('src/server/common/enums/probe-status.enum.ts', "export enum ProbeStatus {\n  OPEN = 'OPEN',\n}\n");
    const modelFile = model('ProbeStatus');
    const input = write(
      'src/server/modules/probe/inputs/probe.input.ts',
      "export class ProbeInput {\n  status?: ProbeStatus = undefined;\n}\n",
    );
    const untouched = write('src/server/modules/probe/probe.service.ts', 'export class ProbeService {}\n');

    const missing = addEnumImports(api, [modelFile, input, untouched], ['ProbeStatus']);

    expect(missing).toEqual([]);
    expect(readFileSync(modelFile, 'utf8')).toContain("import { ProbeStatus } from '../../common/enums/probe-status.enum';");
    expect(readFileSync(input, 'utf8')).toContain("import { ProbeStatus } from '../../../common/enums/probe-status.enum';");
    expect(readFileSync(untouched, 'utf8')).toBe('export class ProbeService {}\n');
  });

  test('a second run adds nothing', () => {
    write('src/server/common/enums/probe-status.enum.ts', "export enum ProbeStatus {\n  OPEN = 'OPEN',\n}\n");
    const modelFile = model('ProbeStatus');
    addEnumImports(api, [modelFile], ['ProbeStatus']);
    const once = readFileSync(modelFile, 'utf8');

    addEnumImports(api, [modelFile], ['ProbeStatus']);

    expect(readFileSync(modelFile, 'utf8')).toBe(once);
  });

  test('an enum the project does not declare yet is reported and nothing is guessed', () => {
    const modelFile = model('ProbeStatus');
    const before = readFileSync(modelFile, 'utf8');

    expect(addEnumImports(api, [modelFile], ['ProbeStatus'])).toEqual(['ProbeStatus']);
    expect(readFileSync(modelFile, 'utf8')).toBe(before);
    expect(conventionalEnumPath('ProbeStatus')).toBe('src/server/common/enums/probe-status.enum.ts');
    expect(conventionalEnumPath('StatusEnum')).toBe('src/server/common/enums/status.enum.ts');
  });
});

describe('the server generators import the enums they write (wiring, the commands have no harness)', () => {
  const src = (f: string) => readFileSync(join(__dirname, '..', 'src', 'commands', 'server', f), 'utf8');

  test.each(['module.ts', 'object.ts', 'add-property.ts'])('%s calls addEnumImports before finishGeneratedImports', (f) => {
    const code = src(f);
    expect(code).toMatch(/addEnumImports\(/);
    expect(code.indexOf('addEnumImports(')).toBeLessThan(code.lastIndexOf('finishGeneratedImports('));
  });
});
