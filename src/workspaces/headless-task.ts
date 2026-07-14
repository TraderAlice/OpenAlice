/**
 * Headless task runner — the automation-dispatch primitive.
 *
 * Spawns an agent CLI's ONE-SHOT headless command (from
 * `adapter.composeHeadlessCommand`, prompt already placed) on a plain pipe and
 * waits for it to EXIT — the turn boundary that means the task is done.
 *
 * Differences from `probe.ts` (and why this is a separate primitive):
 *  - **Plain `child_process.spawn`, not node-pty.** Probe replays the user's
 *    real interactive TUI path (needs a PTY); a headless task wants clean,
 *    separated stdout/stderr — a PTY mangles the JSON stream with terminal
 *    control bytes (verified across all four adapters).
 *  - **Exit is the done signal.** One-shot modes (`-p` / `exec` / `run`) exit
 *    at the turn boundary, so we wait on exit rather than timeout-killing the
 *    way probe must (interactive TUIs never exit). The watchdog is a backstop
 *    (codex can hang under heavy logging).
 *  - **NOT routed through SessionPool/PersistentSession**, whose respawn-on-exit
 *    circuit is anti-semantic for a one-shot task (exit == completion).
 *
 * The launcher normalizes each runtime's JSON event stream into a compact,
 * vendor-neutral reply/tool timeline while preserving size-capped operator
 * diagnostics. `inbox_push` remains the durable user-delivery channel.
 */
import { createWriteStream } from 'node:fs';
import { mkdir, rename, writeFile } from 'node:fs/promises';
import { dirname } from 'node:path';
import { spawn, type ChildProcess } from 'node:child_process';
import { StringDecoder } from 'node:string_decoder';

import type { Logger } from './logger.js';
import {
  HeadlessOutputAccumulator,
  type HeadlessOutputEvent,
  type HeadlessStructuredOutput,
} from './headless-output.js';
import { resolveLaunchCommand } from './win-command.js';

const KILL_GRACE_MS = 5_000;
const OUTPUT_TAIL_BYTES = 16 * 1024;
const ASSISTANT_TEXT_MAX_CHARS = 64 * 1024;
const RAW_LOG_MAX_BYTES = 16 * 1024 * 1024;
const STRUCTURED_WRITE_DEBOUNCE_MS = 100;
/** Scanner line buffer cap — a "line" past this without \n is not the id announcement. */
const SCAN_LINE_MAX_BYTES = 256 * 1024;

export interface HeadlessTaskArgs {
  /** Full argv WITH the prompt already placed (from composeHeadlessCommand). */
  readonly command: readonly string[];
  readonly cwd: string;
  readonly env: Readonly<Record<string, string>>;
  /** Watchdog: SIGTERM at `timeoutMs`, SIGKILL after a grace window. */
  readonly timeoutMs: number;
  readonly logger: Logger;
  /**
   * Stream stdout/stderr to bounded operator logs (16MB per stream; the
   * in-memory tails keep the last 16KB). Pi emits cumulative message_update
   * frames, so unbounded diagnostics can otherwise grow into gigabytes.
   */
  readonly stdoutFile?: string;
  readonly stderrFile?: string;
  /** Debounced compact structured snapshot used by the Automation UI. */
  readonly structuredFile?: string;
  /**
   * Adapter hook (`extractHeadlessSessionId`): called once per complete stdout
   * line until it returns a non-null agent session id; `onSessionId` then fires
   * (used to record the id on the task WHILE it runs, so a finished run can be
   * reopened as an interactive session).
   */
  readonly extractSessionId?: (line: string) => string | null;
  readonly onSessionId?: (id: string) => void;
  /** Legacy/fallback JSONL decoder when no structured event translator exists. */
  readonly extractAssistantText?: (line: string) => string | null;
  /** Adapter-owned JSONL translator for response and tool blocks. */
  readonly extractOutputEvents?: (line: string) => readonly HeadlessOutputEvent[];
  /** Adapter-owned compaction filter for persisted stdout diagnostics. */
  readonly keepDiagnosticLine?: (line: string) => boolean;
  /**
   * Default false. The normal automation path refuses Windows npm .cmd shims
   * because the task prompt is user-controlled. Runtime readiness probes pass a
   * launcher-owned fixed prompt and may opt in so opencode/Pi can be checked.
   */
  readonly allowShellShim?: boolean;
  /** Internal liveness hook used by Workspace mutation guards. */
  readonly onChildSpawned?: (child: ChildProcess) => void;
}

