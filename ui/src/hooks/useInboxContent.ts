import { useCallback, useEffect, useMemo, useState } from 'react'
import { inboxFiles } from '@traderalice/connector-protocol'
import type { ReadFileResult } from '../components/workspace/api'
import type { InboxEntry, InboxFile } from '../api/inbox'
import { resourceCache } from '../lib/resource-cache'
import {
  fetchInboxFilePreviewCached,
  fetchInboxFilesCached,
  inboxFilePreviewCacheKey,
  inboxFilesCacheKey,
  isPreviewableTextFile,
} from '../live/inbox-cache'

/**
 * One source-Workspace-aware projection for Inbox readers, backed by the
 * shared pure-memory SWR `resourceCache`. Warmed or revisited entries render
 * files and text previews instantaneously without resetting to a loading flash.
 */
export function useInboxContent(entry: InboxEntry, { resolveFiles = true } = {}) {
  const files = useMemo(() => inboxFiles(entry), [entry.body, entry.fileRevisions])
  const key = `${entry.id}:${entry.workspaceId}:${entry.body}`
  const filesCacheKey = inboxFilesCacheKey(entry.id)

  const [state, setState] = useState<{ key: string; files: InboxFile[]; error?: string } | null>(() => {
    if (!resolveFiles || !files.length) return null
    const cached = resourceCache.peek<InboxFile[]>(filesCacheKey)
    return cached ? { key, files: cached } : null
  })
  const [selected, selectFile] = useState<{ key: string; path: string } | null>(null)
  const [preview, setPreview] = useState<{ key: string; path: string; result: ReadFileResult } | null>(null)
  const [attempt, setAttempt] = useState(0)
  const retry = useCallback(() => {
    resourceCache.invalidate(filesCacheKey)
    setAttempt(value => value + 1)
  }, [filesCacheKey])

  useEffect(() => {
    if (!resolveFiles || !files.length) return
    let cancelled = false
    const cached = resourceCache.get<InboxFile[]>(filesCacheKey)
    if (cached) {
      setState({ key, files: cached.data })
      if (!cached.stale && attempt === 0) return
    } else {
      setState(null)
    }
    fetchInboxFilesCached(entry.id, { priority: 'high', force: attempt > 0 }).then(
      resolved => { if (!cancelled) setState({ key, files: resolved }) },
      error => {
        if (!cancelled) {
          setState(prev => (prev?.key === key && prev.files.length > 0 ? prev : { key, files: [], error: String(error) }))
        }
      },
    )
    return () => { cancelled = true }
  }, [entry.id, key, filesCacheKey, files, resolveFiles, attempt])

  const current = state?.key === key ? state : null
  const resolvedFiles = current?.files ?? []
  const fileHrefs = useMemo(
    () => Object.fromEntries(resolvedFiles.filter(file => file.available).map(file => [file.path, file.href])),
    [resolvedFiles],
  )
  const selectedFile = selected?.key === key ? resolvedFiles.find(file => file.path === selected.path) : undefined

  useEffect(() => {
    if (!selectedFile || !isPreviewableTextFile(selectedFile.path)) return
    let cancelled = false
    const previewKey = inboxFilePreviewCacheKey(selectedFile.href)
    const cached = resourceCache.get<ReadFileResult>(previewKey)
    if (cached) {
      setPreview({ key, path: selectedFile.path, result: cached.data })
      if (!cached.stale) return
    } else {
      setPreview(null)
    }
    fetchInboxFilePreviewCached(selectedFile.href, { priority: 'high' }).then(
      result => { if (!cancelled) setPreview({ key, path: selectedFile.path, result }) },
      error => {
        if (!cancelled) {
          setPreview(prev => (
            prev?.key === key && prev.path === selectedFile.path
              ? prev
              : { key, path: selectedFile.path, result: { kind: 'error', message: String(error) } }
          ))
        }
      },
    )
    return () => { cancelled = true }
  }, [key, selectedFile])

  const openFile = useCallback((path: string) => selectFile({ key, path }), [key])
  const closeFile = useCallback(() => selectFile(null), [])

  const cachedPreview = selectedFile && isPreviewableTextFile(selectedFile.path)
    ? resourceCache.peek<ReadFileResult>(inboxFilePreviewCacheKey(selectedFile.href))
    : undefined

  return {
    selectedFile,
    openFile,
    closeFile,
    preview: preview?.key === key && preview.path === selectedFile?.path
      ? preview.result
      : cachedPreview ?? null,
    body: entry.body,
    files,
    resolvedFiles,
    fileHrefs,
    loading: resolveFiles && files.length > 0 && current === null,
    error: current?.error,
    retry,
  }
}
