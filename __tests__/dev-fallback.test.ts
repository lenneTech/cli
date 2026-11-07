import { classicFallbackLine, classicStartTargets } from '../src/lib/dev-fallback';

describe('classic start as the fallback', () => {
  test('names both URLs for a workspace, only the present part otherwise', () => {
    expect(classicStartTargets({ api: true, app: true })).toBe(
      'the API on `http://localhost:3000` and the App on `http://localhost:3001`',
    );
    expect(classicStartTargets({ api: true, app: false }, false)).toBe('the API on http://localhost:3000');
    expect(classicStartTargets({ api: false, app: true }, false)).toBe('the App on http://localhost:3001');
  });

  test('one terminal line with the project package manager', () => {
    expect(classicFallbackLine({ api: true, app: true }, 'pnpm run start')).toBe(
      'Fallback: `pnpm run start` at the project root runs the API on http://localhost:3000 and the App on http://localhost:3001.',
    );
  });
});
