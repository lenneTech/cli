import { readFileSync } from 'fs';
import { join } from 'path';

import { CRAWLER_NODE_RANGE, crawlerSupportsNode } from '../src/lib/crawler-node-support';

describe('crawler Node support', () => {
  test('the range is exactly what the installed jsdom declares', () => {
    const jsdom = JSON.parse(readFileSync(join(__dirname, '..', 'node_modules', 'jsdom', 'package.json'), 'utf-8'));
    expect(CRAWLER_NODE_RANGE).toBe(jsdom.engines.node);
  });

  test.each([
    ['20.19.0', false],
    ['22.13.0', false],
    ['22.22.1', false],
    ['22.22.2', true],
    ['24.14.0', false],
    ['24.15.0', true],
    ['26.0.0', true],
  ])('Node %s → %s', (version, supported) => {
    expect(crawlerSupportsNode(version)).toBe(supported);
  });

  test('lt tools crawl loads the crawler lazily, so jsdom stays out of every other command', () => {
    // gluegun loads every command module on every `lt` run; a value import at the top of
    // the crawl command would hand jsdom's Node floor to all of them.
    const source = readFileSync(join(__dirname, '..', 'src', 'commands', 'tools', 'crawl.ts'), 'utf-8');
    expect(source).not.toMatch(/^import (?!type\b)[^;]*from '\.\.\/\.\.\/lib\/crawler';/m);
    expect(source).toContain("require('../../lib/crawler')");
  });
});
