import type { GluegunFilesystem } from 'gluegun';

import { dump } from 'js-yaml';

import { parseYamlObject } from './adopt-upstream-build-allowlist';
import { isSymlink } from './fs-utils';
import { extractKeyComments, reattachKeyComments } from './hoist-workspace-pnpm-config';

/**
 * Same set as `CONTROL_CHARS` in hoist-workspace-pnpm-config.ts: a bare CR in a
 * comment reads as whitespace and parses as a line break, so a carried comment
 * could smuggle a YAML entry into the project file. Such a comment is dropped.
 */
const CONTROL_CHARS = /[\u0000-\u0008\u000B-\u001F\u007F]/;

/**
 * Carry the framework's `peerDependencyRules.allowedVersions` into a project that
 * has just vendored it, for the packages that project now depends on.
 *
 * Same gap as `adoptUpstreamBuildAllowlist`, one setting further: the conversion
 * resolves the core's import closure into DIRECT dependencies, so `typeorm` and
 * `ioredis` become the project's own. typeorm 1.1.2 declares the optional peer
 * `ioredis: ^5.0.4`, the framework is on ioredis 6, and nest-server scope-allows
 * that with `'typeorm>ioredis': '6'`. That rule lives in nest-server's
 * `pnpm-workspace.yaml`, which is not in its npm tarball, so the vendored project
 * never saw it, and `pnpm peers check` (the `check:peers` step of every generated
 * workspace) failed the first `pnpm run check` with "unmet peer ioredis".
 *
 * A rule is adopted when the package it is about is a dependency of the project:
 * the parent of `parent>peer`, or the peer itself for an unscoped key. A rule for
 * a package the project does not have (a framework devDependency such as
 * compodoc) would only widen what the project tolerates, so it stays behind.
 * `ignoreMissing` and `allowAny` name peers without a parent, so nothing tells
 * which project package they belong to; they are not adopted.
 *
 * Additive, like the build allowlist: a selector the project already lists keeps
 * its value.
 *
 * The new entries are inserted as TEXT, together with the comment that explains
 * them upstream, and every other byte of the file stays as it was. Re-dumping the
 * file instead dropped every comment that is not directly above a first-level
 * entry: in a standalone vendor project that was about 240 lines of the starter's
 * policy text, and after `lt server convert-mode` the user's own. The inserted
 * text is parsed back and compared with the intended result; only a shape the
 * insertion cannot place (flow style, an unexpected parse) falls back to the dump.
 *
 * @returns the selectors actually adopted, for the caller to report.
 */
export function adoptUpstreamPeerRules(options: {
  /** Directory holding the `pnpm-workspace.yaml` to extend (see `pnpmSettingsDir`). */
  dest: string;
  filesystem: GluegunFilesystem;
  /** Every package the project declares after the vendor merge (dependencies and devDependencies). */
  projectPackages: Iterable<string>;
  /** Raw text of the framework's own `pnpm-workspace.yaml`, snapshotted before the clone is removed. */
  upstreamWorkspaceYaml: string;
}): string[] {
  const { dest, filesystem, upstreamWorkspaceYaml } = options;
  if (!upstreamWorkspaceYaml) return [];

  const upstreamAllowed = asObject(
    asObject(parseYamlObject(upstreamWorkspaceYaml)?.peerDependencyRules)?.allowedVersions,
  );
  if (!upstreamAllowed) return [];

  const projectPackages = new Set(options.projectPackages);
  const relevant = Object.entries(upstreamAllowed).filter(
    ([selector, range]) => typeof range === 'string' && projectPackages.has(selectorSubject(selector)),
  ) as [string, string][];
  if (relevant.length === 0) return [];

  // Same guards as the build allowlist: never write through a linked project
  // (`--api-link` points at the user's own checkout), never invent a workspace
  // file, never rewrite one that does not parse.
  if (isSymlink(dest)) return [];
  const destPath = `${dest}/pnpm-workspace.yaml`;
  if (!filesystem.exists(destPath)) return [];
  const destRaw = filesystem.read(destPath) ?? '';
  const destWs = parseYamlObject(destRaw);
  if (!destWs) return [];

  // A `peerDependencyRules` or `allowedVersions` of another shape is the
  // project's own business. Replacing it with a map would delete it.
  const rules = destWs.peerDependencyRules === undefined ? {} : asObject(destWs.peerDependencyRules);
  if (!rules) return [];
  const allowed = rules.allowedVersions === undefined ? {} : asObject(rules.allowedVersions);
  if (!allowed) return [];

  // `hasOwnProperty.call`, for the reason given in `adoptUpstreamBuildAllowlist`:
  // `'constructor' in {}` is true.
  const toAdopt = relevant.filter(([selector]) => !Object.prototype.hasOwnProperty.call(allowed, selector));
  if (toAdopt.length === 0) return [];

  // What the file must parse to afterwards. `Object.create(null)`: a selector
  // named `__proto__` must stay an ordinary key.
  const merged: Record<string, unknown> = Object.assign(Object.create(null), allowed);
  for (const [selector, range] of toAdopt) merged[selector] = range;
  const expected = { ...destWs, peerDependencyRules: { ...rules, allowedVersions: merged } };

  const inserted = insertAllowedVersions(destRaw, toAdopt, upstreamSelectorComments(upstreamWorkspaceYaml));
  if (inserted !== null && sameValue(parseYamlObject(inserted), expected)) {
    filesystem.write(destPath, inserted);
  } else {
    rules.allowedVersions = Object.fromEntries(Object.entries(merged).sort(([a], [b]) => a.localeCompare(b)));
    destWs.peerDependencyRules = rules;
    filesystem.write(
      destPath,
      reattachKeyComments(dump(destWs, { lineWidth: -1, sortKeys: false }), extractKeyComments(destRaw)),
    );
  }
  return toAdopt.map(([selector]) => selector);
}

