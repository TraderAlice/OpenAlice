import { describe, expect, it } from 'vitest';

import { claudeAdapter } from './claude.js';
import { codexAdapter } from './codex.js';
import { opencodeAdapter } from './opencode.js';
import { piAdapter } from './pi.js';

/**
 * Real structured reply events captured from the locally supported CLIs on
 * 2026-07-11. Keep these fixtures secret-free; refresh them when a supported
 * CLI changes its JSONL contract.
 */
describe('extractHeadlessAssistantText', () => {
  it('claude: reads assistant content and the final success result', () => {
    const assistant = JSON.stringify({
      type: 'assistant',
      message: {
        role: 'assistant',
        content: [
          { type: 'text', text: 'Hello!' },
          { type: 'tool_use', name: 'ignored' },
          { type: 'text', text: 'How can I help?' },
        ],
      },
    });
    const result = JSON.stringify({ type: 'result', subtype: 'success', result: 'Done.' });
    expect(claudeAdapter.extractHeadlessAssistantText?.(assistant)).toBe('Hello!\nHow can I help?');
    expect(claudeAdapter.extractHeadlessAssistantText?.(result)).toBe('Done.');
  });

  it('codex: reads completed agent messages only', () => {
    const reply = JSON.stringify({
      type: 'item.completed',
      item: { id: 'item_0', type: 'agent_message', text: 'Hi there.' },
    });
    const error = JSON.stringify({
      type: 'item.completed',
      item: { id: 'item_1', type: 'error', message: 'Model unavailable.' },
    });
    expect(codexAdapter.extractHeadlessAssistantText?.(reply)).toBe('Hi there.');
    expect(codexAdapter.extractHeadlessAssistantText?.(error)).toBeNull();
  });

  it('opencode: reads completed text parts', () => {
    const line = JSON.stringify({
      type: 'text',
      sessionID: 'ses_example',
      part: { type: 'text', text: 'Hello! How can I help you today?' },
    });
    expect(opencodeAdapter.extractHeadlessAssistantText?.(line)).toBe(
      'Hello! How can I help you today?',
    );
  });

  it('pi: reads assistant message_end but ignores the echoed user message', () => {
    const user = JSON.stringify({
      type: 'message_end',
      message: { role: 'user', content: [{ type: 'text', text: 'Say hello' }] },
    });
    const assistant = JSON.stringify({
      type: 'message_end',
      message: {
        role: 'assistant',
        content: [{ type: 'text', text: 'Hello! 👋' }],
      },
    });
    expect(piAdapter.extractHeadlessAssistantText?.(user)).toBeNull();
    expect(piAdapter.extractHeadlessAssistantText?.(assistant)).toBe('Hello! 👋');
  });

  it('rejects malformed and unrelated output for every adapter', () => {
    for (const adapter of [claudeAdapter, codexAdapter, opencodeAdapter, piAdapter]) {
      expect(adapter.extractHeadlessAssistantText?.('plain text noise')).toBeNull();
      expect(adapter.extractHeadlessAssistantText?.('{"type":"system"}')).toBeNull();
    }
  });

  it('every headless runtime declares a structured assistant decoder', () => {
    for (const adapter of [claudeAdapter, codexAdapter, opencodeAdapter, piAdapter]) {
      expect(adapter.capabilities.headless).toBe(true);
      expect(typeof adapter.extractHeadlessAssistantText).toBe('function');
    }
  });
});
