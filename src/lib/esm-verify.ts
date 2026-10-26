import { ChildProcess, spawn, spawnSync } from 'child_process';
import { existsSync, readFileSync } from 'fs';
import { createServer } from 'net';
import { join } from 'path';

import { findCompiledEntry } from './dev-api-launch';
import { pickPackageManager } from './dev-package-manager';
import { waitForHttp } from './dev-process';

/**
 * Proves an ES module conversion by running the project, not by type-checking it: build, start
 * the BUILT server, list the migrations, start the dev server. The guide's two traps pass every
 * static check and the test suite: a named import Node cannot see in a CommonJS package (489
 * green tests on the starter, a dead production start) and an import cycle under a decorator.
 * Both only show when Node loads the module graph.
 */

export interface VerifyStep {
  detail?: string;
  name: string;
  ok: boolean;
}

/** Lines in a failed run's output that name the cause. */
const CAUSE =
  /does not provide an export named|before initialization|ERR_[A-Z_]+|Cannot find module|SyntaxError|ReferenceError|TypeError|Error:/;
const START_TIMEOUT_MS = 120_000;

export async function verifyEsmProject(
  apiDir: string,
  onStep: (name: string) => void = () => undefined,
): Promise<VerifyStep[]> {
  const steps: VerifyStep[] = [];
  const pm = pickPackageManager(apiDir);
  const pkg = JSON.parse(readFileSync(join(apiDir, 'package.json'), 'utf8'));
  const scripts: Record<string, string> = pkg.scripts ?? {};

  onStep('build');
  const build = spawnSync(pm.bin, pm.runScript('build'), {
    cwd: apiDir,
    encoding: 'utf8',
    maxBuffer: 64 * 1024 * 1024,
  });
  steps.push({ detail: causeOf(`${build.stdout}\n${build.stderr}`), name: 'build', ok: build.status === 0 });
  if (build.status !== 0) return steps;

  onStep('start the built server');
  const entry = findCompiledEntry(apiDir);
  if (!entry) {
    steps.push({
      detail: 'no dist/src/main.js or dist/main.js after the build',
      name: 'start the built server',
      ok: false,
    });
  } else {
    steps.push({ ...(await startAndProbe(apiDir, process.execPath, [entry])), name: 'start the built server' });
  }

  if (scripts['migrate:list']) {
    onStep('migrate:list');
    const list = spawnSync(pm.bin, pm.runScript('migrate:list'), {
      cwd: apiDir,
      encoding: 'utf8',
      maxBuffer: 16 * 1024 * 1024,
    });
    steps.push({ detail: causeOf(`${list.stdout}\n${list.stderr}`), name: 'migrate:list', ok: list.status === 0 });
  }

  const nodemon = join(apiDir, 'nodemon.json');
  const exec = existsSync(nodemon) ? JSON.parse(readFileSync(nodemon, 'utf8')).exec : undefined;
  if (typeof exec === 'string') {
    onStep('dev start');
    // The project's own dev command, as nodemon runs it, with its local binaries on PATH.
    // `exec` replaces the shell, so the probe's kill reaches the server itself.
    steps.push({ ...(await startAndProbe(apiDir, '/bin/sh', ['-c', `exec ${exec}`])), name: 'dev start' });
  }
  return steps;
}

/** The lines of `output` that name a failure's cause, at most five. */
function causeOf(output: string): string | undefined {
  const lines = output.split('\n').filter((line) => CAUSE.test(line));
  return lines.length > 0
    ? lines
        .slice(0, 5)
        .map((line) => line.trim())
        .join('\n')
    : undefined;
}

function freePort(): Promise<number> {
  return new Promise((resolve, reject) => {
    const server = createServer();
    server.once('error', reject);
    server.listen(0, '127.0.0.1', () => {
      const address = server.address();
      server.close(() => resolve(typeof address === 'object' && address ? address.port : 0));
    });
  });
}

/** Start `cmd`, wait for an HTTP answer on /health-check, stop it again. */
async function startAndProbe(apiDir: string, cmd: string, args: string[]): Promise<Omit<VerifyStep, 'name'>> {
  const port = await freePort();
  let output = '';
  let exited = false;
  const bin = [join(apiDir, 'node_modules', '.bin'), join(apiDir, '..', '..', 'node_modules', '.bin')].join(':');
  const child: ChildProcess = spawn(cmd, args, {
    cwd: apiDir,
    env: { ...process.env, NODE_ENV: 'local', PATH: `${bin}:${process.env.PATH ?? ''}`, PORT: String(port) },
    stdio: ['ignore', 'pipe', 'pipe'],
  });
  child.stdout?.on('data', (chunk) => (output += chunk));
  child.stderr?.on('data', (chunk) => (output += chunk));
  child.on('exit', () => (exited = true));
  const up = await waitForHttp(`http://127.0.0.1:${port}/health-check`, START_TIMEOUT_MS, undefined, () => exited);
  child.kill('SIGTERM');
  await new Promise((resolve) => setTimeout(resolve, 1500));
  if (!exited) child.kill('SIGKILL');
  return up
    ? { ok: true }
    : { detail: causeOf(output) ?? (exited ? 'exited before answering' : 'no answer within 120s'), ok: false };
}
