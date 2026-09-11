import { describe, expect, it } from 'vitest';

import {
  projectSessionPresentationTitle,
  readableIssueIdentity,
} from './session-presentation.js';
import type { SessionRecord } from './session-registry.js';

const rawReconstruction = [
  'You are reconstructing a prior Alice Session.',
  '{"target":{"kind":"issue","issueId":"telegram-phone-desk"}}',
].join('\n');

function record(overrides: Partial<SessionRecord> = {}): SessionRecord {
  return {
    id: 'session-1',
    resumeId: 'resume-1',
    wsId: 'ws-1',
    agent: 'pi',
    name: 'p1',
    createdAt: '2026-09-01T00:00:00.000Z',
    lastActiveAt: '2026-09-01T00:01:00.000Z',
    state: 'paused',
    surface: 'headless',
    fallbackTitle: rawReconstruction,
    ...overrides,
  };
}

describe('projectSessionPresentationTitle', () => {
  it('uses Issue birth provenance instead of the scheduled instruction', () => {
    expect(projectSessionPresentationTitle({
      record: record({ fallbackTitle: 'Run the entire daily close checklist.' }),
      createdBy: {
        kind: 'issue',
        workspaceId: 'ws-1',
        issueId: 'daily-market-close',
        policy: 'new-then-resume',
        fire: 'schedule',
      },
    })).toBe('Daily Market Close');
  });

  it('uses an Issue conversation subject instead of reconstruction JSON', () => {
    expect(projectSessionPresentationTitle({
      record: record(),
      createdBy: {
        kind: 'conversation',
        caller: { kind: 'human' },
        reason: 'issue-comment',
        subject: {
          kind: 'issue',
          workspaceId: 'ws-1',
          issueId: 'telegram-phone-desk',
          relation: 'owner',
        },
      },
    })).toBe('Telegram Phone Desk');
  });

  it('uses the original inquiry question for a reconstructed Inbox follow-up', () => {
    expect(projectSessionPresentationTitle({
      record: record(),
      createdBy: {
        kind: 'conversation',
        caller: { kind: 'human' },
        reason: 'prior-reconstruction',
      },
      latestExecution: {
        inquiry: {
          subject: { kind: 'inbox', entryId: 'entry-1' },
          question: '  What changed after the close?  ',
          resolution: { mode: 'reconstructed' },
        },
      },
    })).toBe('What changed after the close?');
  });

  it('recovers historical headless Issue identity without guessing from prompt text', () => {
    expect(projectSessionPresentationTitle({
      record: record({ sourceRunId: 'run-legacy' }),
      latestExecution: {
        trigger: { kind: 'issue', workspaceId: 'ws-1', issueId: 'risk_watch' },
      },
      issueTitleFor: (_workspaceId, issueId) => issueId === 'risk_watch'
        ? 'Overnight risk watch'
        : undefined,
    })).toBe('Overnight risk watch');
  });

  it('does not let a later Issue turn rename an interactive-born Session', () => {
    expect(projectSessionPresentationTitle({
      record: record({ surface: 'terminal', sourceRunId: undefined, fallbackTitle: 'My thesis' }),
      createdBy: { kind: 'interactive', surface: 'quick-chat' },
      latestExecution: {
        trigger: { kind: 'issue', workspaceId: 'ws-1', issueId: 'later-run' },
      },
    })).toBe('My thesis');
  });

  it('keeps direct headless prompts because no structured business source supersedes them', () => {
    expect(projectSessionPresentationTitle({
      record: record({ fallbackTitle: 'Summarize this repository' }),
      createdBy: { kind: 'headless', surface: 'api' },
    })).toBe('Summarize this repository');
  });
});

describe('readableIssueIdentity', () => {
  it('keeps acronyms and CJK while humanizing separators', () => {
    expect(readableIssueIdentity('AAPL_每日-risk-watch')).toBe('AAPL 每日 Risk Watch');
  });
});