export interface HeadlessTaskResult {
  readonly command: readonly string[];
  readonly cwd: string;
  readonly exitCode: number | null;
  readonly signal: NodeJS.Signals | null;
  /** True if the watchdog had to kill the process (timeout, not natural exit). */
  readonly killed: boolean;
  readonly durationMs: number;
  /** Last bytes of stdout/stderr — diagnostics only; never parsed for control flow. */
  readonly stdoutTail: string;
  readonly stderrTail: string;
  /** The agent's own session id, if `extractSessionId` found one in stdout. */
  readonly agentSessionId: string | null;
  /** Latest completed assistant reply decoded from structured stdout. */
  readonly assistantText: string | null;
  /** Vendor-neutral reply + message/tool block timeline. */
  readonly structured: HeadlessStructuredOutput;
}

/**
 * Turn process/runtime evidence into the durable task status shown to callers.
 *
 * Some runtimes (currently Codex) emit retryable `error` events while
 * reconnecting, then continue to a normal assistant reply and exit 0. Keep
 * those events in the activity stream, but only treat an in-band runtime error
 * as terminal when no later assistant text recovered the turn.
 */
export function headlessTaskStatus(
  result: Pick<HeadlessTaskResult, 'exitCode' | 'killed' | 'structured'>,
): 'done' | 'failed' {
  if (result.killed || result.exitCode !== 0) return 'failed';

  let lastError = -1;
  let lastText = -1;
  result.structured.blocks.forEach((block, index) => {
    if (block.type === 'error') lastError = index;
    if (block.type === 'text') lastText = index;
  });
  return lastError > lastText ? 'failed' : 'done';
}

/**
 * Byte-accumulating tail sink. Buffers raw chunks and decodes UTF-8 ONCE at the
 * end — so a multi-byte sequence split across two `data` chunks isn't mangled
 * into U+FFFD at the seam (which per-chunk `.toString()` would do, corrupting
 * the very JSON tail an operator reads). Memory is bounded: once well over the
 * budget the chunks collapse to the last `maxBytes`.
 */
function makeTailSink(maxBytes: number): { push(c: Buffer): void; text(): string } {
  let chunks: Buffer[] = [];
  let total = 0;
  return {
    push(c) {
      chunks.push(c);
      total += c.length;
      if (total > maxBytes * 2) {
        const merged = Buffer.concat(chunks).subarray(-maxBytes);
        chunks = [merged];
        total = merged.length;
      }
    },
    text() {
      return Buffer.concat(chunks).subarray(-maxBytes).toString('utf8');
    },
  };
}

/**
 * Newline-buffered scanner over a byte stream: feeds COMPLETE lines to
 * `extract` until it returns an id, then goes inert. A pathological "line"
 * exceeding the cap without a newline is discarded (the id announcement is a
 * small JSONL event in the first lines of every adapter's headless output).
 */
function makeStructuredOutputScanner(opts: {
  readonly extractSessionId?: (line: string) => string | null;
  readonly onSessionId: (id: string) => void;
  readonly extractAssistantText?: (line: string) => string | null;
  readonly onAssistantText: (text: string) => void;
  readonly extractOutputEvents?: (line: string) => readonly HeadlessOutputEvent[];
  readonly onOutputEvents: (events: readonly HeadlessOutputEvent[]) => void;
  readonly onDiagnosticLine?: (rawLine: string, terminated: boolean) => void;
}): { push(c: Buffer): void; finish(): void } {
  let buf = '';
  let sessionDone = false;
  const decoder = new StringDecoder('utf8');

  const inspect = (raw: string, terminated: boolean) => {
    opts.onDiagnosticLine?.(raw, terminated);
    const line = raw.trim();
    if (!line) return;
    if (!sessionDone && opts.extractSessionId) {
      const id = opts.extractSessionId(line);
      if (id) {
        sessionDone = true;
        opts.onSessionId(id);
      }
    }
    // A structured translator owns assistant text as well as tool/error events.
    // Do not parse the same vendor JSON twice; the old text hook remains a
    // compatibility fallback for adapters without a translator.
    if (opts.extractOutputEvents) {
      opts.onOutputEvents(opts.extractOutputEvents(line));
    } else if (opts.extractAssistantText) {
      const text = opts.extractAssistantText(line)?.trim();
      if (text) opts.onAssistantText(text);
    }
  };

  const drain = () => {
    let nl: number;
    while ((nl = buf.indexOf('\n')) !== -1) {
      inspect(buf.slice(0, nl), true);
      buf = buf.slice(nl + 1);
    }
    if (buf.length > SCAN_LINE_MAX_BYTES) buf = '';
  };

  return {
    push(c) {
      buf += decoder.write(c);
      drain();
    },
    finish() {
      buf += decoder.end();
      drain();
      if (buf.length > 0) inspect(buf, false);
      buf = '';
    },
  };
}

