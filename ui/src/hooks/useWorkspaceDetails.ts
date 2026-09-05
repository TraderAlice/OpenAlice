import { useEffect, useState } from 'react'
import { fetchTemplateReadme, readWorkspaceFile, stripFrontmatter, type ReadFileResult } from '../components/workspace/api'
import { useWorkspaces } from '../contexts/workspaces-context'
import type { WorkspaceSource } from '../tabs/types'
import { joinWorkspaceHarnessSessions } from '../components/workspace/harness-sessions'
import { useHarnessPreferences } from './useHarnessPreferences'
import { useWorkspaceSessionDirectory } from './useWorkspaceSessionDirectory'

const templates: Record<WorkspaceSource, string> = {
  chat: 'chat', 'auto-quant': 'auto-quant-v2', prediction: 'auto-prediction',
}

/** Instance content and catalog documentation are independent, read-only resources. */
export function useWorkspaceDetails(wsId: string, source: WorkspaceSource) {
  const context = useWorkspaces()
  const workspace = context.workspaces.find(w => w.id === wsId && w.template === templates[source])
  const template = context.templates.find(t => t.name === workspace?.template)
  const [attempt, setAttempt] = useState(0)
  const [readme, setReadme] = useState<{ id: string; result: ReadFileResult } | null>(null)
  const [guide, setGuide] = useState<{ name: string; content: string | null; error: string | null } | null>(null)
  const id = workspace?.id
  const templateName = workspace?.template
  const directory = useWorkspaceSessionDirectory(id ?? null)
  const { preferences } = useHarnessPreferences()
  const sessions = workspace ? joinWorkspaceHarnessSessions(workspace, directory.directory, {
    includeHeadlessBornSessions: preferences.showHeadlessBornSessions,
    includeIssueAttachedSessions: preferences.showIssueAttachedSessions,
  }) : []

  useEffect(() => {
    let cancelled = false
    setReadme(null)
    if (id) void readWorkspaceFile(id, 'README.md').catch((error: unknown): ReadFileResult => ({
      kind: 'error', message: error instanceof Error ? error.message : String(error),
    })).then(result => {
      if (!cancelled) setReadme({ id, result: result.kind === 'ok'
        ? { ...result, content: stripFrontmatter(result.content) } : result })
    })
    return () => { cancelled = true }
  }, [id, attempt])

  useEffect(() => {
    let cancelled = false
    setGuide(null)
    if (templateName) void fetchTemplateReadme(templateName).then(content => {
      if (!cancelled) setGuide({ name: templateName, content, error: null })
    }).catch((error: unknown) => {
      if (!cancelled) setGuide({ name: templateName, content: null, error: error instanceof Error ? error.message : String(error) })
    })
    return () => { cancelled = true }
  }, [templateName, attempt])

  return {
    workspace, template,
    sessionCount: directory.loading || directory.error ? null : sessions.length,
    loading: !context.hasLoaded && !context.listError,
    error: context.listError,
    refresh: context.refresh,
    readme: readme?.id === id ? readme?.result ?? null : null,
    guide: guide?.name === templateName ? guide : null,
    retryDocuments: () => setAttempt(n => n + 1),
  }
}