/**
 * The package a selector is about: `typeorm` for `typeorm>ioredis` and
 * `typeorm@1>ioredis`, `ioredis` for the unscoped `ioredis`. Scoped names keep
 * their scope (`@swc/cli>chokidar` → `@swc/cli`).
 */
export function selectorSubject(selector: string): string {
  const gt = selector.indexOf('>');
  const spec = (gt === -1 ? selector : selector.slice(0, gt)).trim();
  const versionAt = spec.indexOf('@', spec.startsWith('@') ? 1 : 0);
  return versionAt === -1 ? spec : spec.slice(0, versionAt);
}

/** The value as a plain object, or `null` for any other shape. */
function asObject(value: unknown): null | Record<string, unknown> {
  if (!value || typeof value !== 'object' || Array.isArray(value)) return null;
  return value as Record<string, unknown>;
}

/**
 * Index after the last non-blank line of the block a key at `keyIndex` opens:
 * every following line that is blank or indented deeper than `keyIndent`. A
 * comment at the key's own indent or shallower already belongs to what follows.
 */
function blockEnd(lines: string[], keyIndex: number, keyIndent: number): number {
  let end = keyIndex + 1;
  for (let i = keyIndex + 1; i < lines.length; i++) {
    if (isBlank(lines[i])) continue;
    if (indentOf(lines[i]) <= keyIndent) break;
    end = i + 1;
  }
  return end;
}

/** Indent of the first entry (not a comment) inside the block, or `null` for an empty block. */
function childIndent(lines: string[], keyIndex: number, end: number): null | number {
  for (let i = keyIndex + 1; i < end; i++) {
    if (!isBlank(lines[i]) && !isComment(lines[i])) return indentOf(lines[i]);
  }
  return null;
}

/**
 * Line index of `key:` opening a BLOCK mapping at exactly `indent` within
 * [from, to); -1 when there is no such key; `null` when the key exists in a form
 * no line can be added below (`key: {…}`, `key: []`, `key: ~`).
 */
