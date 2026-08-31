import { http, HttpResponse } from 'msw'

import type { OfficeRoutineFollowUp } from '../../api/office'
import { demoInboxEntries } from '../fixtures/inbox'
import { demoIssueDetail } from '../fixtures/issues'
import { demoInboxReadAt } from './inbox'
import {
  DEMO_AUTO_PREDICTION_WORKSPACE_ID,
  DEMO_AUTO_QUANT_WORKSPACE_ID,
  DEMO_CHAT_WORKSPACE_ID,
  demoChatWorkspace,
} from '../fixtures/workspaces'

const demoRoutineFollowUps = new Map<string, OfficeRoutineFollowUp>()

function isExactIdentity(value: unknown): value is string {
  return typeof value === 'string' && value.length > 0 && value.trim() === value
}

export const officeHandlers = [
  http.get('/api/office/floor', ({ request }) => {
    const asOfRaw = new URL(request.url).searchParams.get('asOfSeq')
    const asOfSeq = asOfRaw == null ? undefined : Number.parseInt(asOfRaw, 10)
    const working = asOfSeq == null || asOfSeq >= 4
    const now = Date.now()
    return HttpResponse.json({
      config: {
        workspaceSleepAfterMs: 3 * 24 * 60 * 60 * 1000,
        harnessMinimumVisibleGroups: { chat: 1, 'auto-quant': 1, prediction: 1, other: 0 },
      },
      lastSeq: 6,
      firstSeq: 1,
      ...(asOfSeq != null ? { asOfSeq } : {}),
      offices: [
        {
          workspace: { id: DEMO_CHAT_WORKSPACE_ID, tag: 'chat', harness: 'chat' },
          lastInteractionAt: now,
          sleeping: false,
          employees: demoChatWorkspace.sessions.map((session, index) => ({
            resumeId: session.resumeId,
            agent: session.agent,
            name: session.name,
            title: session.title,
            sessionRecordId: session.id,
            mood: working && session.state === 'running' ? 'working' : 'idle',
            ...(session.surface ? { surface: session.surface } : {}),
            bubble: working && session.state === 'running'
              ? { kind: 'tool' as const, name: index === 0 ? 'workspace_list' : 'research' }
              : null,
            lastSeq: working && session.state === 'running' ? 4 : 2,
            lastInteractionAt: Date.parse(session.lastActiveAt),
            drawers: index === 0 ? [{
              id: 'prov-demo',
              kind: 'report' as const,
              action: 'created',
              at: Date.now() - 60_000,
              label: 'ai-chain-2026-06-02.md',
              path: 'rotation/ai-chain-2026-06-02.md',
            }] : [],
          })),
        },
        {
          workspace: { id: DEMO_AUTO_QUANT_WORKSPACE_ID, tag: 'auto-quant', harness: 'auto-quant' },
          lastInteractionAt: now,
          sleeping: false,
          employees: [],
        },
        {
          workspace: {
            id: DEMO_AUTO_PREDICTION_WORKSPACE_ID,
            tag: 'prediction',
            harness: 'prediction',
          },
          lastInteractionAt: now,
          sleeping: false,
          employees: [],
        },
      ],
    })
  }),
  http.get('/api/office/routine-follow-ups', () => HttpResponse.json({
    followUps: [...demoRoutineFollowUps.values()].sort((left, right) =>
      left.createdAt - right.createdAt
      || left.inboxEntryId.localeCompare(right.inboxEntryId)),
  })),
  http.put('/api/office/routine-follow-ups/:inboxEntryId', ({ params }) => {
    const inboxEntryId = String(params.inboxEntryId)
    const report = demoInboxEntries.find((entry) => entry.id === inboxEntryId)
    if (!report) {
      return HttpResponse.json({
        error: 'inbox_entry_not_found',
        message: 'The Inbox report no longer exists.',
      }, { status: 404 })
    }
    if (report.origin?.kind !== 'headless'
      || !isExactIdentity(report.origin.issueWorkspaceId)
      || !isExactIdentity(report.origin.issueId)
      || !Number.isFinite(report.ts)
      || !Number.isInteger(report.ts)
      || report.ts < 0) {
      return HttpResponse.json({
        error: 'not_a_routine_report',
        message: 'Only a server-attributed scheduled Issue report can be carried for follow-up.',
      }, { status: 422 })
    }

    const existing = demoRoutineFollowUps.get(inboxEntryId)
    if (existing) {
      const sameAuthority = existing.reportTs === report.ts
        && existing.issueWorkspaceId === report.origin.issueWorkspaceId
        && existing.issueId === report.origin.issueId
      return sameAuthority
        ? HttpResponse.json({ followUp: existing, created: false })
        : HttpResponse.json({
            error: 'routine_follow_up_conflict',
            message: `Routine follow-up authority changed for Inbox entry ${inboxEntryId}.`,
          }, { status: 409 })
    }

    if (demoInboxReadAt(inboxEntryId) !== undefined) {
      return HttpResponse.json({
        error: 'routine_report_already_reviewed',
        message: 'This Inbox report was already reviewed and cannot be carried again.',
      }, { status: 409 })
    }

    const issue = demoIssueDetail(report.origin.issueWorkspaceId, report.origin.issueId)
    if (!issue) {
      return HttpResponse.json({
        error: 'routine_issue_not_found',
        message: 'The Issue that produced this report no longer exists.',
      }, { status: 404 })
    }
    if (!issue.issue.when) {
      return HttpResponse.json({
        error: 'routine_issue_not_scheduled',
        message: 'The Issue that produced this report is not scheduled.',
      }, { status: 422 })
    }

    const followUp: OfficeRoutineFollowUp = {
      inboxEntryId,
      reportTs: report.ts,
      issueWorkspaceId: report.origin.issueWorkspaceId,
      issueId: report.origin.issueId,
      createdAt: Date.now(),
    }
    demoRoutineFollowUps.set(inboxEntryId, followUp)
    return HttpResponse.json({ followUp, created: true })
  }),
  http.delete('/api/office/routine-follow-ups/:inboxEntryId', ({ params }) => {
    const removed = demoRoutineFollowUps.delete(String(params.inboxEntryId))
    return HttpResponse.json({ ok: true, removed })
  }),
]
