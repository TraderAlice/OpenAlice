import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import type { CliAdapter, OnDiskSession } from './cli-adapter.js';
import type { Logger } from './logger.js';
import type { PersistentSession } from './persistent-session.js';
import type { SessionRegistry } from './session-registry.js';
import { TranscriptWatcher } from './transcript-watcher.js';

/* eslint-disable @typescript-eslint/no-explicit-any */

const noopLogger = {
  info() {},
  warn() {},
  error() {},
  debug() {},
  child() {
    return noopLogger;
  },
} as unknown as Logger;

function fakeSession(recordId: string, cwd: string): PersistentSession {
  let id: string | null = null;
  return {
    wsId: 'ws1',
    cwd,
    recordId,
    get agentSessionId() {
      return id;
    },
    setAgentSessionId(v: string) {
      id = v;
    },
  } as unknown as PersistentSession;
}

function fakeSubprocessAdapter(
  list: () => Promise<readonly OnDiskSession[]>,
  id = 'fake',
): CliAdapter {
  return {
    id,
    displayName: 'Fake',
    capabilities: { parallelPerCwd: true, resumeLast: true, resumeById: true, transcriptDiscovery: 'subprocess' },
    composeCommand: (base: readonly string[]) => base,
    listOnDisk: list,
  } as unknown as CliAdapter;
}

const sess = (sessionId: string, mtime: string): OnDiskSession => ({ sessionId, mtime, file: '', sizeBytes: 0 });

describe('TranscriptWatcher — subprocess poll discovery', () => {
  let registry: { update: ReturnType<typeof vi.fn> };
  let watcher: TranscriptWatcher;

  beforeEach(() => {
    vi.useFakeTimers();
    registry = { update: vi.fn(async () => {}) };
    watcher = new TranscriptWatcher(noopLogger, registry as unknown as SessionRegistry);
  });
  afterEach(() => {
    watcher.disposeAll();
    vi.useRealTimers();
  });

  it('captures a NEW post-spawn session id and persists it as resumeHint', async () => {
    let sessions: OnDiskSession[] = [];
    const session = fakeSession('rec1', '/ws/a');
    await watcher.register(session, fakeSubprocessAdapter(async () => sessions)); // existingBefore = {}
    expect(session.agentSessionId).toBeNull();

    sessions = [sess('ses_new', '2026-06-05T10:00:00Z')]; // CLI writes its session
    await vi.advanceTimersByTimeAsync(2000); // fire one poll tick

    expect(session.agentSessionId).toBe('ses_new');
    expect(registry.update).toHaveBeenCalledWith('ws1', 'rec1', {
      resumeHint: { kind: 'agent-session-id', value: 'ses_new' },
    });
  });

  it('ignores sessions that already existed at register time', async () => {
    let sessions: OnDiskSession[] = [sess('ses_old', '2026-06-05T09:00:00Z')];
    const session = fakeSession('rec2', '/ws/b');
    await watcher.register(session, fakeSubprocessAdapter(async () => sessions)); // existingBefore = {ses_old}

    sessions = [sess('ses_old', '2026-06-05T09:00:00Z'), sess('ses_new', '2026-06-05T10:00:00Z')];
    await vi.advanceTimersByTimeAsync(2000);

    expect(session.agentSessionId).toBe('ses_new'); // not ses_old
  });

  it('assigns distinct ids to two concurrent pendings (oldest-first, spawn order)', async () => {
    let sessions: OnDiskSession[] = [];
    const a = fakeSession('recA', '/ws/c');
    const b = fakeSession('recB', '/ws/c'); // same cwd → same poll entry
    const adapter = fakeSubprocessAdapter(async () => sessions);
    await watcher.register(a, adapter);
    await watcher.register(b, adapter);

    sessions = [sess('ses_1', '2026-06-05T10:00:00Z'), sess('ses_2', '2026-06-05T10:00:05Z')];
    await vi.advanceTimersByTimeAsync(2000);

    // oldest pending (a) gets oldest new id; b gets the next; no double-claim.
    expect(a.agentSessionId).toBe('ses_1');
    expect(b.agentSessionId).toBe('ses_2');
  });

  it('keeps concurrent runtime discovery isolated within the same workspace cwd', async () => {
    let ompSessions: OnDiskSession[] = [];
    let codexSessions: OnDiskSession[] = [];
    const omp = fakeSession('recOmp', '/ws/shared');
    const codex = fakeSession('recCodex', '/ws/shared');

    await watcher.register(omp, fakeSubprocessAdapter(async () => ompSessions, 'omp'));
    await watcher.register(codex, fakeSubprocessAdapter(async () => codexSessions, 'codex'));

    codexSessions = [sess('codex_native', '2026-06-05T10:00:00Z')];
    ompSessions = [sess('omp_native', '2026-06-05T10:00:01Z')];
    await vi.advanceTimersByTimeAsync(2000);

    expect(omp.agentSessionId).toBe('omp_native');
    expect(codex.agentSessionId).toBe('codex_native');
  });
});
