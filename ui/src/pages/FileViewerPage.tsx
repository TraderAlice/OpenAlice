/**
 * Dedicated file viewer tab — the "open a file" surface, modelled on
 * VS Code's editor. Opened from the Tracked backlink list and the
 * workspace Files panel; renders one workspace file read-only.
 *
 * Markdown (`[[name]]` wikilinks included) uses MarkdownContent; static HTML
 * uses the isolated report renderer; everything else falls back to monospace
 * plain text. Rendering + tombstones are shared with the Inbox doc pane via
 * FileContentView.
 */

import { useEffect, useState } from 'react'
import { ArrowLeft, FileText } from 'lucide-react'

import { FileContentView } from '../components/FileContentView'
import { CenteredLoading } from '../components/StateViews'
import { useWorkspaces } from '../contexts/workspaces-context'
import { readWorkspaceFile, type ReadFileResult } from '../components/workspace/api'
import { useWorkspace } from '../tabs/store'
import type { ViewSpec } from '../tabs/types'

interface Props {
  spec: Extract<ViewSpec, { kind: 'file-viewer' }>
}

export function FileViewerPage({ spec }: Props) {
  const { wsId, path } = spec.params
  const { workspaces } = useWorkspaces()
  const openOrFocus = useWorkspace((s) => s.openOrFocus)
  const setSidebar = useWorkspace((s) => s.setSidebar)
  const tag = workspaces.find((w) => w.id === wsId)?.tag ?? wsId.slice(0, 8)

  const [result, setResult] = useState<ReadFileResult | null>(null)
  useEffect(() => {
    let cancelled = false
    setResult(null)
    readWorkspaceFile(wsId, path).then((r) => {
      if (!cancelled) setResult(r)
    })
    return () => {
      cancelled = true
    }
  }, [wsId, path])

  const openWorkspace = () => {
    setSidebar('workspaces')
    openOrFocus({ kind: 'workspace', params: { wsId } })
  }

  return (
    <div className="h-full flex flex-col min-h-0">
      <div className="flex items-center gap-2 px-4 py-2 border-b border-border bg-bg-secondary/30 shrink-0">
        <button
          type="button"
          onClick={openWorkspace}
          className="inline-flex h-7 shrink-0 items-center gap-1.5 rounded-md border border-border bg-bg px-2 text-[12px] font-medium text-text-muted transition-colors hover:bg-bg-tertiary hover:text-text"
          title={`Back to ${tag}`}
        >
          <ArrowLeft size={14} strokeWidth={1.8} aria-hidden />
          <span className="hidden sm:inline">Back</span>
        </button>
        <FileText size={13} strokeWidth={1.75} className="shrink-0 text-text-muted/70" aria-hidden />
        <span className="font-mono text-[12px] text-text truncate" title={path}>
          {path}
        </span>
        <span className="ml-auto shrink-0 text-[11px] text-text-muted/60">{tag}</span>
      </div>
      <div className="flex-1 overflow-y-auto min-h-0">
        <div className="max-w-[820px] mx-auto px-6 py-6">
          {result === null ? (
            <CenteredLoading />
          ) : (
            <FileContentView path={path} result={result} />
          )}
        </div>
      </div>
    </div>
  )
}
