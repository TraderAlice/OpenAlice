import { http, HttpResponse } from 'msw'

import type { InquiryRecord, InquirySubject } from '../../api/inquiries'

const records: InquiryRecord[] = []

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

function completed(subject: InquirySubject, question: string): InquiryRecord {
  return {
    taskId: `demo-inquiry-${records.length + 1}`,
    resumeId: `demo-inquiry-resume-${records.length + 1}`,
    workspaceId: subject.kind === 'issue' ? subject.workspaceId : 'demo-ws',
    agent: 'pi',
    status: 'done',
    startedAt: Date.now(),
    finishedAt: Date.now(),
    durationMs: 1200,
    assistantText: 'Demo reply: I checked the original Workspace context and answered from the available evidence.',
    inquiry: {
      subject,
      question,
      resolution: { mode: 'exact' },
    },
  }
}

export const inquiryHandlers = [
  http.get('/api/inquiries/inbox/:id', ({ params }) =>
    HttpResponse.json({ inquiries: list({ kind: 'inbox', entryId: String(params.id) }) }),
  ),
  http.post('/api/inquiries/inbox/:id', async ({ params, request }) => {
    const body = await request.json() as { prompt?: string }
    const record = completed({ kind: 'inbox', entryId: String(params.id) }, body.prompt ?? '')
    records.unshift(record)
    return HttpResponse.json({
      status: 'dispatched', taskId: record.taskId, resumeId: record.resumeId,
      workspaceId: record.workspaceId, workspace: 'demo', agent: record.agent,
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
    const record = completed(subject, body.prompt ?? '')
    records.unshift(record)
    return HttpResponse.json({
      status: 'dispatched', taskId: record.taskId, resumeId: record.resumeId,
      workspaceId: record.workspaceId, workspace: 'demo', agent: record.agent,
      resolution: record.inquiry.resolution,
    }, { status: 202 })
  }),
]
