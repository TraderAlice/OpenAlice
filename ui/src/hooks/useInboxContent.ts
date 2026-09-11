import { useCallback, useEffect, useMemo, useState } from 'react'
import { inboxFiles } from '@traderalice/connector-protocol'
import type { ReadFileResult } from '../components/workspace/api'
import { inboxApi, type InboxEntry, type InboxFile } from '../api/inbox'

/** One source-Workspace-aware projection for Inbox readers; no file bytes are prefetched. */
export function useInboxContent(entry: InboxEntry, { resolveFiles = true } = {}) {
  const files = useMemo(() => inboxFiles(entry), [entry.body, entry.fileRevisions])
  const key = `${entry.id}:${entry.workspaceId}:${entry.body}`
  const [state, setState] = useState<{ key: string; files: InboxFile[]; error?: string } | null>(null)
  const [selected, selectFile] = useState<{ key: string; path: string } | null>(null)
  const [preview, setPreview] = useState<{ key: string; path: string; result: ReadFileResult } | null>(null)
  const [attempt, setAttempt] = useState(0)
  const retry = useCallback(() => setAttempt(value => value + 1), [])
  useEffect(() => {
    if (!resolveFiles || !files.length) return
    let cancelled = false
    setState(null)
    inboxApi.files(entry.id).then(
      result => { if (!cancelled) setState({ key, files: result.files }) },
      error => { if (!cancelled) setState({ key, files: [], error: String(error) }) },
    )
    return () => { cancelled = true }
  }, [entry.id, key, files, resolveFiles, attempt])
  const current = state?.key === key ? state : null
  const resolvedFiles = current?.files ?? []
  const fileHrefs = useMemo(() => Object.fromEntries(resolvedFiles.filter(file => file.available).map(file => [file.path, file.href])), [resolvedFiles])
  const selectedFile = selected?.key === key ? resolvedFiles.find(file => file.path === selected.path) : undefined
  useEffect(() => {
    if (!selectedFile || !/\.(md|markdown|html?|txt|json|csv|log)$/i.test(selectedFile.path)) return
    let cancelled = false
    setPreview(null)
    fetch(selectedFile.href).then(async response => {
      const result: ReadFileResult = response.ok ? { kind: 'ok', content: await response.text() }
        : response.status === 404 ? { kind: 'file_missing' } : { kind: 'error', message: `HTTP ${response.status}` }
      if (!cancelled) setPreview({ key, path: selectedFile.path, result })
    }).catch(error => { if (!cancelled) setPreview({ key, path: selectedFile.path, result: { kind: 'error', message: String(error) } }) })
    return () => { cancelled = true }
  }, [key, selectedFile])
  const openFile = useCallback((path: string) => selectFile({ key, path }), [key])
  const closeFile = useCallback(() => selectFile(null), [])
  return { selectedFile, openFile, closeFile,
    preview: preview?.key === key && preview.path === selectedFile?.path ? preview.result : null,
    body: entry.body, files, resolvedFiles, fileHrefs,
    loading: resolveFiles && files.length > 0 && current === null,
    error: current?.error, retry }
}
