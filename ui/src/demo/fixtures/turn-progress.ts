import type { HeadlessTurnProgress } from '../../api/headless'

/** Compact live snapshot for demo Issue comments and Inbox inquiries. */
export function demoTurnProgress(now = Date.now()): HeadlessTurnProgress {
  return {
    updatedAt: now,
    assistantText: 'I checked the original Workspace context.',
    blocks: [
      { type: 'text', text: 'I checked the original Workspace context.' },
      { type: 'tool', id: 'demo-read', name: 'Read', status: 'running' },
    ],
    metrics: { textBlocks: 1, toolCalls: 1, toolFailures: 0 },
  }
}
