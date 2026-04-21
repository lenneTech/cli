/**
 * Website crawler utilities.
 *
 * Fetches web pages (optionally guided by sitemap.xml), extracts the
 * main content using the same defuddle + Turndown pipeline as the
 * chrome-md browser extension (see ../../../chrome-md/content/content.js),
 * converts it to Markdown, and writes one .md file per page plus an
 * overview README when multiple pages are discovered. Designed for
 * building Claude Code knowledge bases.
 */
import axios, { AxiosInstance } from 'axios';
import { createHash } from 'crypto';
import Defuddle from 'defuddle';
import { existsSync, mkdirSync, readdirSync, readFileSync, rmdirSync, unlinkSync, writeFileSync } from 'fs';
import { JSDOM } from 'jsdom';
import { dirname, extname, join, relative } from 'path';
import TurndownService from 'turndown';
import { gfm as gfmPlugin } from 'turndown-plugin-gfm';

import { BrowserFetcher, createBrowserFetcher } from './browser-fetcher';

export interface CrawlOptions {
  /**
   * When `renderJs` is true and no browser is found on the system,
   * automatically run `npx playwright install chromium` once and
   * retry. Default `false`.
   */
  autoInstallBrowser?: boolean;
  /**
   * Max parallel HTTP requests.
   * @default 4
   */
  concurrency?: number;
  /**
   * Link depth relative to each seed URL.
   *
   * - `0` = only the seed page.
   * - `1` = seed plus all same-origin links on the seed.
   * - `2` = plus all links on those pages; and so on.
   * - `'all'` = follow every same-origin link transitively (bounded by
   *   `maxPages`).
   * @default 0
   */
  depth: 'all' | number;
  /**
   * Whether to download and inline images.
   * @default true
   */
  includeImages?: boolean;
  /**
   * Whether to also seed the queue with URLs found in `<origin>/sitemap.xml`.
   * @default true
   */
  includeSitemap?: boolean;
  /**
   * Hard cap on the number of pages to download (safety net).
   * @default 200
   */
  maxPages?: number;
  /**
   * Progress callback. Called with human readable status messages.
   */
  onLog?: (message: string) => void;
  /**
   * Output directory. Single-page crawls write directly here;
   * multi-page crawls use `./pages/`, `./images/` and `./README.md`.
   */
  outDir: string;
  /**
   * Remove any `.md` pages and image files inside `outDir/pages/`
   * and `outDir/images/` that were NOT written by the current
   * crawl. Keeps the knowledge base in sync with the live site on
   * update runs. Only takes effect in multi-page mode. Default `false`.
   */
  prune?: boolean;
  /**
   * When true, fetch pages through a headless browser so
   * single-page applications (React/Vue/Nuxt/Angular) can fully
   * hydrate before their HTML is captured. Mirrors the chrome-md
   * approach of reading the live DOM instead of raw server HTML.
   * @default false
   */
  renderJs?: boolean;
  /**
   * Optional CSS selector to scope the content extraction. When
   * provided, it is handed to defuddle as `contentSelector`.
   */
  selector?: string;
  /**
   * HTTP request timeout in ms.
   * @default 20000
   */
  timeout?: number;
  /**
   * Seed URL. Must be absolute (http/https).
   */
  url: string;
  /**
   * Custom user agent header.
   */
  userAgent?: string;
}

export interface CrawlPage {
  author?: string;
  depth: number;
  description: string;
  downloadDate: string;
  firstDownloaded: string;
  imageCount: number;
  language?: string;
  ogImage?: string;
  outputPath: string;
  relativePath: string;
  title: string;
  url: string;
  wordCount: number;
}

export interface CrawlResult {
  errors: { reason: string; url: string }[];
  indexFile?: string;
  outDir: string;
  pages: CrawlPage[];
  /** Absolute paths of files removed by `--prune`. */
  pruned: string[];
  skipped: string[];
}

const DEFAULT_USER_AGENT = 'Mozilla/5.0 (compatible; lenneTech-CLI-Crawler/1.0; +https://lenne.tech)';

