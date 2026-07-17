import { http, HttpResponse } from 'msw'

import type { InquiryRecord, InquirySubject } from '../../api/inquiries'

const records: InquiryRecord[] = []
const auditFixture = (request: Request): string | null => request.headers.get('x-openalice-theme-audit-fixture')

const auditInquiryRecords: InquiryRecord[] = [
  {
    taskId: 'audit-inquiry-failed', resumeId: 'audit-inquiry-failed-resume', workspaceId: 'demo-ws-auto-quant',
    agent: 'codex', status: 'failed', startedAt: Date.now() - 20_000, finishedAt: Date.now() - 10_000,
    assistantText: null, error: 'Audit inquiry failed without a final reply',
    inquiry: { subject: { kind: 'issue', workspaceId: 'demo-ws-auto-quant', issueId: 'morning-scan', relation: 'creator' }, question: 'Why did this fail?', resolution: { mode: 'exact' } },
  },
  {
    taskId: 'audit-inquiry-reconstructed', resumeId: 'audit-inquiry-reconstructed-resume', workspaceId: 'demo-ws-auto-quant',
    agent: 'pi', status: 'done', startedAt: Date.now() - 40_000, finishedAt: Date.now() - 30_000,
    assistantText: 'Reconstructed audit response.',
    inquiry: { subject: { kind: 'issue', workspaceId: 'demo-ws-auto-quant', issueId: 'morning-scan', relation: 'owner' }, question: 'Reconstruct context', resolution: { mode: 'reconstructed' } },
  },
]

const auditInboxInquiryRecords: InquiryRecord[] = [
  {
    taskId: 'audit-inbox-reconstructed', resumeId: 'audit-inbox-reconstructed-resume', workspaceId: 'demo-ws',
    agent: 'pi', status: 'done', startedAt: Date.now() - 40_000, finishedAt: Date.now() - 30_000,
    assistantText: 'Reconstructed audit response.',
    inquiry: { subject: { kind: 'inbox', entryId: 'demo-inbox-aapl-q1' }, question: 'Reconstruct the source context', resolution: { mode: 'reconstructed' } },
  },
]

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
  http.get('/api/inquiries/inbox/:id', ({ params, request }) => {
    const fixture = auditFixture(request)
    return HttpResponse.json({
      inquiries: list({ kind: 'inbox', entryId: String(params.id) })
        .concat(fixture === 'inbox-reply-reconstructed' ? auditInboxInquiryRecords : []),
    })
  }),
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
  http.get('/api/inquiries/issues/:wsId/:id', ({ params, request }) => {
    const fixture = auditFixture(request)
    if (fixture === 'inquiry-error') return HttpResponse.json({ error: 'audit_inquiry_failure' }, { status: 500 })
    return HttpResponse.json({
      inquiries: list({
        kind: 'issue', workspaceId: String(params.wsId), issueId: String(params.id), relation: 'creator',
      }).concat(fixture === 'inquiry-variants' ? auditInquiryRecords : []),
    })
  }),
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
