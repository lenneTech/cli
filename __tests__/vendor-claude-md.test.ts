import {
  BACKEND_VENDOR_MARKER,
  buildBackendVendorBlock,
  buildFrontendVendorBlock,
  buildRootVendorBlock,
  FRONTEND_VENDOR_MARKER,
  hasVendorBlock,
  insertVendorBlockIfMissing,
  removeVendorBlock,
  ROOT_VENDOR_MARKER,
  upsertVendorBlock,
} from '../src/lib/vendor-claude-md';

describe('vendor-claude-md block builders', () => {
  it('backend block carries marker, update + contribute commands and npm-baseline hint', () => {
    const b = buildBackendVendorBlock();
    expect(b.startsWith(BACKEND_VENDOR_MARKER)).toBe(true);
    expect(b).toContain('/lt-dev:backend:update-nest-server-core');
    expect(b).toContain('/lt-dev:backend:contribute-nest-server-core');
    expect(b).toContain('/lt-dev:maintenance:maintain');
    expect(b).toContain('src/core/VENDOR.md');
    expect(b.trimEnd().endsWith('---')).toBe(true);
  });

  it('frontend block carries marker, update + contribute commands and npm-baseline hint', () => {
    const b = buildFrontendVendorBlock();
    expect(b.startsWith(FRONTEND_VENDOR_MARKER)).toBe(true);
    expect(b).toContain('/lt-dev:frontend:update-nuxt-extensions-core');
    expect(b).toContain('/lt-dev:frontend:contribute-nuxt-extensions-core');
    expect(b).toContain('/lt-dev:maintenance:maintain');
    expect(b).toContain('app/core/VENDOR.md');
    expect(b.trimEnd().endsWith('---')).toBe(true);
  });

  it('root block includes both halves when both are vendored', () => {
    const b = buildRootVendorBlock({ backend: true, frontend: true });
    expect(b.startsWith(ROOT_VENDOR_MARKER)).toBe(true);
    expect(b).toContain('/lt-dev:backend:update-nest-server-core');
    expect(b).toContain('/lt-dev:frontend:update-nuxt-extensions-core');
    expect(b).toContain('/lt-dev:backend:contribute-nest-server-core');
    expect(b).toContain('/lt-dev:frontend:contribute-nuxt-extensions-core');
    expect(b).toContain('projects/api/src/core/');
    expect(b).toContain('projects/app/app/core/');
  });

  it('root block omits the frontend when only backend is vendored', () => {
    const b = buildRootVendorBlock({ backend: true, frontend: false });
    expect(b).toContain('/lt-dev:backend:update-nest-server-core');
    expect(b).not.toContain('nuxt-extensions');
    expect(b).not.toContain('projects/app');
  });

  it('root block omits the backend when only frontend is vendored', () => {
    const b = buildRootVendorBlock({ backend: false, frontend: true });
    expect(b).toContain('/lt-dev:frontend:update-nuxt-extensions-core');
    expect(b).not.toContain('nest-server');
    expect(b).not.toContain('projects/api');
  });
});

describe('vendor-claude-md insert / upsert / remove', () => {
  const original = '# My Project\n\nSome project-specific docs.\n';

  it('hasVendorBlock detects the marker', () => {
    expect(hasVendorBlock(original, BACKEND_VENDOR_MARKER)).toBe(false);
    const withBlock = insertVendorBlockIfMissing(original, BACKEND_VENDOR_MARKER, buildBackendVendorBlock());
    expect(hasVendorBlock(withBlock, BACKEND_VENDOR_MARKER)).toBe(true);
  });

  it('insertVendorBlockIfMissing prepends only once', () => {
    const block = buildBackendVendorBlock();
    const once = insertVendorBlockIfMissing(original, BACKEND_VENDOR_MARKER, block);
    expect(once.startsWith(BACKEND_VENDOR_MARKER)).toBe(true);
    expect(once).toContain('# My Project');
    // Second call must be a no-op (does not stack a second block)
    const twice = insertVendorBlockIfMissing(once, BACKEND_VENDOR_MARKER, block);
    expect(twice).toBe(once);
    expect(twice.match(/lt-vendor-marker -->/g)?.length).toBe(1);
  });

  it('upsertVendorBlock inserts when missing and is idempotent', () => {
    const block = buildBackendVendorBlock();
    const inserted = upsertVendorBlock(original, BACKEND_VENDOR_MARKER, block);
    expect(inserted.startsWith(BACKEND_VENDOR_MARKER)).toBe(true);
    expect(inserted).toContain('# My Project');
    const again = upsertVendorBlock(inserted, BACKEND_VENDOR_MARKER, block);
    expect(again).toBe(inserted);
  });

  it('upsertVendorBlock heals a stale/drifted block while preserving the rest', () => {
    const stale = [
      BACKEND_VENDOR_MARKER,
      '',
      '# Old outdated notice',
      '',
      'this mentions nothing useful',
      '',
      '---',
      '# My Project',
      '',
      'Some project-specific docs.',
      '',
    ].join('\n');
    const healed = upsertVendorBlock(stale, BACKEND_VENDOR_MARKER, buildBackendVendorBlock());
    expect(healed).not.toContain('Old outdated notice');
    expect(healed).toContain('/lt-dev:backend:update-nest-server-core');
    expect(healed).toContain('# My Project');
    // Exactly one marker after healing
    expect(healed.match(/lt-vendor-marker -->/g)?.length).toBe(1);
  });

  it('removeVendorBlock restores the original content (insert → remove round trip)', () => {
    const withBlock = insertVendorBlockIfMissing(original, BACKEND_VENDOR_MARKER, buildBackendVendorBlock());
    const removed = removeVendorBlock(withBlock, BACKEND_VENDOR_MARKER);
    expect(removed).toBe(original);
  });

  it('removeVendorBlock is a no-op when the marker is absent', () => {
    expect(removeVendorBlock(original, BACKEND_VENDOR_MARKER)).toBe(original);
  });

  it('markers for backend / frontend / root are distinct', () => {
    const all = new Set([BACKEND_VENDOR_MARKER, FRONTEND_VENDOR_MARKER, ROOT_VENDOR_MARKER]);
    expect(all.size).toBe(3);
    // Backend marker must not be a substring of the frontend marker handling:
    // removing the frontend block must not touch a backend block and vice versa.
    const both = buildFrontendVendorBlock() + buildBackendVendorBlock() + 'tail\n';
    const onlyBackendLeft = removeVendorBlock(both, FRONTEND_VENDOR_MARKER);
    expect(onlyBackendLeft).toContain(BACKEND_VENDOR_MARKER);
    expect(onlyBackendLeft).not.toContain(FRONTEND_VENDOR_MARKER);
  });
});
