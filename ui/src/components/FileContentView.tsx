/**
 * Renders the content of a single workspace file by extension.
 *
 * Shared by the Inbox detail pane and the dedicated File Viewer tab so
 * both render `.md` / `.html` / plain-text the same way, and surface the
 * same tombstone copy for the `readWorkspaceFile` error variants
 * (missing workspace / missing file / too large / …).
 *
 * HTML is a human-facing presentation asset. It uses an isolated static-report
 * iframe so page-level CSS and SVG render faithfully without joining the
 * OpenAlice document or gaining script/network privileges.
 */

import type { ReactElement } from 'react'

import { HtmlReportView } from './HtmlReportView'
import { MarkdownContent } from './MarkdownContent'
import type { ReadFileResult } from './workspace/api'

export function FileContentView({
  path,
  result,
}: {
  path: string
  result: ReadFileResult
}): ReactElement {
  if (result.kind === 'ok') return <DocBody path={path} content={result.content} />
  return <DocTombstone result={result} />
}

function DocBody({ path, content }: { path: string; content: string }): ReactElement {
  const lower = path.toLowerCase()
  if (lower.endsWith('.md') || lower.endsWith('.markdown')) {
    return <MarkdownContent text={content} />
  }
  if (lower.endsWith('.html')) {
    return <HtmlReportView path={path} content={content} />
  }
  // Plain-text fallback (.txt, .log, no extension, code files…)
  return (
    <pre className="text-[12px] text-foreground whitespace-pre-wrap font-mono leading-relaxed">
      {content}
    </pre>
  )
}

function DocTombstone({ result }: { result: ReadFileResult }): ReactElement {
  const message = (() => {
    switch (result.kind) {
      case 'workspace_missing':
        return 'Workspace no longer exists — it may have been deleted.'
      case 'file_missing':
        return 'File not found at this path — it may have been moved, renamed, or deleted in the workspace.'
      case 'too_large':
        return `File too large to render (${(result.sizeBytes / 1024).toFixed(0)} KB). Open it inside the workspace instead.`
      case 'invalid_path':
        return 'Invalid path.'
      case 'error':
        return `Could not read file: ${result.message}`
      case 'ok':
        return ''
    }
  })()
  return <div className="text-[12px] text-muted-foreground italic">{message}</div>
}
