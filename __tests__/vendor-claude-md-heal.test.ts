export {};

// eslint-disable-next-line @typescript-eslint/no-require-imports
const { filesystem } = require('gluegun');

import {
  BACKEND_VENDOR_MARKER,
  FRONTEND_VENDOR_MARKER,
  healVendorClaudeMd,
  ROOT_VENDOR_MARKER,
} from '../src/lib/vendor-claude-md';

describe('healVendorClaudeMd (workspace sync)', () => {
  let root: string;

  const read = (rel: string): string => filesystem.read(filesystem.path(root, rel)) || '';

  beforeEach(() => {
    root = filesystem.path('__tests__', `temp-vendor-heal-${Date.now()}-${Math.floor(Math.random() * 1e6)}`);
    filesystem.dir(filesystem.path(root, 'projects', 'api'));
    filesystem.dir(filesystem.path(root, 'projects', 'app'));
    filesystem.write(filesystem.path(root, 'CLAUDE.md'), '# Workspace\n\nMonorepo docs.\n');
    filesystem.write(filesystem.path(root, 'projects', 'api', 'CLAUDE.md'), '# API\n\nApi docs.\n');
    filesystem.write(filesystem.path(root, 'projects', 'app', 'CLAUDE.md'), '# App\n\nApp docs.\n');
  });

  afterEach(() => {
    filesystem.remove(root);
  });

  const state = (backendVendor: boolean, frontendVendor: boolean) => ({
    apiDir: filesystem.path(root, 'projects', 'api'),
    appDir: filesystem.path(root, 'projects', 'app'),
    backendVendor,
    frontendVendor,
    workspaceRoot: root,
  });

  it('writes all three notices when both halves are vendored', () => {
    const changed = healVendorClaudeMd(filesystem, state(true, true));
    expect(changed.length).toBe(3);

    expect(read('projects/api/CLAUDE.md')).toContain(BACKEND_VENDOR_MARKER);
    expect(read('projects/api/CLAUDE.md')).toContain('# API'); // original kept
    expect(read('projects/app/CLAUDE.md')).toContain(FRONTEND_VENDOR_MARKER);
    expect(read('projects/app/CLAUDE.md')).toContain('# App');

    const rootMd = read('CLAUDE.md');
    expect(rootMd).toContain(ROOT_VENDOR_MARKER);
    expect(rootMd).toContain('/lt-dev:backend:update-nest-server-core');
    expect(rootMd).toContain('/lt-dev:frontend:update-nuxt-extensions-core');
    expect(rootMd).toContain('# Workspace');
  });

  it('only touches the backend + root when frontend is npm', () => {
    const changed = healVendorClaudeMd(filesystem, state(true, false));
    expect(changed.length).toBe(2);

    expect(read('projects/api/CLAUDE.md')).toContain(BACKEND_VENDOR_MARKER);
    expect(read('projects/app/CLAUDE.md')).not.toContain(FRONTEND_VENDOR_MARKER);

    const rootMd = read('CLAUDE.md');
    expect(rootMd).toContain(ROOT_VENDOR_MARKER);
    expect(rootMd).toContain('/lt-dev:backend:update-nest-server-core');
    expect(rootMd).not.toContain('nuxt-extensions');
  });

  it('is idempotent — a second run changes nothing', () => {
    healVendorClaudeMd(filesystem, state(true, true));
    const changed = healVendorClaudeMd(filesystem, state(true, true));
    expect(changed).toEqual([]);
  });

  it('removes notices again when converting back to npm', () => {
    healVendorClaudeMd(filesystem, state(true, true));
    const changed = healVendorClaudeMd(filesystem, state(false, false));
    expect(changed.length).toBe(3);

    expect(read('projects/api/CLAUDE.md')).not.toContain(BACKEND_VENDOR_MARKER);
    expect(read('projects/app/CLAUDE.md')).not.toContain(FRONTEND_VENDOR_MARKER);
    expect(read('CLAUDE.md')).not.toContain(ROOT_VENDOR_MARKER);
    // Original content survives the round trip
    expect(read('CLAUDE.md')).toContain('# Workspace');
    expect(read('projects/api/CLAUDE.md')).toContain('# API');
  });

  it('heals a pre-existing vendor project that never had a root notice', () => {
    // Simulate an old project: subprojects already vendored, root untouched.
    filesystem.write(
      filesystem.path(root, 'projects', 'api', 'CLAUDE.md'),
      `${BACKEND_VENDOR_MARKER}\n\n# Vendor-Mode Notice\n\nold\n\n---\n# API\n`,
    );
    const changed = healVendorClaudeMd(filesystem, state(true, false));
    // api gets refreshed, root gets the (previously missing) notice
    expect(changed).toContain(filesystem.path(root, 'CLAUDE.md'));
    expect(read('CLAUDE.md')).toContain(ROOT_VENDOR_MARKER);
    expect(read('projects/api/CLAUDE.md')).toContain('/lt-dev:backend:update-nest-server-core');
  });

  it('skips CLAUDE.md files that do not exist', () => {
    filesystem.remove(filesystem.path(root, 'projects', 'app', 'CLAUDE.md'));
    const changed = healVendorClaudeMd(filesystem, state(true, true));
    // app/CLAUDE.md absent → not in the changed list, no crash
    expect(changed).not.toContain(filesystem.path(root, 'projects', 'app', 'CLAUDE.md'));
    expect(read('projects/api/CLAUDE.md')).toContain(BACKEND_VENDOR_MARKER);
  });
});
