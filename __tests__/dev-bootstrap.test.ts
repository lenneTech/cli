import { existsSync, mkdirSync, mkdtempSync, rmSync, writeFileSync } from 'fs';
import { tmpdir } from 'os';
import { dirname, join } from 'path';

// Registry path override MUST be set before importing the module under test,
// because dev-state reads LT_DEV_REGISTRY_PATH at module-load time.
const REGISTRY_TMP = mkdtempSync(join(tmpdir(), 'lt-bootstrap-reg-'));
process.env.LT_DEV_REGISTRY_PATH = join(REGISTRY_TMP, 'projects.json');

import {
  isLtDevProject,
  isMachinePrepared,
  isProjectInitialized,
  shouldRunInitAfterInstall,
  shouldRunInstallBeforeInit,
} from '../src/lib/dev-bootstrap';
import { DevProjectLayout } from '../src/lib/dev-project';
import { getServicePaths } from '../src/lib/dev-service';

describe('dev-bootstrap', () => {
  // ── Pure chaining decisions ────────────────────────────────────────────────

  describe('shouldRunInstallBeforeInit', () => {
    const base = { machinePrepared: false, platformSupported: true, skipInstall: false };

    it('runs install when machine not prepared (supported, not opted out)', () => {
      expect(shouldRunInstallBeforeInit(base)).toBe(true);
    });
    it('does NOT run install once the machine is prepared (idempotent re-run)', () => {
      expect(shouldRunInstallBeforeInit({ ...base, machinePrepared: true })).toBe(false);
    });
    it('does NOT run install when opted out via --skip-install', () => {
      expect(shouldRunInstallBeforeInit({ ...base, skipInstall: true })).toBe(false);
    });
    it('does NOT run install on an unsupported platform', () => {
      expect(shouldRunInstallBeforeInit({ ...base, platformSupported: false })).toBe(false);
    });
  });

  describe('shouldRunInitAfterInstall', () => {
    const base = { isProject: true, projectInitialized: false, skipInit: false };

    it('runs init inside an un-initialized project (not opted out)', () => {
      expect(shouldRunInitAfterInstall(base)).toBe(true);
    });
    it('does NOT run init once the project is initialized (idempotent re-run)', () => {
      expect(shouldRunInitAfterInstall({ ...base, projectInitialized: true })).toBe(false);
    });
    it('does NOT run init when opted out via --skip-init', () => {
      expect(shouldRunInitAfterInstall({ ...base, skipInit: true })).toBe(false);
    });
    it('does NOT run init outside a project', () => {
      expect(shouldRunInitAfterInstall({ ...base, isProject: false })).toBe(false);
    });
  });

  // No-infinite-regress contract: when chaining install→init→…, the SECOND
  // hop's precondition is already satisfied, so it never chains back.
  describe('no infinite regress (one hop max)', () => {
    it('install→init: after install the machine is prepared, so init would not re-install', () => {
      // install runs because machine not prepared:
      expect(shouldRunInstallBeforeInit({ machinePrepared: false, platformSupported: true, skipInstall: false })).toBe(
        true,
      );
      // install completed → machine prepared → the auto-init would NOT loop back to install:
      expect(shouldRunInstallBeforeInit({ machinePrepared: true, platformSupported: true, skipInstall: false })).toBe(
        false,
      );
    });
    it('init→install: after init the project is initialized, so install would not re-init', () => {
      expect(shouldRunInitAfterInstall({ isProject: true, projectInitialized: false, skipInit: false })).toBe(true);
      expect(shouldRunInitAfterInstall({ isProject: true, projectInitialized: true, skipInit: false })).toBe(false);
    });
  });

  // ── Predicates against real filesystem / registry ───────────────────────────

  describe('isLtDevProject', () => {
    const layout = (over: Partial<DevProjectLayout>): DevProjectLayout => ({
      apiDir: null,
      appDir: null,
      root: '/x',
      workspace: false,
      ...over,
    });

    it('true when an API dir is present', () => {
      expect(isLtDevProject(layout({ apiDir: '/x/projects/api' }))).toBe(true);
    });
    it('true when an App dir is present', () => {
      expect(isLtDevProject(layout({ appDir: '/x/projects/app' }))).toBe(true);
    });
    it('false when neither is present', () => {
      expect(isLtDevProject(layout({}))).toBe(false);
    });
  });

  describe('isMachinePrepared', () => {
    let prevHome: string | undefined;
    let home: string;

    beforeEach(() => {
      prevHome = process.env.HOME;
      home = mkdtempSync(join(tmpdir(), 'lt-bootstrap-home-'));
      process.env.HOME = home;
    });
    afterEach(() => {
      if (prevHome === undefined) delete process.env.HOME;
      else process.env.HOME = prevHome;
      rmSync(home, { force: true, recursive: true });
    });

    it('false when the service unit file is absent', () => {
      expect(isMachinePrepared()).toBe(false);
    });

    it('true once the service unit file exists', () => {
      // Resolve the platform-correct unit path under the temp HOME, then create it.
      const unit = getServicePaths().unitFile;
      if (!unit) {
        // Unsupported platform — isMachinePrepared must stay false regardless.
        expect(isMachinePrepared()).toBe(false);
        return;
      }
      mkdirSync(dirname(unit), { recursive: true });
      writeFileSync(unit, 'stub');
      expect(existsSync(unit)).toBe(true);
      expect(isMachinePrepared()).toBe(true);
    });
  });

  describe('isProjectInitialized', () => {
    let projectRoot: string;

    beforeEach(() => {
      writeFileSync(process.env.LT_DEV_REGISTRY_PATH!, JSON.stringify({ projects: {}, version: 1 }));
      projectRoot = mkdtempSync(join(tmpdir(), 'lt-bootstrap-proj-'));
      writeFileSync(join(projectRoot, 'package.json'), JSON.stringify({ name: 'my-proj' }));
    });
    afterEach(() => {
      rmSync(projectRoot, { force: true, recursive: true });
    });

    const layout = (root: string): DevProjectLayout => ({ apiDir: null, appDir: root, root, workspace: false });

    it('false when the project is not in the registry', () => {
      expect(isProjectInitialized(layout(projectRoot))).toBe(false);
    });

    it('true when the registry has the slug pointing at this root', () => {
      writeFileSync(
        process.env.LT_DEV_REGISTRY_PATH!,
        JSON.stringify({
          projects: { 'my-proj': { internalPorts: {}, path: projectRoot, subdomains: {} } },
          version: 1,
        }),
      );
      expect(isProjectInitialized(layout(projectRoot))).toBe(true);
    });

    it('false when the registry slug points at a different path', () => {
      writeFileSync(
        process.env.LT_DEV_REGISTRY_PATH!,
        JSON.stringify({
          projects: { 'my-proj': { internalPorts: {}, path: '/somewhere/else', subdomains: {} } },
          version: 1,
        }),
      );
      expect(isProjectInitialized(layout(projectRoot))).toBe(false);
    });
  });

  afterAll(() => {
    rmSync(REGISTRY_TMP, { force: true, recursive: true });
  });
});
