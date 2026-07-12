import {
  isValidDomain,
  isValidProjectSlug,
  mergeTurboOpsConfig,
  optionString,
  readJsonObject,
} from '../src/lib/turboops-config';

const { filesystem } = require('gluegun');

describe('turboops-config', () => {
  describe('optionString', () => {
    it('returns a trimmed non-empty string', () => {
      expect(optionString('  myproject  ')).toBe('myproject');
    });

    it('treats gluegun\'s valueless-flag boolean `true` as absent', () => {
      // `lt deployment create --project` (no value) → gluegun passes `true`.
      expect(optionString(true)).toBeUndefined();
    });

    it('treats whitespace-only and missing values as absent', () => {
      expect(optionString('   ')).toBeUndefined();
      expect(optionString(undefined)).toBeUndefined();
      expect(optionString(42)).toBeUndefined();
    });
  });

  describe('isValidProjectSlug', () => {
    it('accepts lowercase dash-separated slugs', () => {
      expect(isValidProjectSlug('myproject')).toBe(true);
      expect(isValidProjectSlug('my-project-2')).toBe(true);
    });

    it('rejects uppercase, underscores, spaces, and leading dashes', () => {
      expect(isValidProjectSlug('MyProject')).toBe(false);
      expect(isValidProjectSlug('my_project')).toBe(false);
      expect(isValidProjectSlug('my project')).toBe(false);
      expect(isValidProjectSlug('-project')).toBe(false);
      expect(isValidProjectSlug('')).toBe(false);
    });
  });

  describe('isValidDomain', () => {
    it('accepts plausible multi-label hostnames', () => {
      expect(isValidDomain('myproject.lenne.tech')).toBe(true);
      expect(isValidDomain('a.b')).toBe(true);
      expect(isValidDomain('sub.dev.example.com')).toBe(true);
    });

    it('rejects single labels, whitespace, and quote-injection payloads', () => {
      expect(isValidDomain('localhost')).toBe(false);
      expect(isValidDomain('has space.tech')).toBe(false);
      // the exact injection the validation exists to stop
      expect(isValidDomain("evil.test'; fetch('//x'); const _='")).toBe(false);
      expect(isValidDomain('')).toBe(false);
    });
  });

  describe('mergeTurboOpsConfig', () => {
    it('creates a fresh config when none exists', () => {
      expect(mergeTurboOpsConfig(undefined, 'acme')).toEqual({
        changed: true,
        config: { project: 'acme' },
      });
    });

    it('reports no change when the file is already exactly { project }', () => {
      const existing = { project: 'acme' };
      const result = mergeTurboOpsConfig(existing, 'acme');
      expect(result.changed).toBe(false);
      expect(result.config).toBe(existing);
      expect(result.previousProject).toBe('acme');
    });

    it('preserves hand-added user keys on a project rename (merge-not-clobber)', () => {
      const existing = { project: 'old', region: 'eu', stages: { dev: {} } };
      const result = mergeTurboOpsConfig(existing, 'new');
      expect(result.changed).toBe(true);
      expect(result.previousProject).toBe('old');
      expect(result.config).toEqual({ project: 'new', region: 'eu', stages: { dev: {} } });
    });

    it('adds project without dropping an existing config that lacks it', () => {
      const result = mergeTurboOpsConfig({ region: 'eu' }, 'acme');
      expect(result.changed).toBe(true);
      expect(result.previousProject).toBeUndefined();
      expect(result.config).toEqual({ region: 'eu', project: 'acme' });
    });

    it('re-writes (changed) when project matches but extra keys are present', () => {
      // Matches the command's byte-stable behaviour: extra keys → not "up to date".
      const result = mergeTurboOpsConfig({ project: 'acme', extra: 1 }, 'acme');
      expect(result.changed).toBe(true);
    });
  });

  describe('readJsonObject', () => {
    let tempDir: string;

    beforeEach(() => {
      tempDir = filesystem.path(
        filesystem.cwd(),
        '__tests__',
        'temp-turboops-' + Date.now() + '-' + Math.random().toString(36).slice(2),
      );
      filesystem.dir(tempDir);
    });

    afterEach(() => {
      if (filesystem.exists(tempDir)) {
        filesystem.remove(tempDir);
      }
    });

    it('reports not-found for an absent file', () => {
      expect(readJsonObject(filesystem, `${tempDir}/missing.json`)).toEqual({ found: false });
    });

    it('returns the parsed object for valid JSON', () => {
      const path = `${tempDir}/ok.json`;
      filesystem.write(path, JSON.stringify({ project: 'acme' }));
      expect(readJsonObject(filesystem, path)).toEqual({ found: true, value: { project: 'acme' } });
    });

    it('treats malformed JSON as found-but-unusable (never throws)', () => {
      const path = `${tempDir}/broken.json`;
      filesystem.write(path, '{ "project": ');
      const result = readJsonObject(filesystem, path);
      expect(result.found).toBe(true);
      expect(result.value).toBeUndefined();
    });

    it('treats a bare array/null as found-but-unusable', () => {
      const arrPath = `${tempDir}/arr.json`;
      filesystem.write(arrPath, '[1,2,3]');
      expect(readJsonObject(filesystem, arrPath)).toEqual({ found: true });

      const nullPath = `${tempDir}/null.json`;
      filesystem.write(nullPath, 'null');
      expect(readJsonObject(filesystem, nullPath)).toEqual({ found: true });
    });
  });
});
