/**
 * Tiny structured logger. One JSON line per log record on stdout (errors on
 * stderr), with an additional append-only file sink at
 * `<OPENALICE_HOME>/logs/workspace-sessions.log` so every spawn / resume /
 * transcript event is grep-able in isolation without scrolling past every
 * other backend log line.
 *
 * Hand-rolled — keep the dep surface zero. The file sink failure must never
 * take down session lifecycle, so all fs errors are swallowed.
 */

import { createWriteStream, mkdirSync, type WriteStream } from 'node:fs';
import { dirname, resolve } from 'node:path';
import { userDataHome } from '@/core/paths.js';

type Level = 'debug' | 'info' | 'warn' | 'error';

const LEVELS: Record<Level, number> = { debug: 10, info: 20, warn: 30, error: 40 };

const envLevel = (process.env['WEB_TERMINAL_LOG_LEVEL'] ?? 'info').toLowerCase();
const minLevel: number = LEVELS[envLevel as Level] ?? LEVELS.info;

const FILE_PATH = resolve(userDataHome, 'logs', 'workspace-sessions.log');
let fileStream: WriteStream | null | undefined;

function openFileSink(path: string): WriteStream | null {
  try {
    mkdirSync(dirname(path), { recursive: true });
    const s = createWriteStream(path, { flags: 'a' });
    s.on('error', () => { /* swallow — never take down spawn lifecycle */ });
    return s;
  } catch {
    return null;
  }
}

function getFileSink(): WriteStream | null {
  // Importing Alice modules must stay read-only until the Runtime lifecycle
  // fence has been validated and acquired. Defer the first filesystem write
  // until Alice actually emits a Workspace log record after that gate.
  if (fileStream === undefined) fileStream = openFileSink(FILE_PATH);
  return fileStream;
}

function write(level: Level, msg: string, fields: Record<string, unknown>, toConsole: boolean): void {
  const record: Record<string, unknown> = {
    ts: new Date().toISOString(),
    level,
    msg,
    ...fields,
  };
  const line = JSON.stringify(record, replacer) + '\n';
  if (toConsole) {
    if (level === 'error' || level === 'warn') {
      process.stderr.write(line);
    } else {
      process.stdout.write(line);
    }
  }
  const sink = getFileSink();
  if (sink) {
    try { sink.write(line); } catch { /* swallow */ }
  }
}

function emit(level: Level, msg: string, fields: Record<string, unknown>): void {
  if (LEVELS[level] < minLevel) return;
  write(level, msg, fields, true);
}

/**
 * Routine connection-lifecycle events (attach / detach / upgrade) — high
 * frequency, useful for forensics but pure noise on the console. Always written
 * to `<OPENALICE_HOME>/logs/workspace-sessions.log`; surfaced on the console ONLY when
 * WEB_TERMINAL_LOG_LEVEL=debug. Keeps `pnpm dev` readable without losing the trail.
 */
function emitEvent(msg: string, fields: Record<string, unknown>): void {
  write('info', msg, fields, minLevel <= LEVELS.debug);
}

function replacer(_key: string, value: unknown): unknown {
  if (value instanceof Error) {
    return { name: value.name, message: value.message, stack: value.stack };
  }
  return value;
}

export interface Logger {
  debug(msg: string, fields?: Record<string, unknown>): void;
  info(msg: string, fields?: Record<string, unknown>): void;
  warn(msg: string, fields?: Record<string, unknown>): void;
  error(msg: string, fields?: Record<string, unknown>): void;
  /** Routine connection-lifecycle event: dedicated file always, console only on debug. */
  event(msg: string, fields?: Record<string, unknown>): void;
  child(bindings: Record<string, unknown>): Logger;
}

function make(bindings: Record<string, unknown>): Logger {
  const merge = (fields?: Record<string, unknown>): Record<string, unknown> =>
    fields === undefined ? bindings : { ...bindings, ...fields };
  return {
    debug: (msg, fields) => emit('debug', msg, merge(fields)),
    info: (msg, fields) => emit('info', msg, merge(fields)),
    warn: (msg, fields) => emit('warn', msg, merge(fields)),
    error: (msg, fields) => emit('error', msg, merge(fields)),
    event: (msg, fields) => emitEvent(msg, merge(fields)),
    child: (extra) => make({ ...bindings, ...extra }),
  };
}

export const logger: Logger = make({});
