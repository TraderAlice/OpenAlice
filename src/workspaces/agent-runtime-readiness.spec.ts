import { describe, expect, it } from 'vitest';

import {
  classifyRuntimeReadinessFailure,
  runtimeProbeSucceeded,
  snapshotRuntimeReadiness,
  type AgentRuntimeReadinessRow,
} from './agent-runtime-readiness.js';
import type { CliAdapter } from './cli-adapter.js';
import type { HeadlessTaskResult } from './headless-task.js';

const piAdapter: CliAdapter = {
  id: 'pi',
  displayName: 'Pi',
  kind: 'agent',
  binary: 'pi',
  capabilities: {
    parallelPerCwd: true,
    resumeLast: false,
    resumeById: true,
    transcriptDiscovery: 'none',
    headless: true,
  },
  composeCommand: () => ['pi'],
  composeHeadlessCommand: () => ['pi', '-p', 'hi'],
};

function result(overrides: Partial<HeadlessTaskResult>): HeadlessTaskResult {
  return {
    command: ['agent'],
    cwd: '/tmp/openalice-runtime-probe',
    exitCode: 1,
    signal: null,
    killed: false,
    durationMs: 12,
    stdoutTail: '',
    stderrTail: '',
    agentSessionId: null,
    assistantText: null,
    structured: {
      schemaVersion: 1,
      assistantText: null,
      blocks: [],
      metrics: { textBlocks: 0, toolCalls: 0, toolFailures: 0 },
      truncated: false,
    },
    ...overrides,
  };
}

describe('agent runtime readiness helpers', () => {
  it('classifies timeout, auth, provider, and generic failures', () => {
    expect(classifyRuntimeReadinessFailure(result({ killed: true }))).toBe('timeout');
    expect(
      classifyRuntimeReadinessFailure(result({ stderrTail: '401 unauthorized: login required' })),
    ).toBe('auth_required');
    expect(
      classifyRuntimeReadinessFailure(result({ stderrTail: 'missing API key provider config' })),
    ).toBe('provider_required');
    expect(
      classifyRuntimeReadinessFailure(result({
        stderrTail: 'WARN plugin config ignored; model gpt-next is unsupported by this CLI version',
      })),
    ).toBe('failed');
    expect(classifyRuntimeReadinessFailure(result({ stderrTail: 'boom' }))).toBe('failed');
  });

  it('requires a clean exit with a decoded assistant reply to count as ready', () => {
    expect(runtimeProbeSucceeded(result({ exitCode: 0, assistantText: 'Hello!' }))).toBe(true);
    expect(runtimeProbeSucceeded(result({ exitCode: 0, stdoutTail: '{"type":"system"}' }))).toBe(false);
    expect(runtimeProbeSucceeded(result({ exitCode: 1, assistantText: 'Hello!' }))).toBe(false);
  });

  it('distinguishes clean output OpenAlice cannot decode from a real reply', () => {
    expect(classifyRuntimeReadinessFailure(result({
      exitCode: 0,
      stdoutTail: '{"type":"future_event","message":"started"}',
    }))).toBe('output_unrecognized');
  });

  it('GET snapshot uses cached rows without inventing readiness', () => {
    const cache = new Map<string, AgentRuntimeReadinessRow>();
    const unknown = snapshotRuntimeReadiness(
      [piAdapter],
      { pi: { installed: true, path: '/usr/bin/pi' } },
      cache,
    );

    expect(unknown.overallReady).toBe(false);
    expect(unknown.agents.pi?.status).toBe('unknown');

    cache.set('pi', {
      agent: 'pi',
      displayName: 'Pi',
      installed: true,
      binPath: '/usr/bin/pi',
      status: 'ready',
      ready: true,
      source: 'global-config',
      checkedAt: '2026-07-08T00:00:00.000Z',
      durationMs: 25,
    });

    const ready = snapshotRuntimeReadiness(
      [piAdapter],
      { pi: { installed: true, path: '/usr/bin/pi' } },
      cache,
    );

    expect(ready.overallReady).toBe(true);
    expect(ready.checkedAt).toBe('2026-07-08T00:00:00.000Z');
    expect(ready.agents.pi?.source).toBe('global-config');
  });
});
