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
 *    way probe must (interactive TUIs never exit). Callers may opt into a
 *    watchdog when they need a hard execution deadline.
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
  /** Optional watchdog: SIGTERM at `timeoutMs`, SIGKILL after a grace window. */
  readonly timeoutMs?: number;
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
  /** True only after Node confirms that the child process was created. */
  readonly processStarted?: boolean;
  /** Stable machine-readable reason when the agent process never started. */
  readonly launchErrorCode?: HeadlessLaunchErrorCode;
  /** Human-readable launch error. Absent for failures after process startup. */
  readonly error?: string;
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

export type HeadlessLaunchErrorCode =
  | 'unsupported_windows_batch_shim'
  | 'executable_not_found'
  | 'spawn_failed';

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
  end(): Promise<void>
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
      async end() {
        if (ws.closed) return;
        await new Promise<void>((resolve) => {
          ws.once('close', resolve);
          ws.end();
        });
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
  let processStarted = false;
  let launchErrorCode: HeadlessLaunchErrorCode | undefined;
  let launchError: string | undefined;
  let agentSessionId: string | null = null;
  let assistantText: string | null = null;
  const structuredOutput = new HeadlessOutputAccumulator();
  const structuredWriter = createStructuredSnapshotWriter(args.structuredFile, logger);
  const outSink = makeTailSink(OUTPUT_TAIL_BYTES);
  const errSink = makeTailSink(OUTPUT_TAIL_BYTES);
  let outFile: BoundedLogStream | null = null;
  let errFile: BoundedLogStream | null = null;
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
  // Open logs before command resolution so a pre-process failure is observable
  // through the same output API as a runtime failure.
  outFile = args.stdoutFile ? await openLogStream(args.stdoutFile, logger, 'stdout') : null;
  errFile = args.stderrFile ? await openLogStream(args.stderrFile, logger, 'stderr') : null;

  const finishLaunchFailure = async (
    code: HeadlessLaunchErrorCode,
    message: string,
    details: { launchMode: string; systemCode?: string },
  ): Promise<HeadlessTaskResult> => {
    launchErrorCode = code;
    launchError = message;
    const diagnostic = Buffer.from(`${message}\n`);
    errSink.push(diagnostic);
    errFile?.write(diagnostic);
    logger.error('headless.launch_failed', {
      command: commandName(argv0),
      launchMode: details.launchMode,
      launchErrorCode: code,
      processStarted: false,
      ...(details.systemCode ? { systemCode: details.systemCode } : {}),
    });
    const structured = structuredOutput.snapshot(false);
    await structuredWriter?.finish(structured);
    await Promise.all([outFile?.end(), errFile?.end()]);
    return {
      command,
      cwd,
      processStarted: false,
      launchErrorCode,
      error: launchError,
      exitCode: -1,
      signal: null,
      killed: false,
      durationMs: Date.now() - start,
      stdoutTail: '',
      stderrTail: errSink.text(),
      agentSessionId: null,
      assistantText: null,
      structured,
    };
  };

  // win32: native executables and verified npm entrypoints remain direct.
  // Unknown npm-style batch shims use their extensionless sibling through Bash
  // when available. Only a batch-only fallback still needs cmd.exe, which is
  // restricted to launcher-owned prompts because cmd re-parses metacharacters.
  const resolved = resolveLaunchCommand(command, { env, cwd });
  const [spawnFile, ...spawnArgs] = resolved.argv;
  if (!spawnFile) throw new Error('headless: empty command after resolution');
  logger.info('headless.launch_resolved', {
    command: commandName(argv0),
    resolvedCommand: commandName(spawnFile),
    launchMode: resolved.mode,
  });
  if (resolved.viaShell && !args.allowShellShim) {
    return finishLaunchFailure(
      'unsupported_windows_batch_shim',
      `Windows Agent runtime "${commandName(argv0)}" is a batch-only shim. ` +
        `OpenAlice could not find a verified JavaScript entrypoint or an ` +
        `extensionless sibling that can run through Workspace Bash, and will ` +
        `not route an unattended task prompt through cmd.exe.`,
      { launchMode: resolved.mode },
    );
  }
  let child: ChildProcess;
  try {
    child = spawn(spawnFile, spawnArgs, {
      cwd,
      env: env as NodeJS.ProcessEnv,
      stdio: ['ignore', 'pipe', 'pipe'],
    });
  } catch (err) {
    const systemCode = systemErrorCode(err);
    return finishLaunchFailure(
      systemCode === 'ENOENT' ? 'executable_not_found' : 'spawn_failed',
      launchFailureMessage(commandName(argv0), err),
      { launchMode: resolved.mode, ...(systemCode ? { systemCode } : {}) },
    );
  }
  child.once('spawn', () => {
    processStarted = true;
    args.onChildSpawned?.(child);
  });
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
      const systemCode = systemErrorCode(err);
      const message = launchFailureMessage(commandName(argv0), err);
      logger.error('headless.spawn_error', {
        command: commandName(argv0),
        launchMode: resolved.mode,
        processStarted,
        ...(systemCode ? { systemCode } : {}),
      });
      const diagnostic = Buffer.from(`${message}\n`);
      errSink.push(diagnostic);
      errFile?.write(diagnostic);
      if (!processStarted) {
        launchErrorCode = systemCode === 'ENOENT' ? 'executable_not_found' : 'spawn_failed';
        launchError = message;
      }
      if (exitCode === null) exitCode = -1;
    });
    child.once('close', (code, sig) => {
      if (exitCode !== -1) exitCode = code;
      signal = sig;
      resolve();
    });
  });

  // An explicit watchdog is armed BEFORE the await so it covers the whole
  // process lifetime. Without one, a one-shot Agent runs to its natural exit.
  const softKill = timeoutMs === undefined ? undefined : setTimeout(() => {
    killed = true;
    try {
      child.kill('SIGTERM');
    } catch {
      /* already gone */
    }
  }, timeoutMs);
  softKill?.unref();
  const hardKill = timeoutMs === undefined ? undefined : setTimeout(() => {
    try {
      child.kill('SIGKILL');
    } catch {
      /* ignore */
    }
  }, timeoutMs + KILL_GRACE_MS);
  hardKill?.unref();

  await closePromise;
  if (softKill) clearTimeout(softKill);
  if (hardKill) clearTimeout(hardKill);
  scanner?.finish();
  const structured = structuredOutput.snapshot(false);
  assistantText = structured.assistantText;
  await structuredWriter?.finish(structured);
  await Promise.all([outFile?.end(), errFile?.end()]);
  const durationMs = Date.now() - start;
  const stdoutTail = outSink.text();
  const stderrTail = errSink.text();

  logger.info('headless.complete', {
    command: commandName(argv0),
    launchMode: resolved.mode,
    processStarted,
    ...(launchErrorCode ? { launchErrorCode } : {}),
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
    processStarted,
    ...(launchErrorCode ? { launchErrorCode } : {}),
    ...(launchError ? { error: launchError } : {}),
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

function commandName(value: string): string {
  return value.split(/[\\/]/).pop() || value;
}

function systemErrorCode(error: unknown): string | undefined {
  return error && typeof error === 'object' && 'code' in error && typeof error.code === 'string'
    ? error.code
    : undefined;
}

function launchFailureMessage(command: string, error: unknown): string {
  const code = systemErrorCode(error);
  const detail = error instanceof Error ? error.message : String(error);
  return code === 'ENOENT'
    ? `Agent executable "${command}" was not found. Check the selected runtime installation and Workspace PATH.`
    : `Agent process "${command}" could not start${detail ? `: ${detail}` : '.'}`;
}
