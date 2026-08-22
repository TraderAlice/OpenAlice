import { describe, expect, it } from 'vitest'

import type { SessionCreatedBy, SessionRecord, WorkspaceSessionDirectoryEntry } from './api'
import {
  composeHarnessSessionSubtitle,
  harnessSessionRosterSubtitle,
  harnessSessionSourceLabel,
  projectHarnessSessionPresentation,
  readableIssueIdentity,
  shortResumeId,
} from './harness-session-presentation'

const ISSUE_PROMPT = [
  '# Daily market close',
  '',
  'You are the close-desk analyst. Review the following and write a brief:',
  '',
  '1. Semiconductors and rates',
  '2. Overnight futures',
  '3. Any open risk from yesterday',
  '',
  'Use the Workspace files. Do not invent fills.',
].join('\n')

const LONG_ENGLISH_ISSUE_ID = 'daily-us-equity-and-rates-cross-asset-morning-scan-with-extended-checklist'
const LONG_CJK_ISSUE_ID = '每日-美股-利率-跨资产-早盘扫描-附详细检查清单'

function session(overrides: Partial<SessionRecord> = {}): SessionRecord {
  return {
    id: 'session-1',
    resumeId: 'resume-interactive',
    wsId: 'ws-1',
    agent: 'pi',
    name: 'p1',
    createdAt: '2026-08-01T00:00:00.000Z',
    lastActiveAt: '2026-08-01T01:00:00.000Z',
    state: 'paused',
    pid: null,
    startedAt: null,
    title: 'Interactive thesis',
    ...overrides,
  }
}

function issueBirth(issueId = 'daily-market-close'): SessionCreatedBy {
  return {
    kind: 'issue',
    workspaceId: 'ws-1',
    issueId,
    policy: 'new-then-resume',
    fire: 'schedule',
  }
}

function entry(overrides: Partial<WorkspaceSessionDirectoryEntry> = {}): WorkspaceSessionDirectoryEntry {
  return {
    resumeId: 'resume-interactive',
    agent: 'pi',
    createdAt: Date.parse('2026-08-01T00:00:00.000Z'),
    updatedAt: Date.parse('2026-08-01T01:00:00.000Z'),
    lifecycle: 'active',
    resumable: true,
    active: false,
    ...overrides,
  }
}

const sourceCopy = {
  'workspace.sessionSource.issue': 'Issue',
  'workspace.sessionSource.headless': 'Background',
  'workspace.sessionSource.conversation': 'Conversation',
} as const

function t(key: keyof typeof sourceCopy): string {
  return sourceCopy[key]
}

describe('readableIssueIdentity', () => {
  it('humanizes kebab and snake Issue ids without fetching board titles', () => {
    expect(readableIssueIdentity('daily-market-close')).toBe('Daily Market Close')
    expect(readableIssueIdentity('scan_open')).toBe('Scan Open')
    expect(readableIssueIdentity('AAPL-daily-scan')).toBe('AAPL Daily Scan')
  })

  it('keeps CJK and mixed ids readable', () => {
    expect(readableIssueIdentity('市场扫描')).toBe('市场扫描')
    expect(readableIssueIdentity(LONG_CJK_ISSUE_ID)).toBe('每日 美股 利率 跨资产 早盘扫描 附详细检查清单')
    expect(readableIssueIdentity('市场-scan-日报')).toBe('市场 Scan 日报')
  })

  it('does not truncate long English or CJK identities', () => {
    expect(readableIssueIdentity(LONG_ENGLISH_ISSUE_ID)).toBe(
      'Daily Us Equity And Rates Cross Asset Morning Scan With Extended Checklist',
    )
    expect(readableIssueIdentity(LONG_CJK_ISSUE_ID).includes('…')).toBe(false)
    expect(readableIssueIdentity(LONG_CJK_ISSUE_ID)).toContain('早盘扫描')
  })
})

