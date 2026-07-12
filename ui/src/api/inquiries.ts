import { fetchJson, headers } from './client'
import type { HeadlessTaskStatus } from './headless'

export type InquirySubject =
  | { kind: 'inbox'; entryId: string }
  | {
      kind: 'issue'
      workspaceId: string
      issueId: string
      relation: 'creator' | 'owner' | 'run'
      runId?: string
    }

export interface InquiryRecord {
  taskId: string
  resumeId: string
  workspaceId: string
  agent: string
  status: HeadlessTaskStatus
  startedAt: number
  finishedAt?: number
  durationMs?: number
  error?: string
  assistantText: string | null
  inquiry: {
    subject: InquirySubject
    question: string
    resolution: { mode: 'exact' | 'reconstructed'; reason?: string }
  }
}

export interface InquiryDispatch {
  status: 'dispatched'
  taskId: string
  resumeId: string
  workspaceId: string
  workspace: string
  agent: string
  resolution: { mode: 'exact' | 'reconstructed'; reason?: string }
}

export const inquiriesApi = {
  async forInbox(entryId: string): Promise<InquiryRecord[]> {
    return (await fetchJson<{ inquiries: InquiryRecord[] }>(
      `/api/inquiries/inbox/${encodeURIComponent(entryId)}`,
    )).inquiries
  },

  async askInbox(entryId: string, prompt: string): Promise<InquiryDispatch> {
    return fetchJson(`/api/inquiries/inbox/${encodeURIComponent(entryId)}`, {
      method: 'POST', headers, body: JSON.stringify({ prompt }),
    })
  },

  async forIssue(workspaceId: string, issueId: string): Promise<InquiryRecord[]> {
    return (await fetchJson<{ inquiries: InquiryRecord[] }>(
      `/api/inquiries/issues/${encodeURIComponent(workspaceId)}/${encodeURIComponent(issueId)}`,
    )).inquiries
  },

  async askIssue(
    workspaceId: string,
    issueId: string,
    input: { prompt: string; relation: 'creator' | 'owner' | 'run'; runId?: string },
  ): Promise<InquiryDispatch> {
    return fetchJson(
      `/api/inquiries/issues/${encodeURIComponent(workspaceId)}/${encodeURIComponent(issueId)}`,
      { method: 'POST', headers, body: JSON.stringify(input) },
    )
  },
}
