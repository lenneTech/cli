import { GluegunCommand } from 'gluegun';
import { resolve } from 'path';

import { ExtendedGluegunToolbox } from '../../interfaces/extended-gluegun-toolbox';
import { crawlSite } from '../../lib/crawler';

/**
 * Crawl a website (optionally following same-origin links up to a
 * configurable depth) and store the content as Markdown files for use
 * as a Claude Code knowledge base. Inspired by ../../../../chrome-md:
 * shares the defuddle + Turndown extraction pipeline but runs headless
 * from Node and follows links / sitemaps automatically.
 */
const NewCommand: GluegunCommand = {
  alias: ['cr'],
  description: 'Crawl site to Markdown',
  hidden: false,
  name: 'crawl',
  run: async (toolbox: ExtendedGluegunToolbox) => {
    const {
      config,
      filesystem,
      helper,
      parameters,
      print: { error, info, spin, success, warning },
      prompt: { confirm },
      tools,
    } = toolbox;

    if (
      tools.helpJson({
        aliases: ['cr'],
        description: 'Crawl a website into Markdown files (for Claude Code knowledge bases)',
        name: 'crawl',
        options: [
          {
            description: 'Start URL (absolute http/https URL)',
            flag: '--url',
            required: true,
            type: 'string',
          },
          {
            default: '.',
            description: 'Output directory (created if missing)',
            flag: '--out',
            type: 'string',
          },
          {
            default: 0,
            description:
              'Link depth. 0 = only start page; 1 = + direct links; N = up to N hops; "all" (or -1) = follow every same-origin link until --max-pages is reached',
            flag: '--depth',
            type: 'number|all',
          },
          {
            default: true,
            description: 'Download images and inline them with local paths',
            flag: '--images',
            type: 'boolean',
          },
          {
            default: true,
            description: 'Also seed queue from <origin>/sitemap.xml',
            flag: '--sitemap',
            type: 'boolean',
          },
          {
            default: 4,
            description: 'Parallel HTTP requests',
            flag: '--concurrency',
            type: 'number',
          },
          {
            default: 200,
            description: 'Maximum number of pages to crawl (safety cap)',
            flag: '--max-pages',
            type: 'number',
          },
          {
            description: 'CSS selector for the main content container',
            flag: '--selector',
            type: 'string',
          },
          {
            default: 20000,
            description: 'HTTP request timeout in ms',
            flag: '--timeout',
            type: 'number',
          },
          {
            default: false,
            description: 'Shortcut for --depth all (follows every same-origin link until --max-pages)',
            flag: '--all',
            type: 'boolean',
          },
          {
            default: true,
            description:
              "Render pages through a headless browser before extracting (for SPAs like Vue/Nuxt/React/Angular). Uses playwright-core with system Chrome / Edge, falling back to Playwright's bundled chromium. Disable with --no-render for plain HTTP fetches.",
            flag: '--render',
            type: 'boolean',
          },
          {
            default: false,
            description:
              'If --render cannot find any browser, auto-install Playwright chromium (one-time ~170 MB download).',
            flag: '--install-browser',
            type: 'boolean',
          },
          {
            default: true,
            description:
              'After a multi-page crawl, remove any .md or image files inside <outDir>/pages and <outDir>/images that were not written by this run. Disable with --no-prune to preserve old files.',
            flag: '--prune',
            type: 'boolean',
          },
          {
            default: false,
            description: 'Skip confirmation prompts',
            flag: '--noConfirm',
            type: 'boolean',
          },
        ],
      })
    ) {
      return 'crawl';
    }

    tools.nonInteractiveHint('lt tools crawl <url> --out <dir> --depth 1 --noConfirm');

    const ltConfig = config.loadConfig();
    const commandConfig = ltConfig?.commands?.tools?.crawl;

    // URL: positional argument > --url > interactive prompt.
    const urlInput =
      parameters.first ||
      (parameters.options.url as string | undefined) ||
      (await helper.getInput(undefined, { name: 'Website URL', showError: false }));

    if (!urlInput) {
      error('No URL provided');
      return;
    }

    const url = normalizeSeedUrl(urlInput);
    try {
      new URL(url);
    } catch {
      error(`Invalid URL: ${urlInput}`);
      return;
    }

    const depthRaw = config.getValue<'all' | number | string>({
      // `--all` is a convenience shortcut for `--depth all`. It wins
      // over a numeric `--depth` so users can combine both.
      cliValue: parameters.options.all === true ? 'all' : parameters.options.depth,
      configValue: commandConfig?.depth,
      defaultValue: 0,
    });
    const depth: 'all' | number = parseDepth(depthRaw);

    const includeImages = config.getValue<boolean>({
      cliValue: parameters.options.images === false ? false : undefined,
      configValue: commandConfig?.includeImages,
      defaultValue: true,
    });

    const includeSitemap = config.getValue<boolean>({
      cliValue: parameters.options.sitemap === false ? false : undefined,
      configValue: commandConfig?.includeSitemap,
      defaultValue: true,
    });

    const concurrency = Number(
      config.getValue({
        cliValue: parameters.options.concurrency,
        configValue: commandConfig?.concurrency,
        defaultValue: 4,
      }),
    );

    const maxPages = Number(
      config.getValue({
        cliValue: parameters.options.maxPages ?? parameters.options['max-pages'],
        configValue: commandConfig?.maxPages,
        defaultValue: 200,
      }),
    );

    const timeout = Number(
      config.getValue({
        cliValue: parameters.options.timeout,
        configValue: commandConfig?.timeout,
        defaultValue: 20000,
      }),
    );

    const selector = config.getValue<string>({
      cliValue: parameters.options.selector as string | undefined,
      configValue: commandConfig?.selector,
    });

    // `--render` and `--prune` default ON — the common case is a
    // full SPA-aware knowledge-base crawl that stays in sync on
    // updates. `--no-render` / `--no-prune` opt out explicitly.
    const renderJs = config.getValue<boolean>({
      cliValue: parameters.options.render === false ? false : undefined,
      configValue: commandConfig?.renderJs,
      defaultValue: true,
    });

    const installBrowser = parameters.options['install-browser'] === true || parameters.options.installBrowser === true;

    const pruneOrphans = config.getValue<boolean>({
      cliValue: parameters.options.prune === false ? false : undefined,
      configValue: commandConfig?.prune,
      defaultValue: true,
    });

    const outDir = resolve(
      config.getValue<string>({
        cliValue: (parameters.options.out as string | undefined) ?? (parameters.options.output as string | undefined),
        configValue: commandConfig?.out,
        defaultValue: filesystem.cwd(),
      }) || filesystem.cwd(),
    );

    const noConfirm = config.getNoConfirm({
      cliValue: parameters.options.noConfirm,
      commandConfig,
      config: ltConfig,
      parentConfig: ltConfig?.commands?.tools,
    });

    info('');
    info(`Crawling: ${url}`);
    info(`Output:   ${outDir}`);
    info(`Depth:    ${depth === 'all' ? 'all (bounded by --max-pages)' : depth}`);
    info(`Sitemap:  ${includeSitemap ? 'yes' : 'no'}`);
    info(`Images:   ${includeImages ? 'yes' : 'no'}`);
    info(`Parallel: ${concurrency}`);
    info(`Max:      ${maxPages} pages`);
    info(`Render:   ${renderJs ? 'yes (headless browser)' : 'no (raw HTTP)'}`);
    info(`Prune:    ${pruneOrphans ? 'yes (remove orphaned pages/images)' : 'no'}`);
    if (selector) info(`Selector: ${selector}`);
    info('');

    if (!noConfirm && !(await confirm('Start crawl?'))) {
      return 'crawl cancelled';
    }

    const spinner = spin('Crawling...');
    const result = await crawlSite({
      autoInstallBrowser: installBrowser,
      concurrency,
      depth,
      includeImages,
      includeSitemap,
      maxPages,
      onLog: (msg) => {
        spinner.text = msg;
      },
      outDir,
      prune: pruneOrphans,
      renderJs,
      selector,
      timeout,
      url,
    }).catch((err: Error) => {
      spinner.fail('Crawl failed');
      error(err.message);
      return null;
    });

    if (!result) {
      return;
    }

    spinner.succeed(`Crawl complete: ${result.pages.length} page(s)`);
    info('');
    if (result.indexFile) {
      success(`Overview: ${result.indexFile}`);
    }
    for (const page of result.pages.slice(0, 10)) {
      info(`  - ${page.relativePath}  (${page.url})`);
    }
    if (result.pages.length > 10) {
      info(`  ... and ${result.pages.length - 10} more`);
    }
    if (result.pruned.length > 0) {
      info(`Pruned ${result.pruned.length} orphaned file(s)`);
      for (const path of result.pruned.slice(0, 5)) {
        info(`  - ${path}`);
      }
      if (result.pruned.length > 5) info(`  ... and ${result.pruned.length - 5} more`);
    }
    if (result.skipped.length > 0) {
      warning(`Skipped ${result.skipped.length} URL(s) (non-HTML or foreign origin)`);
    }
    if (result.errors.length > 0) {
      warning(`${result.errors.length} error(s):`);
      for (const err of result.errors.slice(0, 5)) {
        warning(`  - ${err.url}: ${err.reason}`);
      }
    }

    if (!toolbox.parameters.options.fromGluegunMenu) {
      process.exit();
    }

    return `crawled ${result.pages.length} pages`;
  },
};

function normalizeSeedUrl(raw: string): string {
  const trimmed = raw.trim();
  if (/^https?:\/\//i.test(trimmed)) return trimmed;
  return `https://${trimmed}`;
}

/**
 * Parse the --depth parameter. Accepts positive integers, the string
 * "all", and negative values (treated as "all"). Invalid values fall
 * back to `0` so the crawl still runs against the seed URL.
 */
function parseDepth(raw: unknown): 'all' | number {
  if (raw === undefined || raw === null) return 0;
  if (typeof raw === 'string') {
    const normalized = raw.trim().toLowerCase();
    if (normalized === 'all' || normalized === '-1') return 'all';
    const n = Number(normalized);
    if (!Number.isFinite(n)) return 0;
    return n < 0 ? 'all' : Math.floor(n);
  }
  if (typeof raw === 'number') {
    if (!Number.isFinite(raw)) return 'all';
    return raw < 0 ? 'all' : Math.floor(raw);
  }
  return 0;
}

export default NewCommand;
