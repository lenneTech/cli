import type { Browser, BrowserContext } from 'playwright-core';

/**
 * Headless-browser HTML fetcher for single-page applications.
 *
 * Mirrors the chrome-md content script's PageReadyDetector:
 * waits for the network to settle, then returns the fully hydrated
 * HTML so Defuddle can extract the real content instead of the
 * pre-render shell.
 *
 * Uses `playwright-core` with a three-tier strategy:
 *   1. System Chrome / Edge via `channel: 'chrome' | 'msedge'`.
 *   2. Playwright's own bundled Chromium (if already installed).
 *   3. Auto-install Playwright's Chromium (`npx playwright install
 *      chromium`) and retry — opt-in via `autoInstall`.
 */
import { spawn } from 'child_process';

export interface BrowserFetcher {
  close: () => Promise<void>;
  engine: string;
  fetch: (url: string) => Promise<string>;
}

export interface BrowserFetcherOptions {
  /**
   * When no browser is available, automatically run
   * `npx playwright install chromium` and retry. Default `false`.
   */
  autoInstall?: boolean;
  /**
   * Extra time (ms) to wait after `networkidle` before extracting
   * HTML.
   */
  extraWaitMs?: number;
  /** Maximum time (ms) to wait for a single page navigation. */
  maxWaitMs?: number;
  /** Progress callback for install / engine messages. */
  onLog?: (message: string) => void;
  /** User agent string to present to the target site. */
  userAgent?: string;
}

const DEFAULT_USER_AGENT = 'Mozilla/5.0 (compatible; lenneTech-CLI-Crawler/1.0; +https://lenne.tech)';

/**
 * Try to construct a browser fetcher. Prefers a system Chrome /
 * Edge via Playwright channels, falls back to Playwright's bundled
 * Chromium, and (optionally) auto-installs Chromium on demand.
 */
export async function createBrowserFetcher(options: BrowserFetcherOptions = {}): Promise<BrowserFetcher> {
  const log = options.onLog || (() => undefined);
  const reasons: string[] = [];

  const { chromium } = require('playwright-core') as typeof import('playwright-core');

  // 1. System Chrome.
  const chromeFetcher = await launch(chromium, { channel: 'chrome' }, options, 'system-chrome').catch(
    (error: Error) => {
      reasons.push(`channel:chrome: ${error.message}`);
      return null;
    },
  );
  if (chromeFetcher) {
    log(`Browser engine: ${chromeFetcher.engine}`);
    return chromeFetcher;
  }

  // 2. System Edge (Windows fallback, also common on macOS).
  const edgeFetcher = await launch(chromium, { channel: 'msedge' }, options, 'system-edge').catch((error: Error) => {
    reasons.push(`channel:msedge: ${error.message}`);
    return null;
  });
  if (edgeFetcher) {
    log(`Browser engine: ${edgeFetcher.engine}`);
    return edgeFetcher;
  }

  // 3. Playwright's bundled Chromium.
  const bundledFetcher = await launch(chromium, {}, options, 'playwright-chromium').catch((error: Error) => {
    reasons.push(`playwright-chromium: ${error.message}`);
    return null;
  });
  if (bundledFetcher) {
    log(`Browser engine: ${bundledFetcher.engine}`);
    return bundledFetcher;
  }

  // 4. Optional auto-install, then retry Playwright's chromium.
  if (options.autoInstall) {
    log('No browser available — installing Playwright chromium (one-time download, ~170 MB)…');
    try {
      await runNpx(['playwright', 'install', 'chromium']);
      const retry = await launch(chromium, {}, options, 'playwright-chromium');
      if (retry) {
        log(`Browser engine: ${retry.engine}`);
        return retry;
      }
    } catch (error) {
      reasons.push(`auto-install: ${error instanceof Error ? error.message : String(error)}`);
    }
  }

  throw new Error(
    [
      'Could not start a headless browser for SPA rendering.',
      ...reasons.map((r) => `  - ${r}`),
      '',
      'Fix one of these:',
      '  1. Install Google Chrome or Microsoft Edge (Playwright picks them up automatically).',
      '  2. Install Playwright browsers manually: `npx playwright install chromium`.',
      '  3. Re-run with --install-browser to let the CLI install them.',
    ].join('\n'),
  );
}

async function launch(
  chromium: typeof import('playwright-core').chromium,
  launchOptions: Parameters<typeof import('playwright-core').chromium.launch>[0],
  options: BrowserFetcherOptions,
  engineLabel: string,
): Promise<BrowserFetcher | null> {
  const browser: Browser = await chromium.launch({ ...launchOptions, headless: true });
  const context: BrowserContext = await browser.newContext({
    userAgent: options.userAgent || DEFAULT_USER_AGENT,
  });

  return {
    close: async () => {
      await context.close();
      await browser.close();
    },
    engine: engineLabel,
    fetch: async (url: string) => {
      const page = await context.newPage();
      try {
        await page.goto(url, {
          timeout: options.maxWaitMs ?? 20000,
          waitUntil: 'networkidle',
        });
        if (options.extraWaitMs) {
          await page.waitForTimeout(options.extraWaitMs);
        }
        return await page.content();
      } finally {
        await page.close();
      }
    },
  };
}

/**
 * Run an `npx` command, streaming its output to the current stdio.
 * Resolves on exit code 0, rejects otherwise.
 */
function runNpx(args: string[]): Promise<void> {
  return new Promise((resolve, reject) => {
    const child = spawn('npx', args, { shell: false, stdio: 'inherit' });
    child.on('error', reject);
    child.on('exit', (code) => {
      if (code === 0) resolve();
      else reject(new Error(`npx ${args.join(' ')} exited with code ${code}`));
    });
  });
}
