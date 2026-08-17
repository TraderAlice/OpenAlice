import { http, HttpResponse } from 'msw'

import type { InquiryRecord, InquirySubject } from '../../api/inquiries'
import { demoInboxEntries } from '../fixtures/inbox'
import { demoTurnProgress } from '../fixtures/turn-progress'

const records: InquiryRecord[] = []
const timers: number[] = []

export function resetDemoInquiryState(): void {
  for (const timer of timers) window.clearTimeout(timer)
  timers.length = 0
  records.length = 0
}

function list(subject: InquirySubject) {
  return records.filter((record) => {
    const candidate = record.inquiry.subject
    if (subject.kind === 'inbox' && candidate.kind === 'inbox') return candidate.entryId === subject.entryId
    if (subject.kind === 'issue' && candidate.kind === 'issue') {
      return candidate.workspaceId === subject.workspaceId && candidate.issueId === subject.issueId
    }
    return false
  })
}

function startInquiry(
  subject: InquirySubject,
  question: string,
  context: Partial<Pick<InquiryRecord, 'workspaceId' | 'agent'>> = {},
): InquiryRecord {
  const record: InquiryRecord = {
    taskId: `demo-inquiry-${records.length + 1}`,
    resumeId: `demo-inquiry-resume-${records.length + 1}`,
    workspaceId: context.workspaceId ?? (subject.kind === 'issue' ? subject.workspaceId : 'demo-ws'),
    agent: context.agent ?? 'pi',
    status: 'running',
    startedAt: Date.now(),
    assistantText: null,
    progress: demoTurnProgress(),
    inquiry: {
      subject,
      question,
      resolution: { mode: 'exact' },
    },
  }
  timers.push(window.setTimeout(() => {
    record.status = 'done'
    record.finishedAt = Date.now()
    record.durationMs = Date.now() - record.startedAt
    record.assistantText = 'Demo reply: I checked the original Workspace context and answered from the available evidence.'
    delete record.progress
  }, 800))
  return record
}

export const inquiryHandlers = [
  http.get('/api/inquiries/inbox/:id', ({ params }) =>
    HttpResponse.json({ inquiries: list({ kind: 'inbox', entryId: String(params.id) }) }),
  ),
  http.post('/api/inquiries/inbox/:id', async ({ params, request }) => {
    const body = await request.json() as { prompt?: string }
    const entryId = String(params.id)
    const entry = demoInboxEntries.find((candidate) => candidate.id === entryId)
    const record = startInquiry(
      { kind: 'inbox', entryId },
      body.prompt ?? '',
      {
        workspaceId: entry?.workspaceId,
        agent: entry?.origin?.agent,
      },
    )
    records.unshift(record)
    return HttpResponse.json({
      status: 'dispatched', taskId: record.taskId, resumeId: record.resumeId,
      workspaceId: record.workspaceId, workspace: entry?.workspaceLabel ?? 'demo', agent: record.agent,
      resolution: record.inquiry.resolution,
    }, { status: 202 })
  }),
  http.get('/api/inquiries/issues/:wsId/:id', ({ params }) =>
    HttpResponse.json({
      inquiries: list({
        kind: 'issue', workspaceId: String(params.wsId), issueId: String(params.id), relation: 'creator',
      }),
    }),
  ),
  http.post('/api/inquiries/issues/:wsId/:id', async ({ params, request }) => {
    const body = await request.json() as { prompt?: string; relation?: 'creator' | 'owner' | 'run'; runId?: string }
    const subject: InquirySubject = {
      kind: 'issue', workspaceId: String(params.wsId), issueId: String(params.id),
      relation: body.relation ?? 'creator', ...(body.runId ? { runId: body.runId } : {}),
    }
    const record = startInquiry(subject, body.prompt ?? '')
    records.unshift(record)
    return HttpResponse.json({
      status: 'dispatched', taskId: record.taskId, resumeId: record.resumeId,
      workspaceId: record.workspaceId, workspace: 'demo', agent: record.agent,
      resolution: record.inquiry.resolution,
    }, { status: 202 })
  }),
]
