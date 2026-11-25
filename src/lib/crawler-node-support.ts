import * as semver from 'semver';

/**
 * Node versions `lt tools crawl` runs on: the `engines.node` range of jsdom, its HTML
 * parser (a test pins the two to each other). jsdom 31 dropped the CSS colour library
 * whose crash on nested `color-mix()` lost crawled pages (GHSA-6g4c-jm42-jc5r), and
 * raised its own floor with it. Every other command keeps running on older Node, because
 * `lt tools crawl` loads the crawler only when it runs.
 */
export const CRAWLER_NODE_RANGE = '^22.22.2 || ^24.15.0 || >=26.0.0';

/**
 * Whether the given Node version (default: the running one) can run the crawler.
 */
export function crawlerSupportsNode(version: string = process.versions.node): boolean {
  return semver.satisfies(version, CRAWLER_NODE_RANGE);
}