function findBlockKey(lines: string[], key: string, indent: number, from: number, to: number): null | number {
  const pattern = new RegExp(`^ {${indent}}${key}:(.*)$`);
  for (let i = from; i < to; i++) {
    const match = pattern.exec(lines[i]);
    if (!match) continue;
    return /^\s*(#.*)?$/.test(match[1]) ? i : null;
  }
  return -1;
}

function indentOf(line: string): number {
  return line.search(/\S/);
}

/**
 * The file with the new selectors inserted below `peerDependencyRules` →
 * `allowedVersions`, creating either level where it is missing, or `null` where
 * the file's shape gives no safe place.
 */
function insertAllowedVersions(
  raw: string,
  entries: [string, string][],
  comments: Map<string, string[]>,
): null | string {
  const eol = raw.includes('\r\n') ? '\r\n' : '\n';
  const lines = raw.split(/\r?\n/);
  const render = (indent: number): string[] =>
    entries.flatMap(([selector, range]) => [
      ...(comments.get(selector) ?? []).map((comment) => `${' '.repeat(indent)}${comment}`),
      `${' '.repeat(indent)}${quote(selector)}: ${quote(range)}`,
    ]);

  const rulesLine = findBlockKey(lines, 'peerDependencyRules', 0, 0, lines.length);
  if (rulesLine === null) return null;

  if (rulesLine === -1) {
    // No rules yet: a new block at the end of the file.
    while (lines.length > 0 && isBlank(lines[lines.length - 1])) lines.pop();
    lines.push('peerDependencyRules:', '  allowedVersions:', ...render(4), '');
    return lines.join(eol);
  }

  const rulesEnd = blockEnd(lines, rulesLine, 0);
  const step = childIndent(lines, rulesLine, rulesEnd) ?? 2;
  const allowedLine = findBlockKey(lines, 'allowedVersions', step, rulesLine + 1, rulesEnd);
  if (allowedLine === null) return null;

  if (allowedLine === -1) {
    lines.splice(rulesEnd, 0, `${' '.repeat(step)}allowedVersions:`, ...render(step * 2));
    return lines.join(eol);
  }

  const allowedEnd = blockEnd(lines, allowedLine, step);
  const entryIndent = childIndent(lines, allowedLine, allowedEnd) ?? step * 2;
  lines.splice(allowedEnd, 0, ...render(entryIndent));
  return lines.join(eol);
}

function isBlank(line: string): boolean {
  return /^\s*$/.test(line);
}

function isComment(line: string): boolean {
  return /^\s*#/.test(line);
}

/** A single-quoted YAML scalar: only `'` needs escaping, by doubling it. */
function quote(value: string): string {
  return `'${value.replace(/'/g, "''")}'`;
}

/** Deep equality of two parsed YAML values, ignoring key order. */
function sameValue(a: unknown, b: unknown): boolean {
  const canonical = (value: unknown): unknown => {
    if (Array.isArray(value)) return value.map(canonical);
    if (value && typeof value === 'object') {
      return Object.keys(value)
        .sort()
        .map((key) => [key, canonical((value as Record<string, unknown>)[key])]);
    }
    return value;
  };
  return JSON.stringify(canonical(a)) === JSON.stringify(canonical(b));
}

/** `'a''b'` → `a'b`, `"x"` → `x`, a plain scalar unchanged. */
function unquote(key: string): string {
  if (key.startsWith("'") && key.endsWith("'")) return key.slice(1, -1).replace(/''/g, "'");
  if (key.startsWith('"') && key.endsWith('"')) return key.slice(1, -1);
  return key;
}

/**
 * The comment block directly above each selector in the framework's
 * `allowedVersions` (contiguous `#` lines, a blank line ends it), trimmed so it
 * can be re-indented. A block with a control character is dropped.
 */
function upstreamSelectorComments(raw: string): Map<string, string[]> {
  const out = new Map<string, string[]>();
  const lines = raw.split(/\r?\n/);
  const rulesLine = findBlockKey(lines, 'peerDependencyRules', 0, 0, lines.length);
  if (rulesLine === null || rulesLine === -1) return out;
  const rulesEnd = blockEnd(lines, rulesLine, 0);
  const step = childIndent(lines, rulesLine, rulesEnd);
  if (step === null) return out;
  const allowedLine = findBlockKey(lines, 'allowedVersions', step, rulesLine + 1, rulesEnd);
  if (allowedLine === null || allowedLine === -1) return out;

  let pending: string[] = [];
  const allowedEnd = blockEnd(lines, allowedLine, step);
  for (let i = allowedLine + 1; i < allowedEnd; i++) {
    const line = lines[i];
    if (isComment(line)) {
      pending.push(line.trim());
      continue;
    }
    const key = /^\s*('(?:[^']|'')*'|"[^"]*"|[^\s'"#][^:#]*?)\s*:/.exec(line)?.[1];
    if (key !== undefined && pending.length > 0 && !pending.some((comment) => CONTROL_CHARS.test(comment))) {
      out.set(unquote(key), pending);
    }
    pending = [];
  }
  return out;
}
