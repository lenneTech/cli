import { mkdtempSync, rmSync, writeFileSync } from 'fs';
import { tmpdir } from 'os';
import { join } from 'path';

import { describeLog, diagnoseLog, findEarlyExits, isSilentLog, tailLines } from '../src/lib/dev-log-tail';

describe('dev-log-tail', () => {
  const dir = mkdtempSync(join(tmpdir(), 'lt-log-tail-'));
  afterAll(() => rmSync(dir, { force: true, recursive: true }));

  it('an EMPTY log is reported as such — never as silence', () => {
    const file = join(dir, 'empty.log');
    writeFileSync(file, '');
    const lines = describeLog(diagnoseLog(file));
    expect(lines).toHaveLength(1);
    expect(lines[0]).toContain('EMPTY');
    expect(lines[0]).toContain('not captured');
  });

  it('a missing log is reported, not skipped', () => {
    expect(describeLog(diagnoseLog(join(dir, 'nope.log')))[0]).toContain('No log at');
  });

  it('shows the last lines of a log with content, CRLF included', () => {
    const file = join(dir, 'api.log');
    writeFileSync(file, 'one\r\ntwo\r\n\r\nCannot determine a GraphQL output type\r\n');
    const d = diagnoseLog(file, 2);
    expect(d.state).toBe('ok');
    expect(describeLog(d).slice(1)).toEqual(['  two', '  Cannot determine a GraphQL output type']);
  });

  it('tailLines keeps the last n non-empty lines in order', () => {
    expect(tailLines('a\n\nb\nc\n', 2)).toEqual(['b', 'c']);
  });

  it('a log still empty well after start is "silent"; a fresh one is not yet', () => {
    const file = join(dir, 'silent.log');
    writeFileSync(file, '');
    const d = diagnoseLog(file);
    const now = Date.parse('2026-09-23T12:00:30Z');
    expect(isSilentLog(d, '2026-09-23T12:00:00Z', now)).toBe(true);
    expect(isSilentLog(d, '2026-09-23T12:00:25Z', now)).toBe(false);
    expect(isSilentLog(d, undefined, now)).toBe(false);
    expect(isSilentLog(d, 'not a date', now)).toBe(false);
  });

  it('a log with content is never "silent"', () => {
    const file = join(dir, 'busy.log');
    writeFileSync(file, 'Local: http://127.0.0.1:4001/\n');
    expect(isSilentLog(diagnoseLog(file), '2026-09-23T12:00:00Z', Date.parse('2026-09-23T13:00:00Z'))).toBe(false);
  });

  it('findEarlyExits names a component whose pid dies within the window, and only that one', async () => {
    let t = 0;
    const alive = (pid: number) => !(pid === 2 && t >= 2); // app (pid 2) dies on the third look
    const dead = await findEarlyExits(
      [
        { name: 'api', pid: 1 },
        { name: 'app', pid: 2 },
        { name: 'skipped', pid: undefined },
      ],
      { budgetMs: 60_000, isAlive: (pid) => alive(pid), sleep: async () => void t++ },
    );
    expect(dead).toEqual(['app']);
  });

  it('findEarlyExits returns nothing when everything stays up for the whole window', async () => {
    const dead = await findEarlyExits([{ name: 'api', pid: 1 }], {
      budgetMs: 50,
      isAlive: () => true,
      sleep: (ms) => new Promise((r) => setTimeout(r, Math.min(ms, 10))),
    });
    expect(dead).toEqual([]);
  });

  it('up and status actually use it (wiring, not behaviour: the commands have no harness)', () => {
    const { readFileSync } = require('fs');
    const src = (f: string) => readFileSync(join(__dirname, '..', 'src', 'commands', 'dev', f), 'utf8');
    expect(src('up.ts')).toMatch(/findEarlyExits\(/);
    expect(src('up.ts')).toMatch(/describeLog\(diagnoseLog\(/);
    expect(src('status.ts')).toMatch(/isSilentLog\(/);
    expect(src('status.ts')).toMatch(/describeLog\(diagnoseLog\(/);
  });
});