interface ExtractedContent {
  contentHtml: string;
  contentText: string;
  imageMap: Map<string, string>;
  images: string[];
  links: string[];
  meta: {
    author?: string;
    description: string;
    language?: string;
    ogImage?: string;
    title: string;
    wordCount?: number;
  };
}

/**
 * Crawl a website starting at `options.url` and write the collected
 * pages as Markdown files beneath `options.outDir`.
 */
export async function crawlSite(options: CrawlOptions): Promise<CrawlResult> {
  const {
    autoInstallBrowser = false,
    concurrency = 4,
    depth: rawDepth,
    includeImages = true,
    includeSitemap = true,
    maxPages = 200,
    onLog = () => undefined,
    outDir,
    prune = false,
    renderJs = false,
    selector,
    timeout = 20000,
    url: seedUrl,
    userAgent = DEFAULT_USER_AGENT,
  } = options;

  // Normalize depth. `'all'` and negative numbers mean "follow every
  // same-origin link we find" — bounded by `maxPages`.
  const depth: number =
    rawDepth === 'all' || (typeof rawDepth === 'number' && rawDepth < 0) ? Number.POSITIVE_INFINITY : Number(rawDepth);

  const http = axios.create({
    headers: { 'User-Agent': userAgent },
    maxRedirects: 5,
    responseType: 'text',
    timeout,
    validateStatus: (status) => status >= 200 && status < 400,
  });

  // Headless browser only spun up when needed (SPA-mode).
  let browserFetcher: BrowserFetcher | null = null;
  if (renderJs) {
    browserFetcher = await createBrowserFetcher({
      autoInstall: autoInstallBrowser,
      extraWaitMs: 500,
      maxWaitMs: timeout,
      onLog,
      userAgent,
    });
  }

  try {
    const seed = new URL(seedUrl);
    const origin = seed.origin;

    if (!existsSync(outDir)) {
      mkdirSync(outDir, { recursive: true });
    }

    // Queue preserves the depth at which a URL was discovered so children
    // are only followed when `discovered.depth < options.depth`.
    const queue: { depth: number; url: string }[] = [{ depth: 0, url: normalizeUrl(seedUrl) }];
    const seen = new Set<string>([normalizeUrl(seedUrl)]);

    if (includeSitemap) {
      onLog(`Checking sitemap at ${origin}/sitemap.xml`);
      const sitemapUrls = await fetchSitemapUrls(http, origin, onLog);
      for (const sitemapUrl of sitemapUrls) {
        const normalized = normalizeUrl(sitemapUrl);
        if (!seen.has(normalized) && sameOrigin(normalized, origin)) {
          seen.add(normalized);
          queue.push({ depth: 0, url: normalized });
        }
      }
      if (sitemapUrls.length > 0) {
        onLog(`Sitemap discovered ${sitemapUrls.length} URLs`);
      }
    }

    const pages: CrawlPage[] = [];
    const errors: { reason: string; url: string }[] = [];
    const skipped: string[] = [];

    // Shared deduplicated image map (content hash -> relative path under outDir).
    const imageHashToPath = new Map<string, string>();

    // We can't know upfront whether the crawl is single- or multi-page,
    // so we render pages into a buffer first and only materialize files
    // once the queue drains.
    const rendered: {
      filename: string;
      images: { data: Buffer; filename: string }[];
      info: Omit<CrawlPage, 'outputPath' | 'relativePath'>;
      markdown: string;
    }[] = [];

    const processPage = async (item: { depth: number; url: string }) => {
      if (pages.length + errors.length >= maxPages) {
        skipped.push(item.url);
        return;
      }
      onLog(`Fetching (depth ${item.depth}): ${item.url}`);
      try {
        let html: string;
        let finalUrl = normalizeUrl(item.url);
        if (browserFetcher) {
          // In render mode we trust the URL we navigated to. We can't
          // cheaply detect redirects here, so assume same origin (the
          // crawler already filtered non-HTML URLs out of the queue).
          html = await browserFetcher.fetch(item.url);
        } else {
          const response = await http.get(item.url);
          finalUrl = normalizeUrl(response.request?.res?.responseUrl || item.url);
          if (!sameOrigin(finalUrl, origin)) {
            skipped.push(item.url);
            return;
          }
          const contentType = String(response.headers['content-type'] || '');
          if (!contentType.includes('text/html') && !contentType.includes('application/xhtml')) {
            skipped.push(item.url);
            return;
          }
          html = String(response.data || '');
        }
        const extracted = await extractContent(html, finalUrl, { selector });

        // Follow links when depth budget is left.
        if (item.depth < depth) {
          for (const link of extracted.links) {
            if (!sameOrigin(link, origin)) continue;
            const normalized = normalizeUrl(link);
            if (seen.has(normalized)) continue;
            seen.add(normalized);
            queue.push({ depth: item.depth + 1, url: normalized });
          }
        }

        // Download images and build a URL -> local path map for Turndown.
        const imageEntries: { data: Buffer; filename: string }[] = [];
        if (includeImages && extracted.images.length > 0) {
          for (const imgUrl of extracted.images) {
            try {
              const absolute = new URL(imgUrl, finalUrl).href;
              const result = await fetchImage(http, absolute);
              if (!result) continue;
              const hash = createHash('sha1').update(result.buffer).digest('hex');
              let relativeImagePath = imageHashToPath.get(hash);
              if (!relativeImagePath) {
                // Filename uses a content-hash suffix so re-runs with
                // identical bytes overwrite the same file instead of
                // leaving orphans with rotating counter suffixes.
                const filename = buildImageFilename(absolute, hash, result.contentType);
                relativeImagePath = `images/${filename}`;
                imageHashToPath.set(hash, relativeImagePath);
                imageEntries.push({ data: result.buffer, filename });
              }
              extracted.imageMap.set(imgUrl, relativeImagePath);
              extracted.imageMap.set(absolute, relativeImagePath);
            } catch {
              // Skip image on error; continue with others.
            }
          }
        }

        const markdown = convertToMarkdown(extracted.contentHtml, finalUrl, extracted.imageMap);
        const filename = buildPageFilename(finalUrl, rendered.length === 0);

        rendered.push({
          filename,
          images: imageEntries,
          info: {
            author: extracted.meta.author,
            depth: item.depth,
            description: extracted.meta.description,
            downloadDate: new Date().toISOString(),
            firstDownloaded: new Date().toISOString(),
            imageCount: imageEntries.length,
            language: extracted.meta.language,
            ogImage: extracted.meta.ogImage,
            title: extracted.meta.title,
            url: finalUrl,
            wordCount: extracted.meta.wordCount || countWords(extracted.contentText),
          },
          markdown,
        });
      } catch (error) {
        errors.push({
          reason: error instanceof Error ? error.message : String(error),
          url: item.url,
        });
      }
    };

    // Simple parallel worker pool. `queue` grows as pages are discovered,
    // so workers pick new items until nothing is left.
    let cursor = 0;
    const worker = async (): Promise<void> => {
      while (cursor < queue.length && pages.length + errors.length < maxPages) {
        const item = queue[cursor++];
        await processPage(item);
      }
    };
    const workers = Array.from({ length: Math.max(1, concurrency) }, () => worker());
    await Promise.all(workers);
    // Drain any late discoveries added after all initial workers exited.
    while (cursor < queue.length) {
      await Promise.all(Array.from({ length: Math.max(1, concurrency) }, () => worker()));
    }

    const multiPage = rendered.length > 1;
    const pagesDir = multiPage ? join(outDir, 'pages') : outDir;
    const imagesDir = join(outDir, 'images');

    if (rendered.length === 0) {
      onLog('No pages rendered');
      return { errors, outDir, pages, pruned: [], skipped };
    }

    mkdirSync(pagesDir, { recursive: true });
    if (includeImages && imageHashToPath.size > 0) {
      mkdirSync(imagesDir, { recursive: true });
    }

    // Write deduplicated images.
    const writtenImageFilenames = new Set<string>();
    for (const entry of rendered.flatMap((r) => r.images)) {
      if (writtenImageFilenames.has(entry.filename)) continue;
      writtenImageFilenames.add(entry.filename);
      writeFileSync(join(imagesDir, entry.filename), entry.data);
    }

    // Persist pages. When updating, preserve the original
    // `first_downloaded` timestamp so history stays intact.
    for (const entry of rendered) {
      const outputPath = join(pagesDir, entry.filename);
      const relativePath = relative(outDir, outputPath);

      // Images live under `<outDir>/images/`. Each page rewrites the
      // Turndown-emitted `images/<file>` placeholder to the correct
      // relative path so nested URL slugs (`pages/ueber-uns/…`, or a
      // single-page crawl that lands in `<outDir>/ueber-uns/…`) still
      // render in Markdown previews.
      const imagePrefix = `${relative(dirname(outputPath), imagesDir).split(/[\\/]/).join('/')}/`;
      const fixedMarkdown = entry.markdown.replace(/\]\(images\//g, `](${imagePrefix}`);

      if (existsSync(outputPath)) {
        const existing = readFileSync(outputPath, 'utf8');
        const existingMeta = parseFrontmatter(existing);
        if (existingMeta?.first_downloaded) {
          entry.info.firstDownloaded = String(existingMeta.first_downloaded);
        }
      }

      const frontmatter = renderFrontmatter(entry.info);
      mkdirSync(dirname(outputPath), { recursive: true });
      writeFileSync(outputPath, `${frontmatter}\n${fixedMarkdown.trim()}\n`);

      pages.push({ ...entry.info, outputPath, relativePath });
    }

    let indexFile: string | undefined;
    if (multiPage) {
      indexFile = join(outDir, 'README.md');
      writeFileSync(indexFile, renderOverview(seed.href, pages));
    }

    // Prune orphans (files left over from previous crawls). Scoped to
    // `pages/` and `images/` so stray user files in outDir root never
    // get touched. Only active in multi-page mode — a single-page
    // crawl writes into `outDir` itself and has no page subfolder to
    // sweep.
    const pruned: string[] = [];
    if (prune && multiPage) {
      const keep = new Set<string>(pages.map((p) => p.outputPath));
      for (const entry of rendered.flatMap((r) => r.images)) {
        keep.add(join(imagesDir, entry.filename));
      }
      pruned.push(...pruneOrphans(pagesDir, keep));
      if (existsSync(imagesDir)) {
        pruned.push(...pruneOrphans(imagesDir, keep));
      }
      if (pruned.length > 0) {
        onLog(`Pruned ${pruned.length} orphaned file(s)`);
      }
    }

    return { errors, indexFile, outDir, pages, pruned, skipped };
  } finally {
    // Guarantee the headless browser is shut down on every exit path,
    // including thrown errors, so no orphan chromium processes linger.
    if (browserFetcher) {
      await browserFetcher.close().catch(() => undefined);
    }
  }
}

function buildImageFilename(url: string, contentHash: string, contentType: string): string {
  let basename = 'image';
  let extension = '';
  try {
    const u = new URL(url);
    const last = u.pathname.split('/').filter(Boolean).pop() || '';
    const parsedExt = extname(last).replace('.', '').toLowerCase();
    if (parsedExt && /^(jpg|jpeg|png|gif|webp|svg|avif)$/.test(parsedExt)) {
      extension = parsedExt;
    }
    basename =
      last
        .replace(extname(last), '')
        .replace(/[^a-zA-Z0-9-_]/g, '_')
        .substring(0, 40) || 'image';
  } catch {
    // fall through
  }
  if (!extension) {
    const fromType = contentType.split(';')[0].split('/')[1];
    if (fromType && /^(jpeg|jpg|png|gif|webp|svg\+xml|avif)$/.test(fromType)) {
      extension = fromType === 'svg+xml' ? 'svg' : fromType;
    } else {
      extension = 'png';
    }
  }
  return `${basename}-${contentHash.slice(0, 8)}.${extension}`;
}

function buildPageFilename(url: string, isFirst: boolean): string {
  const u = new URL(url);
  const segments = u.pathname.split('/').filter(Boolean);
  if (segments.length === 0) {
    return isFirst ? 'index.md' : 'home.md';
  }
  const slugged = segments
    .map(
      (s) =>
        s
          .toLowerCase()
          .replace(/\.(html?|php|aspx?)$/, '')
          .replace(/[^a-z0-9-_]/g, '-')
          .replace(/-+/g, '-')
          .replace(/^-|-$/g, '') || 'page',
    )
    .join('/');
  return `${slugged}.md`;
}

function convertToMarkdown(html: string, baseUrl: string, imageMap: Map<string, string>): string {
  const turndown = new TurndownService({
    bulletListMarker: '-',
    codeBlockStyle: 'fenced',
    emDelimiter: '*',
    headingStyle: 'atx',
    linkStyle: 'inlined',
    strongDelimiter: '**',
  });

  // Enable GFM so tables, strikethrough and task lists convert cleanly.
  if (gfmPlugin) {
    turndown.use(gfmPlugin);
  }

  turndown.addRule('absoluteLinks', {
    filter: 'a',
    replacement: (content, node) => {
      const href = (node as unknown as Element).getAttribute?.('href') || '';
      if (!href || href === '#' || href.startsWith('javascript:')) {
        return content;
      }
      let absolute = href;
      try {
        absolute = new URL(href, baseUrl).href;
      } catch {
        // keep original
      }
      const title = (node as unknown as Element).getAttribute?.('title');
      return title ? `[${content}](${absolute} "${title}")` : `[${content}](${absolute})`;
    },
  });

  turndown.addRule('localImages', {
    filter: 'img',
    replacement: (_content, node) => {
      const src = (node as unknown as Element).getAttribute?.('src') || '';
      if (!src) return '';
      let absolute = src;
      try {
        absolute = new URL(src, baseUrl).href;
      } catch {
        // keep original
      }
      const local = imageMap.get(src) || imageMap.get(absolute);
      const alt = (node as unknown as Element).getAttribute?.('alt') || '';
      const target = local || absolute;
      return `![${alt}](${target})`;
    },
  });

  turndown.remove(['script', 'style', 'noscript', 'iframe']);

  const markdown = turndown.turndown(html);
  return markdown.replace(/\n{3,}/g, '\n\n').trim();
}

function countWords(text: string): number {
  return text.replace(/\s+/g, ' ').trim().split(' ').filter(Boolean).length;
}

function escapeYaml(value: string): string {
  return value.replace(/\\/g, '\\\\').replace(/"/g, '\\"').replace(/\n/g, ' ');
}

/**
 * Extract main content + metadata using defuddle (the same engine as
 * chrome-md). Falls back to a raw body dump if defuddle fails.
 */
async function extractContent(
  html: string,
  pageUrl: string,
  options: { selector?: string },
): Promise<ExtractedContent> {
  const dom = new JSDOM(html, { url: pageUrl });
  const doc = dom.window.document;

  const defuddleOptions: Record<string, unknown> = {
    markdown: false,
    removeHiddenElements: true,
    removeLowScoring: true,
    removeSmallImages: false,
  };
  if (options.selector) {
    defuddleOptions.contentSelector = options.selector;
  }

  let parsed: {
    author?: string;
    content: string;
    description?: string;
    image?: string;
    language?: string;
    title?: string;
    wordCount?: number;
  };
  try {
    // Same class-based API as chrome-md's content script.
    const instance = new Defuddle(doc as unknown as Document, defuddleOptions);
    parsed = instance.parse();
  } catch {
    parsed = {
      content: doc.body?.innerHTML || html,
      title: doc.title,
    };
  }

  const contentHtml = parsed.content || doc.body?.innerHTML || '';

  // Collect images and links from the cleaned content.
  const helperDom = new JSDOM(`<!DOCTYPE html><html><body>${contentHtml}</body></html>`, {
    url: pageUrl,
  });
  const contentDoc = helperDom.window.document;

  const links = new Set<string>();
  contentDoc.querySelectorAll('a[href]').forEach((el) => {
    const href = (el.getAttribute('href') || '').trim();
    if (!href || href.startsWith('#') || href.startsWith('mailto:') || href.startsWith('javascript:')) {
      return;
    }
    try {
      links.add(new URL(href, pageUrl).href);
    } catch {
      // ignore malformed URLs
    }
  });

  const images = new Set<string>();
  contentDoc.querySelectorAll('img').forEach((el) => {
    const src = (el.getAttribute('src') || el.getAttribute('data-src') || '').trim();
    if (!src || src.startsWith('data:')) return;
    try {
      images.add(new URL(src, pageUrl).href);
    } catch {
      // ignore malformed URLs
    }
  });

  // Some lazy-loading frameworks keep the real URL only in the source
  // document (stripped out by defuddle), so also consult the original DOM.
  doc.querySelectorAll('img[data-src], img[data-lazy-src]').forEach((el) => {
    const src = (el.getAttribute('data-src') || el.getAttribute('data-lazy-src') || '').trim();
    if (!src || src.startsWith('data:')) return;
    try {
      images.add(new URL(src, pageUrl).href);
    } catch {
      // ignore
    }
  });

  const meta = {
    author: parsed.author || doc.querySelector('meta[name="author"]')?.getAttribute('content') || undefined,
    description:
      parsed.description ||
      doc.querySelector('meta[name="description"]')?.getAttribute('content') ||
      doc.querySelector('meta[property="og:description"]')?.getAttribute('content') ||
      '',
    language: parsed.language || doc.documentElement.getAttribute('lang') || undefined,
    ogImage: parsed.image || doc.querySelector('meta[property="og:image"]')?.getAttribute('content') || undefined,
    title: parsed.title || doc.title || pageUrl,
    wordCount: parsed.wordCount,
  };

  return {
    contentHtml,
    contentText: contentDoc.body?.textContent || '',
    imageMap: new Map<string, string>(),
    images: [...images],
    links: [...links],
    meta,
  };
}

async function fetchImage(http: AxiosInstance, url: string): Promise<null | { buffer: Buffer; contentType: string }> {
  try {
    const response = await http.get(url, { responseType: 'arraybuffer' });
    const buffer = Buffer.from(response.data);
    if (buffer.byteLength === 0) return null;
    return { buffer, contentType: String(response.headers['content-type'] || '') };
  } catch {
    return null;
  }
}

async function fetchSitemapUrls(http: AxiosInstance, origin: string, onLog: (m: string) => void): Promise<string[]> {
  const urls: string[] = [];
  const visited = new Set<string>();

  async function walk(sitemapUrl: string): Promise<void> {
    if (visited.has(sitemapUrl)) return;
    visited.add(sitemapUrl);
    try {
      const response = await http.get(sitemapUrl);
      const xml = String(response.data || '');
      // Nested sitemap index: follow each <sitemap><loc>...</loc></sitemap>.
      const nested = [...xml.matchAll(/<sitemap>[\s\S]*?<loc>\s*([^<\s]+)\s*<\/loc>[\s\S]*?<\/sitemap>/gi)].map(
        (m) => m[1],
      );
      for (const child of nested) {
        await walk(child);
      }
      const pageMatches = [...xml.matchAll(/<url>[\s\S]*?<loc>\s*([^<\s]+)\s*<\/loc>[\s\S]*?<\/url>/gi)].map(
        (m) => m[1],
      );
      urls.push(...pageMatches);
    } catch (error) {
      onLog(`Sitemap fetch failed for ${sitemapUrl}: ${error instanceof Error ? error.message : String(error)}`);
    }
  }

  await walk(`${origin}/sitemap.xml`);
  return urls;
}

/**
 * Normalize a URL for dedup: strip hash, drop default `index.html`,
 * and remove trailing slashes (except root).
 */
function normalizeUrl(raw: string): string {
  try {
    const u = new URL(raw);
    u.hash = '';
    u.pathname = u.pathname.replace(/\/index\.html?$/i, '/');
    if (u.pathname.length > 1 && u.pathname.endsWith('/')) {
      u.pathname = u.pathname.replace(/\/+$/, '');
    }
    return u.href;
  } catch {
    return raw;
  }
}

function parseFrontmatter(markdown: string): null | Record<string, string> {
  if (!markdown.startsWith('---')) return null;
  const end = markdown.indexOf('\n---', 3);
  if (end === -1) return null;
  const block = markdown.slice(3, end);
  const result: Record<string, string> = {};
  for (const line of block.split('\n')) {
    const match = line.match(/^([a-zA-Z0-9_]+):\s*(.*)$/);
    if (!match) continue;
    result[match[1]] = match[2].replace(/^"(.*)"$/, '$1');
  }
  return result;
}

/**
 * Walk `rootDir` recursively and delete every file whose absolute
 * path is not in `keepPaths`. Empty directories left behind after
 * the sweep are removed, too. Returns the absolute paths that were
 * actually deleted.
 */
function pruneOrphans(rootDir: string, keepPaths: Set<string>): string[] {
  const removed: string[] = [];
  if (!existsSync(rootDir)) return removed;

  const entries = readdirSync(rootDir, { withFileTypes: true });
  for (const entry of entries) {
    const full = join(rootDir, entry.name);
    if (entry.isDirectory()) {
      removed.push(...pruneOrphans(full, keepPaths));
      // Remove directory if now empty.
      try {
        if (readdirSync(full).length === 0) rmdirSync(full);
      } catch {
        // Directory not empty or already gone — ignore.
      }
    } else if (entry.isFile() && !keepPaths.has(full)) {
      try {
        unlinkSync(full);
        removed.push(full);
      } catch {
        // File already removed or permission denied — skip.
      }
    }
  }
  return removed;
}

function renderFrontmatter(info: Omit<CrawlPage, 'outputPath' | 'relativePath'>): string {
  const lines = [
    '---',
    `title: "${escapeYaml(info.title)}"`,
    `source_url: "${info.url}"`,
    `source_domain: "${new URL(info.url).hostname}"`,
    `crawl_depth: ${info.depth}`,
    `download_date: "${info.downloadDate}"`,
    `first_downloaded: "${info.firstDownloaded}"`,
    info.description ? `description: "${escapeYaml(truncate(info.description, 500))}"` : null,
    info.author ? `author: "${escapeYaml(info.author)}"` : null,
    info.language ? `language: "${escapeYaml(info.language)}"` : null,
    info.ogImage ? `og_image: "${escapeYaml(info.ogImage)}"` : null,
    info.imageCount ? `image_count: ${info.imageCount}` : null,
    `word_count: ${info.wordCount}`,
    'content_type: "webpage"',
    '---',
  ].filter((l): l is string => l !== null);
  return lines.join('\n');
}

function renderOverview(startUrl: string, pages: CrawlPage[]): string {
  const ordered = [...pages].sort((a, b) => a.url.localeCompare(b.url));
  const host = new URL(startUrl).host;
  const lines: string[] = [];
  lines.push(`# ${host} — Knowledge Base`);
  lines.push('');
  lines.push(`Source: ${startUrl}`);
  lines.push('');
  lines.push(`Generated: ${new Date().toISOString()}`);
  lines.push('');
  lines.push(`Pages: ${ordered.length}`);
  lines.push('');
  lines.push('## Pages');
  lines.push('');
  for (const page of ordered) {
    lines.push(`### [${page.title}](${page.relativePath.split(/[\\/]/).join('/')})`);
    lines.push('');
    lines.push(`- URL: ${page.url}`);
    if (page.description) {
      lines.push(`- ${truncate(page.description, 240)}`);
    }
    lines.push(`- Updated: ${page.downloadDate}`);
    lines.push('');
  }
  return lines.join('\n');
}

function sameOrigin(url: string, origin: string): boolean {
  try {
    return new URL(url).origin === origin;
  } catch {
    return false;
  }
}

function truncate(value: string, max: number): string {
  return value.length <= max ? value : `${value.slice(0, max - 1)}…`;
}
