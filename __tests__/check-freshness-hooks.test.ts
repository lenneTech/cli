import { hookCheckFreshness, unhookCheckFreshness } from '../src/lib/check-freshness-hooks';

describe('hookCheckFreshness', () => {
  it('prepends the freshness step to check/check:fix/check:naf when there is no check:raw', () => {
    const s: Record<string, string> = {
      check: 'pnpm run lint && pnpm test',
      'check:fix': 'pnpm run lint:fix',
      'check:naf': 'pnpm test',
    };
    hookCheckFreshness(s);
    expect(s.check).toBe('pnpm run check:vendor-freshness && pnpm run lint && pnpm test');
    expect(s['check:fix']).toBe('pnpm run check:vendor-freshness && pnpm run lint:fix');
    expect(s['check:naf']).toBe('pnpm run check:vendor-freshness && pnpm test');
  });

  it('targets check:raw (and leaves the check.mjs wrapper untouched)', () => {
    const s: Record<string, string> = {
      check: 'node scripts/check.mjs',
      'check:raw': 'pnpm run lint && pnpm test',
    };
    hookCheckFreshness(s);
    expect(s.check).toBe('node scripts/check.mjs');
    expect(s['check:raw']).toBe('pnpm run check:vendor-freshness && pnpm run lint && pnpm test');
  });

  it('never prepends onto a check.mjs wrapper even without a check:raw', () => {
    const s: Record<string, string> = { check: 'node scripts/check.mjs' };
    hookCheckFreshness(s);
    expect(s.check).toBe('node scripts/check.mjs');
  });

  it('is idempotent (does not double-hook)', () => {
    const s: Record<string, string> = { check: 'pnpm test' };
    hookCheckFreshness(s);
    const once = s.check;
    hookCheckFreshness(s);
    expect(s.check).toBe(once);
  });

  it('preserves a leading `pnpm install && `', () => {
    const s: Record<string, string> = { 'check:fix': 'pnpm install && pnpm run lint:fix' };
    hookCheckFreshness(s);
    expect(s['check:fix']).toBe('pnpm install && pnpm run check:vendor-freshness && pnpm run lint:fix');
  });

  it('does not throw on an empty scripts object', () => {
    const s: Record<string, string> = {};
    expect(() => hookCheckFreshness(s)).not.toThrow();
    expect(s.check).toBeUndefined();
  });
});

describe('unhookCheckFreshness', () => {
  it('removes the freshness step + script from check/check:raw/check:fix/check:naf', () => {
    const s: Record<string, string> = {
      check: 'node scripts/check.mjs',
      'check:fix': 'pnpm run check:vendor-freshness && pnpm run lint:fix',
      'check:naf': 'pnpm run check:vendor-freshness && pnpm test',
      'check:raw': 'pnpm run check:vendor-freshness && pnpm test',
      'check:vendor-freshness': 'node -e "..."',
    };
    unhookCheckFreshness(s);
    expect(s['check:vendor-freshness']).toBeUndefined();
    expect(s['check:raw']).toBe('pnpm test');
    expect(s['check:fix']).toBe('pnpm run lint:fix');
    expect(s['check:naf']).toBe('pnpm test');
    expect(s.check).toBe('node scripts/check.mjs');
  });

  it('round-trips with hookCheckFreshness', () => {
    const original: Record<string, string> = {
      check: 'pnpm run lint && pnpm test',
      'check:fix': 'pnpm install && pnpm run lint:fix',
    };
    const s: Record<string, string> = { ...original, 'check:vendor-freshness': 'node -e "x"' };
    hookCheckFreshness(s);
    unhookCheckFreshness(s);
    expect(s.check).toBe(original.check);
    expect(s['check:fix']).toBe(original['check:fix']);
    expect(s['check:vendor-freshness']).toBeUndefined();
  });
});
