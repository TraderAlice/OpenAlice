#!/usr/bin/env tsx
/**
 * Opt-in native TUI acceptance for the Session activity bridge.
 *
 * This intentionally uses the runtime's existing native/global login. It does
 * not read, print, or copy OpenAlice credentials. A successful run proves that
 * a real interactive turn emits waiting -> working -> waiting while the PTY
 * process remains alive for another prompt.
 *
 * Usage:
 *   pnpm exec tsx scripts/session-activity-runtime-smoke.ts --agent opencode
 *   pnpm exec tsx scripts/session-activity-runtime-smoke.ts --agent pi
 */

import { randomUUID } from 'node:crypto';
import { mkdtemp, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join, resolve } from 'node:path';

import * as pty from 'node-pty';

import type {
  CliAdapter,
  ResolvedSessionRuntimeBinding,
  SpawnContext,
} from '../src/workspaces/cli-adapter.js';
import { opencodeAdapter } from '../src/workspaces/adapters/opencode.js';
import { piAdapter } from '../src/workspaces/adapters/pi.js';

type AgentId = 'opencode' | 'pi';
type ActivityPhase = 'starting' | 'working' | 'waiting' | 'unavailable' | 'failed' | 'stopped';

const repoRoot = resolve(import.meta.dirname, '..');
const prompt = 'Reply with exactly OPENALICE_ACTIVITY_SMOKE, then wait for another message. Do not use tools.';
const timeoutMs = 180_000;

function parseAgent(argv: readonly string[]): AgentId {
  const index = argv.indexOf('--agent');
  const value = index >= 0 ? argv[index + 1] : undefined;
  if (value === 'opencode' || value === 'pi') return value;
  throw new Error('Usage: --agent opencode|pi');
}

function adapterFor(agent: AgentId): CliAdapter {
  return agent === 'opencode' ? opencodeAdapter : piAdapter;
}

function runtimeFor(agent: AgentId): ResolvedSessionRuntimeBinding {
  return {
    binding: {
      version: 1,
      credential: { source: 'native' },
      model: agent === 'opencode'
        ? 'opencode/deepseek-v4-flash-free'
        : 'deepseek/deepseek-v4-flash',
      reasoningEffort: 'low',
    },
    ai: null,
  };
}

function hasSequence(phases: readonly ActivityPhase[]): boolean {
  const expected: readonly ActivityPhase[] = ['waiting', 'working', 'waiting'];
  let cursor = 0;
  for (const phase of phases) {
    if (phase === expected[cursor]) cursor += 1;
    if (cursor === expected.length) return true;
  }
  return false;
}

async function wait(ms: number): Promise<void> {
  await new Promise((resolvePromise) => setTimeout(resolvePromise, ms));
}

async function main(): Promise<void> {
  const agent = parseAgent(process.argv.slice(2));
  const adapter = adapterFor(agent);
  const cwd = await mkdtemp(join(tmpdir(), `openalice-${agent}-activity-smoke-`));
  const sessionId = `smoke-${agent}-${randomUUID()}`;
  const phases: ActivityPhase[] = [];
  let exited = false;
  let terminal = '';

  try {
    await writeFile(join(cwd, 'README.md'), '# OpenAlice activity smoke\n', 'utf8');
    await adapter.lifecycle?.prepareWorkspace?.({
      wsId: `smoke-${agent}`,
      cwd,
      launcherRepoRoot: repoRoot,
    });

    if (!adapter.sessionRuntime) throw new Error(`${agent} has no Session runtime projection`);
    const baseEnv = Object.fromEntries(
      Object.entries(process.env).filter((entry): entry is [string, string] => entry[1] !== undefined),
    );
    const projection = adapter.sessionRuntime.project({ cwd, env: baseEnv }, runtimeFor(agent));
    const env = {
      ...baseEnv,
      ...projection.env,
      AQ_SESSION_ID: sessionId,
      OPENCODE_DISABLE_AUTOUPDATE: '1',
      OPENCODE_DISABLE_LSP_DOWNLOAD: '1',
      TERM: 'xterm-256color',
    };
    const context: SpawnContext = {
      cwd,
      env,
      initialPrompt: prompt,
      sessionRuntime: projection,
      ...(agent === 'pi' ? { resume: { sessionId: randomUUID() }, approveProject: true } : {}),
    };
    const command = adapter.composeCommand([adapter.binary ?? agent], context);
    const [binary, ...args] = command;
    if (!binary) throw new Error('adapter composed an empty command');

    console.log(`[activity-smoke] ${agent}: launching native TUI`);
    const term = pty.spawn(binary, args, {
      name: 'xterm-256color',
      cols: 100,
      rows: 30,
      cwd,
      env,
      encoding: null,
    });
    term.onExit(() => { exited = true; });
    term.onData((chunk) => {
      terminal += Buffer.isBuffer(chunk) ? chunk.toString('utf8') : chunk;
      if (terminal.length > 1_000_000) terminal = terminal.slice(-1_000_000);
      const pattern = /\x1b\]6973;openalice-session-activity;v=1;session=([^;]+);phase=([^\x1b]+)\x1b\\/g;
      let match: RegExpExecArray | null;
      const observed: ActivityPhase[] = [];
      while ((match = pattern.exec(terminal)) !== null) {
        if (match[1] !== sessionId) continue;
        const phase = match[2] as ActivityPhase;
        if (!observed.includes(phase) || observed.at(-1) !== phase) observed.push(phase);
      }
      phases.length = 0;
      phases.push(...observed);
    });

    const deadline = Date.now() + timeoutMs;
    while (!hasSequence(phases) && !exited && Date.now() < deadline) await wait(100);
    if (!hasSequence(phases)) {
      throw new Error(`${agent} did not emit waiting -> working -> waiting; observed: ${phases.join(' -> ') || '<none>'}`);
    }
    await wait(1_000);
    if (exited) throw new Error(`${agent} exited after settling instead of keeping its TUI alive`);

    console.log(`[activity-smoke] ${agent}: ${phases.join(' -> ')}; PTY pid ${term.pid} remains alive`);
    term.kill();
  } finally {
    await rm(cwd, { recursive: true, force: true });
  }
}

await main();

