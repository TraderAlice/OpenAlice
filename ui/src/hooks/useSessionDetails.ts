import { useCallback, useEffect, useState } from 'react'
import { getWorkspaceSessionDirectory, type WorkspaceSessionDirectoryEntry } from '../components/workspace/api'
import { issuesApi, type IssueSnapshot } from '../api/issues'

export interface SessionExecutionDetail {
  executionId: string
  phase: string
  surface: string
  requestedAt: number
  startedAt?: number
  finishedAt?: number
  activity?: string
  reason?: string
  pid?: number
  origin: { kind: string; entry: string; issueId?: string; workspaceId?: string }
  configuration: { credentialSource: string; credentialSlug?: string; model?: string; effort?: string }
}

export function useSessionDetails(workspaceId: string, recordId: string, resumeId: string) {
  const [revision, setRevision] = useState(0)
  const [state, setState] = useState<{
    loading: boolean; errors: string[]; entry: WorkspaceSessionDirectoryEntry | null;
    executions: SessionExecutionDetail[]; issues: IssueSnapshot | null
  }>({ loading: true, errors: [], entry: null, executions: [], issues: null })
  const refresh = useCallback(() => setRevision(value => value + 1), [])
  useEffect(() => {
    let live = true
    setState({ loading: true, errors: [], entry: null, executions: [], issues: null })
    const executions = fetch(`/api/workspaces/${encodeURIComponent(workspaceId)}/sessions/${encodeURIComponent(recordId)}/executions`)
      .then(async response => {
        if (!response.ok) throw new Error(`Execution history (${response.status})`)
        return await response.json() as { executions: SessionExecutionDetail[] }
      })
    void Promise.allSettled([getWorkspaceSessionDirectory(workspaceId, resumeId), executions, issuesApi.get()]).then(([directory, runs, issues]) => {
      if (!live) return
      setState({ loading: false,
        errors: [directory, runs, issues].flatMap(result => result.status === 'rejected' ? [String(result.reason)] : []),
        entry: directory.status === 'fulfilled' ? directory.value.sessions.find(row => row.resumeId === resumeId) ?? null : null,
        executions: runs.status === 'fulfilled' ? [...runs.value.executions].sort((a, b) => b.requestedAt - a.requestedAt) : [],
        issues: issues.status === 'fulfilled' ? issues.value : null,
      })
    })
    return () => { live = false }
  }, [workspaceId, recordId, resumeId, revision])
  return { ...state, refresh }
}