interface BoundedLogStream {
  write(chunk: Buffer): void
  end(): void
}

/** Open a size-capped diagnostic stream; null (+ warn) on failure. */
async function openLogStream(path: string, logger: Logger, name: string): Promise<BoundedLogStream | null> {
  try {
    await mkdir(dirname(path), { recursive: true });
    const ws = createWriteStream(path);
    ws.on('error', (err) => logger.warn('headless.log_write_failed', { name, path, err }));
    let written = 0;
    let capped = false;
    return {
      write(chunk) {
        if (capped) return;
        const remaining = RAW_LOG_MAX_BYTES - written;
        if (remaining > 0) {
          const slice = chunk.length <= remaining ? chunk : chunk.subarray(0, remaining);
          ws.write(slice);
          written += slice.length;
        }
        if (chunk.length > remaining) {
          capped = true;
          ws.write(Buffer.from('\n… diagnostic log capped at 16MB; use structured output …\n'));
        }
      },
      end() {
        ws.end();
      },
    };
  } catch (err) {
    logger.warn('headless.log_open_failed', { name, path, err });
    return null;
  }
}

function createStructuredSnapshotWriter(path: string | undefined, logger: Logger): {
  schedule(snapshot: HeadlessStructuredOutput): void
  finish(snapshot: HeadlessStructuredOutput): Promise<void>
} | null {
  if (!path) return null
  let latest: HeadlessStructuredOutput | null = null
  let timer: NodeJS.Timeout | null = null
  let chain = Promise.resolve()

  const enqueue = () => {
    const snapshot = latest
    if (!snapshot) return
    chain = chain.then(async () => {
      try {
        await mkdir(dirname(path), { recursive: true })
        const tmp = `${path}.tmp`
        await writeFile(tmp, JSON.stringify(snapshot), 'utf8')
        await rename(tmp, path)
      } catch (err) {
        logger.warn('headless.structured_write_failed', { path, err })
      }
    })
  }

  return {
    schedule(snapshot) {
      latest = snapshot
      if (timer) return
      timer = setTimeout(() => {
        timer = null
        enqueue()
      }, STRUCTURED_WRITE_DEBOUNCE_MS)
      timer.unref()
    },
    async finish(snapshot) {
      latest = snapshot
      if (timer) {
        clearTimeout(timer)
        timer = null
      }
      enqueue()
      await chain
    },
  }
}

