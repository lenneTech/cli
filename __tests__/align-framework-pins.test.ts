/**
 * The vendor conversion merged nest-server's dependencies into the starter's package.json but
 * only ADDED what was missing, so every pin the two share stayed on the starter's version while
 * the cloned core was ahead (NestJS 11 next to a core for 12; 19 pins raised by hand in the
 * 2026-10-24 smoke run). `alignFrameworkPins` is the starter's own `pnpm run update` rule
 * (extras/align-package-versions.mjs) — these cases pin it, the section asymmetry above all.
 */
import { alignFrameworkPins, withExplicitStrictForTs6 } from '../src/lib/align-framework-pins';

const framework = {
  dependencies: {
    '@nestjs/common': '12.2.0',
    express: '5.3.0',
    mongodb: '7.7.0',
  },
  devDependencies: {
    '@nestjs/cli': '12.0.10',
    'better-auth': '1.7.12',
    typescript: '6.0.3',
    vitest: '5.0.5',
  },
};

describe('alignFrameworkPins', () => {
  it('raises an exact pin the project shares with the framework, in the section it holds it', () => {
    const pkg = {
      dependencies: { '@nestjs/common': '11.2.7', express: '5.2.1' },
      devDependencies: { '@nestjs/cli': '11.0.24', typescript: '5.9.3', vitest: '4.1.12' },
    };

    const { raised } = alignFrameworkPins(pkg, framework);

    expect(pkg.dependencies).toEqual({ '@nestjs/common': '12.2.0', express: '5.3.0' });
    expect(pkg.devDependencies).toEqual({ '@nestjs/cli': '12.0.10', typescript: '6.0.3', vitest: '5.0.5' });
    expect(raised).toContainEqual({ from: '11.2.7', name: '@nestjs/common', section: 'dependencies', to: '12.2.0' });
  });

  it('never lowers a pin that is already ahead of the framework', () => {
    const pkg = { dependencies: { express: '5.4.0' } };

    expect(alignFrameworkPins(pkg, framework).raised).toEqual([]);
    expect(pkg.dependencies.express).toBe('5.4.0');
  });

  it('does not let a framework devDependency set a runtime pin (the project owns better-auth)', () => {
    const pkg = { dependencies: { 'better-auth': '1.7.7' } };

    expect(alignFrameworkPins(pkg, framework).raised).toEqual([]);
    expect(pkg.dependencies['better-auth']).toBe('1.7.7');
  });

  it('lets a framework dependency raise a devDependency (mongodb kept for the auth adapter)', () => {
    const pkg = { devDependencies: { mongodb: '7.6.0' } };

    alignFrameworkPins(pkg, framework);

    expect(pkg.devDependencies.mongodb).toBe('7.7.0');
  });

  it('never adds a package the project does not declare, and never moves one', () => {
    const pkg: Record<string, any> = { dependencies: { express: '5.2.1' } };

    alignFrameworkPins(pkg, framework);

    expect(pkg).toEqual({ dependencies: { express: '5.3.0' } });
  });

  it('raises a range only when the framework version lies above the whole range', () => {
    const pkg = { devDependencies: { typescript: '~5.9.0', vitest: '^5.0.0' } };

    alignFrameworkPins(pkg, framework);

    expect(pkg.devDependencies.typescript).toBe('6.0.3');
    expect(pkg.devDependencies.vitest).toBe('^5.0.0');
  });

  it('reports what is neither a version nor a range instead of guessing', () => {
    const pkg = { dependencies: { express: 'github:expressjs/express' } };

    const { raised, skipped } = alignFrameworkPins(pkg, framework);

    expect(raised).toEqual([]);
    expect(skipped).toEqual([{ current: 'github:expressjs/express', name: 'express', section: 'dependencies' }]);
  });

  it('ignores the framework package itself and non-version framework entries', () => {
    const pkg = { dependencies: { '@lenne.tech/nest-server': '11.43.3', express: '5.2.1' } };

    alignFrameworkPins(pkg, {
      dependencies: { '@lenne.tech/nest-server': '12.0.0', express: 'workspace:*' },
    });

    expect(pkg.dependencies).toEqual({ '@lenne.tech/nest-server': '11.43.3', express: '5.2.1' });
  });
});

describe('withExplicitStrictForTs6', () => {
  const tsconfig = '{\n  "compilerOptions": {\n    "module": "commonjs",\n    "target": "es2022"\n  }\n}\n';

  it('adds "strict": false when TypeScript 6 meets a tsconfig that never set strict', () => {
    const patched = withExplicitStrictForTs6(tsconfig, '6.0.3');

    expect(patched).toContain('"compilerOptions": {\n    "strict": false,\n    "module": "commonjs"');
  });

  it('keeps an explicit strict of either value', () => {
    for (const value of ['true', 'false']) {
      const own = tsconfig.replace('"target": "es2022"', `"target": "es2022",\n    "strict": ${value}`);
      expect(withExplicitStrictForTs6(own, '6.0.3')).toBe(own);
    }
  });

  it('leaves TypeScript 5 projects and unknown versions alone', () => {
    expect(withExplicitStrictForTs6(tsconfig, '5.9.3')).toBe(tsconfig);
    expect(withExplicitStrictForTs6(tsconfig, undefined)).toBe(tsconfig);
    expect(withExplicitStrictForTs6(tsconfig, 'latest')).toBe(tsconfig);
  });

  it('reads the lower bound of a range', () => {
    expect(withExplicitStrictForTs6(tsconfig, '^6.0.0')).toContain('"strict": false');
    expect(withExplicitStrictForTs6(tsconfig, '^5.9.0')).toBe(tsconfig);
  });
});
