import { describe, expect, it } from 'vitest';

import { claudeAdapter } from './claude.js';
import { codexAdapter } from './codex.js';
import { agyAdapter } from './agy.js';
import { cursorAdapter } from './cursor.js';
import { grokAdapter } from './grok.js';
import { ompAdapter } from './omp.js';
import { opencodeAdapter } from './opencode.js';
import { piAdapter } from './pi.js';

/**
 * extractHeadlessSessionId across the four agent adapters, fed the REAL first
 * lines each CLI printed in headless mode (captured live 2026-06-11: claude
 * 2.1.x stream-json, codex 0.137.0 exec --json, opencode run --format json,
 * pi 0.78.x --mode json). If a CLI changes its announcement shape, these are
 * the fixtures to refresh.
 */
describe('extractHeadlessSessionId', () => {
  it('claude: any stream-json event carries session_id', () => {
    const line =
      '{"type":"system","subtype":"hook_started","hook_id":"b774421f-fdfc-4b5a-9bf1-ab4719b5cbd8",' +
      '"hook_name":"SessionStart:startup","hook_event":"SessionStart",' +
      '"uuid":"9c3cebe3-d9ea-467e-bad3-fe1369f06f2c","session_id":"414d6b8c-95b4-4e01-8ffc-4b6332da17d4"}';
    expect(claudeAdapter.extractHeadlessSessionId?.(line)).toBe(
      '414d6b8c-95b4-4e01-8ffc-4b6332da17d4',
    );
  });

  it('codex: thread.started carries thread_id (== rollout session_meta.id)', () => {
    const line = '{"type":"thread.started","thread_id":"019eb75e-0b1b-7fa2-ba95-fd7db4463afe"}';
    expect(codexAdapter.extractHeadlessSessionId?.(line)).toBe(
      '019eb75e-0b1b-7fa2-ba95-fd7db4463afe',
    );
    // Other codex events do NOT match (no thread_id outside thread.started).
    expect(codexAdapter.extractHeadlessSessionId?.('{"type":"turn.started"}')).toBeNull();
  });

  it('opencode: events carry top-level sessionID', () => {
    const line =
      '{"type":"step_start","timestamp":1781192886679,"sessionID":"ses_148a17c1bffezxX6W1AJye0ohW",' +
      '"part":{"id":"prt_eb75e8994001nEJXHht4K9Sop4","messageID":"msg_eb75e8449001dcQ4V7w4cfBGwB",' +
      '"sessionID":"ses_148a17c1bffezxX6W1AJye0ohW","type":"step-start"}}';
    expect(opencodeAdapter.extractHeadlessSessionId?.(line)).toBe(
      'ses_148a17c1bffezxX6W1AJye0ohW',
    );
  });

  it('agy: documented stream-json init carries conversation_id', () => {
    const line =
      '{"event":"init","conversation_id":"c3b66b04-872b-4fbe-a3a4-058a026ef20a",' +
      '"init":{"cwd":"/home/user/project","tools":["ask_permission"],"permission_mode":"request-review"}}';
    expect(agyAdapter.extractHeadlessSessionId?.(line)).toBe(
      'c3b66b04-872b-4fbe-a3a4-058a026ef20a',
    );
  });

  it('cursor: documented stream-json system/init carries session_id', () => {
    const line =
      '{"type":"system","subtype":"init","apiKeySource":"login","cwd":"/Users/user/project",' +
      '"session_id":"c6b62c6f-7ead-4fd6-9922-e952131177ff","model":"Claude 4 Sonnet",' +
      '"permissionMode":"default"}';
    expect(cursorAdapter.extractHeadlessSessionId?.(line)).toBe(
      'c6b62c6f-7ead-4fd6-9922-e952131177ff',
    );
  });

  it('grok: documented json object carries sessionId', () => {
    const line = '{"text":"ok","stopReason":"EndTurn","sessionId":"019ff963-4d80-7650-a109-efd64717a05d"}';
    expect(grokAdapter.extractHeadlessSessionId?.(line)).toBe(
      '019ff963-4d80-7650-a109-efd64717a05d',
    );
  });

  it('omp: line 1 is {"type":"session","id":…} (live 17.3.4)', () => {
    const line =
      '{"type":"session","version":3,"id":"01a00adc-0884-7000-b507-017949683107",' +
      '"timestamp":"2026-08-16T13:56:27.396Z","cwd":"/tmp/omp-alice-probe.d2iMY8/ws"}';
    expect(ompAdapter.extractHeadlessSessionId?.(line)).toBe(
      '01a00adc-0884-7000-b507-017949683107',
    );
    expect(
      ompAdapter.extractHeadlessSessionId?.('{"type":"message_end","id":"not-a-session"}'),
    ).toBeNull();
  });

  it('pi: line 1 is {"type":"session","id":…}', () => {
    const line =
      '{"type":"session","version":3,"id":"c54cdf3b-fc9c-403d-8088-41dd2a8b122b",' +
      '"timestamp":"2026-06-11T15:47:42.189Z","cwd":"/private/tmp"}';
    expect(piAdapter.extractHeadlessSessionId?.(line)).toBe(
      'c54cdf3b-fc9c-403d-8088-41dd2a8b122b',
    );
    // pi's later events (messages) have no type:"session" → no match.
    expect(
      piAdapter.extractHeadlessSessionId?.('{"type":"message","id":"not-a-session"}'),
    ).toBeNull();
  });

  it('non-JSON and irrelevant lines return null everywhere', () => {
    for (const adapter of [claudeAdapter, codexAdapter, cursorAdapter, agyAdapter, grokAdapter, ompAdapter, opencodeAdapter, piAdapter]) {
      expect(adapter.extractHeadlessSessionId?.('plain text noise')).toBeNull();
      expect(adapter.extractHeadlessSessionId?.('{"type":"other"}')).toBeNull();
    }
  });

  it('every headless-capable adapter declares an extractor', () => {
    for (const adapter of [claudeAdapter, codexAdapter, cursorAdapter, agyAdapter, grokAdapter, ompAdapter, opencodeAdapter, piAdapter]) {
      expect(adapter.capabilities.headless).toBe(true);
      expect(typeof adapter.extractHeadlessSessionId).toBe('function');
    }
  });
});