export async function runHeadlessTask(args: HeadlessTaskArgs): Promise<HeadlessTaskResult> {
  const { command, cwd, env, timeoutMs, logger } = args;
  const [argv0] = command;
  if (!argv0) throw new Error('headless: empty command');

  const start = Date.now();
  let exitCode: number | null = null;
  let signal: NodeJS.Signals | null = null;
  let killed = false;
  let agentSessionId: string | null = null;
  let assistantText: string | null = null;
  const structuredOutput = new HeadlessOutputAccumulator();
  const structuredWriter = createStructuredSnapshotWriter(args.structuredFile, logger);
  const outSink = makeTailSink(OUTPUT_TAIL_BYTES);
  const errSink = makeTailSink(OUTPUT_TAIL_BYTES);
  let outFile: BoundedLogStream | null = null;
  const scanner = args.extractSessionId || args.extractAssistantText || args.extractOutputEvents || args.keepDiagnosticLine
    ? makeStructuredOutputScanner({
        ...(args.extractSessionId ? { extractSessionId: args.extractSessionId } : {}),
        ...(args.extractAssistantText ? { extractAssistantText: args.extractAssistantText } : {}),
        ...(args.extractOutputEvents ? { extractOutputEvents: args.extractOutputEvents } : {}),
        onSessionId: (id) => {
          agentSessionId = id;
          logger.info('headless.session_id_captured', { agentSessionId: id });
          args.onSessionId?.(id);
        },
        onAssistantText: (text) => {
          assistantText = text.slice(-ASSISTANT_TEXT_MAX_CHARS);
          structuredOutput.setAssistantText(assistantText);
          structuredWriter?.schedule(structuredOutput.snapshot(true));
        },
        onOutputEvents: (events) => {
          structuredOutput.add(events);
          if (events.length > 0) {
            const snapshot = structuredOutput.snapshot(true);
            assistantText = snapshot.assistantText;
            structuredWriter?.schedule(snapshot);
          }
        },
        ...(args.keepDiagnosticLine
          ? {
              onDiagnosticLine: (rawLine: string, terminated: boolean) => {
                const line = rawLine.trim();
                let keep = true;
                try {
                  keep = !line || args.keepDiagnosticLine?.(line) !== false;
                } catch (err) {
                  logger.warn('headless.diagnostic_filter_failed', { err });
                }
                if (!keep) return;
                const chunk = Buffer.from(terminated ? `${rawLine}\n` : rawLine);
                outSink.push(chunk);
                outFile?.write(chunk);
              },
            }
          : {}),
      })
    : null;
  // win32: resolve the bare CLI name against PATH × PATHEXT. Native-exe agents
  // (claude.exe, codex.exe) resolve to a direct path and run headless fine. But
  // npm-shim agents (opencode, pi → a `.cmd`) would have to run through cmd.exe,
  // and the headless PROMPT is the trailing arg — routing it through cmd.exe
  // re-parses shell metacharacters (CVE-2024-27980 territory), a real injection
  // surface. So shim agents stay headless-unsupported on Windows; we fail with a
  // clear, recorded reason instead of a silent ENOENT. (Interactive launch of
  // the same agents works — see win-command.ts / persistent-session.ts.)
  const resolved = resolveLaunchCommand(command, { env });
  if (resolved.viaShell && !args.allowShellShim) {
    logger.error('headless.win32_shim_unsupported', { command: argv0 });
    const structured = structuredOutput.snapshot(false);
    await structuredWriter?.finish(structured);
    return {
      command,
      cwd,
      exitCode: -1,
      signal: null,
      killed: false,
      durationMs: Date.now() - start,
      stdoutTail: '',
      stderrTail:
        `win32: "${argv0}" is an npm .cmd shim; headless dispatch is unsupported ` +
        `on Windows (routing the task prompt through cmd.exe is a shell-injection ` +
        `surface). Native-exe agents (claude, codex) run headless; run shim agents ` +
        `(opencode, pi) interactively instead.`,
      agentSessionId: null,
      assistantText: null,
      structured,
    };
  }
  const [spawnFile, ...spawnArgs] = resolved.argv;
  if (!spawnFile) throw new Error('headless: empty command after resolution');
  outFile = args.stdoutFile ? await openLogStream(args.stdoutFile, logger, 'stdout') : null;
  const errFile = args.stderrFile ? await openLogStream(args.stderrFile, logger, 'stderr') : null;
  const child = spawn(spawnFile, spawnArgs, {
    cwd,
    env: env as NodeJS.ProcessEnv,
    stdio: ['ignore', 'pipe', 'pipe'],
  });
  args.onChildSpawned?.(child);
  child.stdout?.on('data', (d: Buffer) => {
    if (!args.keepDiagnosticLine) {
      outSink.push(d);
      outFile?.write(d);
    }
    scanner?.push(d);
  });
  child.stderr?.on('data', (d: Buffer) => {
    errSink.push(d);
    errFile?.write(d);
  });

  const closePromise = new Promise<void>((resolve) => {
    child.once('error', (err) => {
      // e.g. ENOENT (binary not on PATH). `close` still follows `error`, so
      // wait for it to keep stdout parsing ordered with stream shutdown.
      logger.error('headless.spawn_error', { command: argv0, err });
      errSink.push(Buffer.from(String(err)));
      if (exitCode === null) exitCode = -1;
    });
    child.once('close', (code, sig) => {
      if (exitCode !== -1) exitCode = code;
      signal = sig;
      resolve();
    });
  });

  // Watchdog armed BEFORE the await so it covers the wait: SIGTERM at
  // timeoutMs, SIGKILL after the grace window.
  const softKill = setTimeout(() => {
    killed = true;
    try {
      child.kill('SIGTERM');
    } catch {
      /* already gone */
    }
  }, timeoutMs);
  softKill.unref();
  const hardKill = setTimeout(() => {
    try {
      child.kill('SIGKILL');
    } catch {
      /* ignore */
    }
  }, timeoutMs + KILL_GRACE_MS);
  hardKill.unref();

  await closePromise;
  clearTimeout(softKill);
  clearTimeout(hardKill);
  scanner?.finish();
  const structured = structuredOutput.snapshot(false);
  assistantText = structured.assistantText;
  await structuredWriter?.finish(structured);
  outFile?.end();
  errFile?.end();
  const durationMs = Date.now() - start;
  const stdoutTail = outSink.text();
  const stderrTail = errSink.text();

  logger.info('headless.complete', {
    command: argv0,
    durationMs,
    exitCode,
    signal,
    killed,
    agentSessionId,
    assistantReply: assistantText !== null,
    stdoutBytes: stdoutTail.length,
    stderrBytes: stderrTail.length,
  });

  return {
    command,
    cwd,
    exitCode,
    signal,
    killed,
    durationMs,
    stdoutTail,
    stderrTail,
    agentSessionId,
    assistantText,
    structured,
  };
}