describe('projectHarnessSessionPresentation', () => {
  it('keeps an explicit coworker nametag strongest, including on Issue-born rows', () => {
    expect(projectHarnessSessionPresentation(
      session({ displayName: 'AAPL desk', title: ISSUE_PROMPT }),
      entry({ createdBy: issueBirth(), displayName: 'Ignored directory name' }),
    )).toEqual({
      title: 'AAPL desk',
      sourceKind: 'issue',
      issueId: 'daily-market-close',
    })
    expect(projectHarnessSessionPresentation(
      null,
      entry({ displayName: 'AAPL desk', createdBy: issueBirth() }),
    ).title).toBe('AAPL desk')
  })

  it('uses the Issue identity instead of a launch prompt for Issue-born Sessions', () => {
    expect(projectHarnessSessionPresentation(
      session({
        resumeId: 'resume-issue',
        title: ISSUE_PROMPT,
        surface: 'headless',
      }),
      entry({
        resumeId: 'resume-issue',
        createdBy: issueBirth(),
        interactive: {
          name: 'x1',
          title: ISSUE_PROMPT,
          state: 'paused',
          lastActiveAt: '2026-08-01T01:00:00.000Z',
        },
        latestExecution: {
          taskId: 'task-1',
          status: 'done',
          startedAt: 1,
          assistantPreview: 'Close scan finished. Semis still lead.',
          issueId: 'daily-market-close',
        },
      }),
    )).toEqual({
      title: 'Daily Market Close',
      sourceKind: 'issue',
      issueId: 'daily-market-close',
    })
  })

  it('prefers birth issueId over a later execution id', () => {
    expect(projectHarnessSessionPresentation(
      session({ title: ISSUE_PROMPT }),
      entry({
        createdBy: issueBirth('open-risk-review'),
        latestExecution: {
          taskId: 'task-2',
          status: 'done',
          startedAt: 1,
          issueId: 'unrelated-later-run',
        },
      }),
    )).toMatchObject({
      title: 'Open Risk Review',
      issueId: 'open-risk-review',
    })
  })

  it('retains the best interactive title and omits source context', () => {
    expect(projectHarnessSessionPresentation(
      session(),
      entry({
        createdBy: { kind: 'interactive', surface: 'quick-chat' },
        interactive: {
          name: 'p1',
          title: 'Interactive thesis',
          state: 'paused',
          lastActiveAt: '2026-08-01T01:00:00.000Z',
        },
      }),
    )).toEqual({ title: 'Interactive thesis' })
  })

  it('keeps headless and conversation titles and marks restrained source context', () => {
    expect(projectHarnessSessionPresentation(
      session({ title: null, name: 'x1', surface: 'headless' }),
      entry({
        createdBy: { kind: 'headless', surface: 'api' },
        latestExecution: {
          taskId: 'task-1',
          status: 'done',
          startedAt: 1,
          assistantPreview: 'Morning scan complete. Semis still lead.',
        },
      }),
    )).toEqual({
      title: 'Morning scan complete. Semis still lead.',
      sourceKind: 'headless',
    })

    expect(projectHarnessSessionPresentation(
      session({ title: 'Why did yesterday\'s report change?' }),
      entry({
        createdBy: {
          kind: 'conversation',
          caller: { kind: 'human' },
          reason: 'issue-comment',
        },
      }),
    )).toEqual({
      title: 'Why did yesterday\'s report change?',
      sourceKind: 'conversation',
    })
  })

  it('uses a conversation Issue subject instead of its reconstruction prompt', () => {
    expect(projectHarnessSessionPresentation(
      session({
        title: 'You are a fresh worker reconstructing a follow-up, not the original author.',
        surface: 'headless',
      }),
      entry({
        createdBy: {
          kind: 'conversation',
          caller: { kind: 'human' },
          reason: 'issue-comment',
          subject: {
            kind: 'issue',
            workspaceId: 'ws-1',
            issueId: 'telegram-phone-desk',
            relation: 'creator',
            commentId: 'comment-1',
          },
        },
      }),
    )).toEqual({
      title: 'Telegram Phone Desk',
      sourceKind: 'conversation',
      issueId: 'telegram-phone-desk',
    })
  })

  it('uses execution provenance for legacy headless Issue rows only', () => {
    const legacyExecution = entry({
      latestExecution: {
        taskId: 'task-legacy',
        status: 'done',
        startedAt: 1,
        issueId: 'metals-position-watch',
      },
    })
    expect(projectHarnessSessionPresentation(
      session({ title: ISSUE_PROMPT, surface: 'headless' }),
      legacyExecution,
    )).toEqual({
      title: 'Metals Position Watch',
      sourceKind: 'issue',
      issueId: 'metals-position-watch',
    })
    expect(projectHarnessSessionPresentation(
      session({ title: 'Normal interactive title', surface: 'terminal' }),
      legacyExecution,
    )).toEqual({
      title: 'Normal interactive title',
      issueId: 'metals-position-watch',
    })
  })

  it('falls back through preview, execution Issue id, name, then a short resume id', () => {
    expect(projectHarnessSessionPresentation(null, entry({
      latestExecution: {
        taskId: 'task-1',
        status: 'done',
        startedAt: 1,
        assistantPreview: 'Morning scan complete. Semis still lead.',
      },
    })).title).toBe('Morning scan complete. Semis still lead.')

    expect(projectHarnessSessionPresentation(null, entry({
      latestExecution: { taskId: 'task-1', status: 'done', startedAt: 1, issueId: 'scan-open' },
    }))).toEqual({
      title: 'Scan Open',
      sourceKind: 'issue',
      issueId: 'scan-open',
    })

    expect(projectHarnessSessionPresentation(session({ title: null }), null).title).toBe('p1')
    expect(projectHarnessSessionPresentation(null, entry({
      resumeId: 'resume-calm-amber-river-a1b2c3',
    })).title).toBe(shortResumeId('resume-calm-amber-river-a1b2c3'))
  })

  it('does not infer Issue identity for an interactive Session when birth metadata is missing', () => {
    expect(projectHarnessSessionPresentation(
      session({ title: ISSUE_PROMPT, surface: 'terminal' }),
      entry({
        latestExecution: {
          taskId: 'task-1',
          status: 'done',
          startedAt: 1,
          issueId: 'daily-market-close',
        },
      }),
    )).toEqual({
      title: ISSUE_PROMPT,
      issueId: 'daily-market-close',
    })
  })

  it('keeps long English and CJK interactive titles intact for CSS ellipsis', () => {
    const english = 'Review the overnight cross-asset tape and summarize every open risk before the cash open'
    const cjk = '请在开盘前复查隔夜跨资产波动并整理所有未平仓风险'
    expect(projectHarnessSessionPresentation(session({ title: english }), null).title).toBe(english)
    expect(projectHarnessSessionPresentation(session({ title: cjk }), null).title).toBe(cjk)
    expect(projectHarnessSessionPresentation(
      session({ title: ISSUE_PROMPT }),
      entry({ createdBy: issueBirth(LONG_CJK_ISSUE_ID) }),
    ).title).toBe(readableIssueIdentity(LONG_CJK_ISSUE_ID))
  })
})

describe('harness session subtitle composition', () => {
  it('renders one quiet source or Workspace line without grouping labels', () => {
    expect(harnessSessionSourceLabel('issue', t)).toBe('Issue')
    expect(harnessSessionRosterSubtitle('issue', t)).toBe('Issue')
    expect(harnessSessionRosterSubtitle(undefined, t, 'chat-aug3')).toBe('chat-aug3')
    expect(harnessSessionRosterSubtitle('issue', t, 'chat-aug3')).toBe('Issue · chat-aug3')
    expect(harnessSessionRosterSubtitle('issue', t, 'Issue')).toBe('Issue')
    expect(composeHarnessSessionSubtitle(undefined, '  ', undefined)).toBeUndefined()
    expect(harnessSessionRosterSubtitle(undefined, t)).toBeUndefined()
  })
})
