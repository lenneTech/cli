import { buildReinitCommand } from '../src/lib/reinit-command';

describe('buildReinitCommand', () => {
  it('removes lockfile and node_modules, then installs — in the project directory', () => {
    expect(
      buildReinitCommand({ dir: '/work/app', install: 'pnpm install', lockfile: 'pnpm-lock.yaml' }),
    ).toBe('cd /work/app && rimraf pnpm-lock.yaml && rimraf node_modules && pnpm install');
  });

  // A reinit is scoped to ONE project. `pnpm store prune` empties the machine-wide store on
  // APFS (clone imports leave every store file with link count 1, which is exactly what prune
  // deletes), and `npm cache clean --force` / `yarn cache clean` wipe the shared caches the
  // same way — every other project then re-downloads, and a parallel install loses its files.
  it.each([
    ['npm', 'npm i', 'package-lock.json'],
    ['pnpm', 'pnpm install', 'pnpm-lock.yaml'],
    ['yarn', 'yarn install', 'yarn.lock'],
  ])('never touches a machine-wide cache (%s)', (_pm: string, install: string, lockfile: string) => {
    const command = buildReinitCommand({ dir: '/work/app', install, lockfile });
    expect(command).not.toMatch(/store prune|cache clean/);
  });
});
