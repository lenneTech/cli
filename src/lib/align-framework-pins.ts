import * as semver from 'semver';

/**
 * Raise the pins a freshly vendored project shares with nest-server to the core's versions.
 *
 * Vendor mode clones nest-server-starter and copies the nest-server core next to it. The
 * starter follows the framework only after an npm publish, so whenever the core is ahead,
 * the starter's pins describe an older framework: `@nestjs/common` 11.2.7 next to a core
 * written for 12.2.0, TypeScript 5.9 next to a core that needs 6. Merging the framework's
 * dependencies only ADDED what the project lacked, so every shared pin stayed behind; the
 * first vendor project after a framework major needed 19 pins raised by hand before
 * `lt dev up`, `lt dev test` or `pnpm run check` ran (smoke test, 2026-10-24).
 *
 * The rule is the starter's own `pnpm run update` (`extras/align-package-versions.mjs`,
 * `alignPackageVersions()`), which vendor mode replaces with a stub, and nest-server's
 * consumer gate (`scripts/check-consumer.mjs`, `alignConsumerPins()`). Keep it identical:
 *
 * - A package the project already declares is raised to the framework's version when that is
 *   newer, in the section the project keeps it. Never lowered, never moved, never added.
 * - What the framework SHIPS (`dependencies`) raises either section. What it only develops and
 *   tests with (`devDependencies`) raises only the project's devDependencies: the better-auth
 *   trio is a framework devDependency, the project holds it as a dependency and owns that
 *   version, because api and app must resolve the same better-auth.
 * - A range is raised only when the framework's version lies above the whole range; a range
 *   that already admits it is left open. Anything that is neither a version nor a range
 *   (`workspace:*`, a URL, a tag) is skipped and reported.
 */

export interface FrameworkManifest {
  dependencies?: Record<string, string>;
  devDependencies?: Record<string, string>;
}

export interface PinChange {
  from: string;
  name: string;
  section: 'dependencies' | 'devDependencies';
  to: string;
}

const SECTIONS = ['dependencies', 'devDependencies'] as const;

/** Which framework sections may raise a pin in each section of the project. */
const RAISE_SOURCES: Record<(typeof SECTIONS)[number], (typeof SECTIONS)[number][]> = {
  dependencies: ['dependencies'],
  devDependencies: ['dependencies', 'devDependencies'],
};

/**
 * Mutates `pkg` (the project's package.json) and returns what it raised and what it could not
 * compare.
 */
export function alignFrameworkPins(
  pkg: Record<string, any>,
  framework: FrameworkManifest,
): { raised: PinChange[]; skipped: { current: string; name: string; section: string }[] } {
  const raised: PinChange[] = [];
  const skipped: { current: string; name: string; section: string }[] = [];

  for (const section of SECTIONS) {
    const own = pkg[section];
    if (!own || typeof own !== 'object') continue;
    for (const [name, current] of Object.entries<unknown>(own)) {
      if (name === '@lenne.tech/nest-server' || typeof current !== 'string') continue;
      const target = newestFrameworkVersion(framework, name, RAISE_SOURCES[section]);
      if (!target) continue;

      if (semver.valid(current)) {
        if (semver.gt(target, current)) {
          own[name] = target;
          raised.push({ from: current, name, section, to: target });
        }
      } else if (semver.validRange(current)) {
        if (semver.gtr(target, current)) {
          own[name] = target;
          raised.push({ from: current, name, section, to: target });
        }
      } else {
        skipped.push({ current, name, section });
      }
    }
  }

  return { raised, skipped };
}

/**
 * TypeScript 6 turned `strict` on by default. A project raised from 5 to 6 by
 * `alignFrameworkPins` whose tsconfig does not set `strict` would compile the starter (and
 * the vendored core) under strict for the first time: hundreds of TS2322 / TS18048. The
 * migration guide (11.43.x → 12.0.x, §2) makes `"strict": false` explicit for exactly that
 * case. An explicit `strict` of either value is the project's decision and stays.
 *
 * Returns the tsconfig text unchanged unless `"compilerOptions": {` exists and no `"strict"`
 * key does (JSONC, so text-based like the other tsconfig patches in `server.ts`).
 */
export function withExplicitStrictForTs6(tsconfigRaw: string, typescriptVersion: string | undefined): string {
  let version: null | semver.SemVer = null;
  try {
    version = typescriptVersion ? semver.minVersion(typescriptVersion) : null;
  } catch {
    // Not a version or range (`latest`, a URL): nothing to decide on.
  }
  if (!version || version.major < 6) return tsconfigRaw;
  if (/"strict"\s*:/.test(tsconfigRaw)) return tsconfigRaw;
  return tsconfigRaw.replace(/("compilerOptions"\s*:\s*\{)/, '$1\n    "strict": false,');
}

/** The newest exact version the framework declares for `name` across `sections`. */
function newestFrameworkVersion(
  framework: FrameworkManifest,
  name: string,
  sections: (typeof SECTIONS)[number][],
): string | undefined {
  let newest: string | undefined;
  for (const section of sections) {
    const version = framework?.[section]?.[name];
    if (semver.valid(version) && (!newest || semver.gt(version as string, newest))) {
      newest = version as string;
    }
  }
  return newest;
}
