import { toNpmLoaderPath, toVendorLoaderPath } from '../src/lib/framework-loader-path';

const NPM = './node_modules/@lenne.tech/nest-server/dist/core/modules/migrate/helpers/ts-compiler.js';
const VENDOR = './src/core/modules/migrate/helpers/ts-compiler.js';

describe('framework loader path (nest-server >= 12 SWC loader)', () => {
  it('rewrites the nodemon exec of the starter to the vendored core and back', () => {
    const npmExec = `{ "exec": "node -r ${NPM} src/main.ts" }`;
    const vendorExec = `{ "exec": "node -r ${VENDOR} src/main.ts" }`;

    expect(toVendorLoaderPath(npmExec)).toBe(vendorExec);
    expect(toNpmLoaderPath(vendorExec)).toBe(npmExec);
  });

  it('handles the debug variant and a path without the ./ prefix', () => {
    expect(toVendorLoaderPath(`node --inspect-brk -r ${NPM} src/main.ts`)).toBe(
      `node --inspect-brk -r ${VENDOR} src/main.ts`,
    );
    expect(toVendorLoaderPath(`node -r ${NPM.slice(2)} x.ts`)).toBe(`node -r ${VENDOR.slice(2)} x.ts`);
  });

  it('rewrites every occurrence, e.g. a script that chains two runs', () => {
    const script = `node -r ${NPM} a.ts && node -r ${NPM} b.ts`;

    expect(toVendorLoaderPath(script)).toBe(`node -r ${VENDOR} a.ts && node -r ${VENDOR} b.ts`);
  });

  it('never touches a compiled vendored path (dist/src/core) or other files', () => {
    const untouched = [
      'node ./dist/src/core/modules/migrate/helpers/ts-compiler.js',
      'migrate up --compiler ts:./migrations-utils/ts-compiler.js',
      'ts-node -r tsconfig-paths/register src/main.ts',
    ].join('\n');

    expect(toNpmLoaderPath(untouched)).toBe(untouched);
    expect(toVendorLoaderPath(untouched)).toBe(untouched);
  });
});
