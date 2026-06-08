/**
 * Headless probe: run an adapter's CLI against a workspace with a positional
 * prompt appended, capture the transcript-dir delta + a tail of the PTY
 * output stream, return a structured result. Lets an AI (or a CLI caller
 * like `curl`) verify the full wiring — PWD, MCP URL, trust, resume, adapter
 * env composition — end-to-end without touching the UI or interpreting raw
 * PTY byte streams.
 *
 * Design notes:
 * - We use node-pty (not plain child_process) because both `claude` and
 *   `codex` change behavior dramatically in TUI vs. non-TTY mode (trust
 *   dialog, ANSI output, even argument parsing on some flags). The probe
 *   should exercise the same path a real user takes.
 * - We always kill the child on timeout; the CLIs leave the TUI alive after
 *   the prompt's response (waiting for follow-up), so natural exit is rare
 *   for interactive resume + prompt.
 * - jsonl parsing is best-effort: we snapshot transcript-dir file sizes
 *   before the run and then read what's new after. Useful for claude
 *   (`~/.claude/projects/<projectKey>/<sessionId>.jsonl`); codex writes to
 *   `~/.codex/sessions/YYYY/MM/DD/...` which is outside any adapter
 *   transcriptDir, so probe returns an empty `jsonlDelta` for codex — the
 *   caller can still inspect `ptyOutputTail` to verify codex booted.
 */

import { readdir, readFile, stat } from 'node:fs/promises';
import { join } from 'node:path';
import * as pty from 'node-pty';

import type { Logger } from './logger.js';
import { resolveLaunchCommand } from './win-command.js';

export interface HeadlessProbeArgs {
  readonly command: readonly string[];
  readonly cwd: string;
  readonly env: Readonly<Record<string, string>>;
  readonly transcriptDir: string | null;
  readonly transcriptFileRe: RegExp | null;
  readonly prompt: string;
  readonly timeoutMs: number;
  readonly logger: Logger;
}

export interface JsonlFileDelta {
  readonly file: string;
  readonly sizeBefore: number;
  readonly sizeAfter: number;
  /** Last N entries from the file, parsed if valid JSON, otherwise the raw line. */
  readonly tail: readonly unknown[];
}

export interface HeadlessProbeResult {
  readonly command: readonly string[];
  readonly cwd: string;
  readonly envPWD: string | null;
  readonly promptSent: string;
  readonly exitCode: number | null;
  readonly signal: number | null;
  readonly killed: boolean;
  readonly durationMs: number;
  readonly transcriptDir: string | null;
  readonly jsonlDelta: readonly JsonlFileDelta[];
  /** Last ~8 KiB of raw PTY output. ANSI escape codes are preserved — caller can strip if needed. */
  readonly ptyOutputTail: string;
}

const PTY_TAIL_BYTES = 8 * 1024;
const TAIL_ENTRIES_PER_FILE = 6;
const KILL_GRACE_MS = 500;

export async function runHeadlessProbe(args: HeadlessProbeArgs): Promise<HeadlessProbeResult> {
  const { command, cwd, env, transcriptDir, transcriptFileRe, prompt, timeoutMs, logger } = args;

  // win32: resolve the bare CLI name to a real `.exe` or a cmd.exe-wrapped
  // `.cmd` shim before the prompt is appended — same ConPTY limitation the
  // interactive pool handles. Without this, probing opencode/pi on Windows
  // ENOENTs and the agent can never be enabled. The probe prompt is a fixed
  // launcher-internal ping (no untrusted input), so the shim wrap is safe.
  const [argv0, ...argv1Composed] = resolveLaunchCommand(command, { env }).argv;
  if (!argv0) throw new Error('probe: empty command');
  const argv1 = [...argv1Composed, prompt];

  const sizesBefore = await snapshotJsonlSizes(transcriptDir, transcriptFileRe);

  const start = Date.now();
  let buf = '';
  let exitCode: number | null = null;
  let signal: number | null = null;
  let killed = false;

  const child = pty.spawn(argv0, argv1, {
    cwd,
    env: env as { [key: string]: string },
    cols: 80,
    rows: 24,
    encoding: null,
  } as never);

  child.onData((data) => {
    const s = typeof data === 'string' ? data : (data as Buffer).toString('utf8');
    buf += s;
    if (buf.length > PTY_TAIL_BYTES * 2) {
      buf = buf.slice(-PTY_TAIL_BYTES);
    }
  });

  const exitPromise = new Promise<void>((resolve) => {
    child.onExit(({ exitCode: code, signal: sig }) => {
      exitCode = code;
      signal = typeof sig === 'number' ? sig : null;
      resolve();
    });
  });

  const softKillTimer = setTimeout(() => {
    killed = true;
    try { child.kill('SIGTERM'); } catch { /* already gone */ }
  }, timeoutMs);
  softKillTimer.unref();
  const hardKillTimer = setTimeout(() => {
    try { child.kill('SIGKILL'); } catch { /* ignore */ }
  }, timeoutMs + KILL_GRACE_MS);
  hardKillTimer.unref();

  await exitPromise;
  clearTimeout(softKillTimer);
  clearTimeout(hardKillTimer);

  const durationMs = Date.now() - start;
  const jsonlDelta = await collectJsonlDelta(transcriptDir, transcriptFileRe, sizesBefore);

  logger.info('probe.complete', {
    command: argv0,
    durationMs,
    exitCode,
    signal,
    killed,
    jsonlFilesGrown: jsonlDelta.length,
    ptyBytes: buf.length,
  });

  return {
    command: [argv0, ...argv1],
    cwd,
    envPWD: env['PWD'] ?? null,
    promptSent: prompt,
    exitCode,
    signal,
    killed,
    durationMs,
    transcriptDir,
    jsonlDelta,
    ptyOutputTail: buf.slice(-PTY_TAIL_BYTES),
  };
}

async function snapshotJsonlSizes(
  dir: string | null,
  fileRe: RegExp | null,
): Promise<Map<string, number>> {
  const out = new Map<string, number>();
  if (!dir) return out;
  try {
    const names = await readdir(dir);
    for (const name of names) {
      if (fileRe && !fileRe.test(name)) continue;
      try {
        const st = await stat(join(dir, name));
        if (st.isFile()) out.set(name, st.size);
      } catch { /* ignore */ }
    }
  } catch { /* dir absent — fine */ }
  return out;
}

async function collectJsonlDelta(
  dir: string | null,
  fileRe: RegExp | null,
  sizesBefore: Map<string, number>,
): Promise<JsonlFileDelta[]> {
  const out: JsonlFileDelta[] = [];
  if (!dir) return out;
  let names: string[];
  try {
    names = await readdir(dir);
  } catch {
    return out;
  }
  for (const name of names) {
    if (fileRe && !fileRe.test(name)) continue;
    let sizeAfter: number;
    try {
      const st = await stat(join(dir, name));
      if (!st.isFile()) continue;
      sizeAfter = st.size;
    } catch { continue; }
    const sizeBefore = sizesBefore.get(name) ?? 0;
    if (sizeAfter <= sizeBefore) continue;
    let content: string;
    try {
      content = await readFile(join(dir, name), 'utf8');
    } catch { continue; }
    const lines = content.split('\n').filter((l) => l.trim().length > 0);
    const tailLines = lines.slice(-TAIL_ENTRIES_PER_FILE);
    const tail: unknown[] = tailLines.map((l) => {
      try { return JSON.parse(l); } catch { return l; }
    });
    out.push({ file: name, sizeBefore, sizeAfter, tail });
  }
  return out;
}
