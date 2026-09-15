import { workspaceContentHref } from '../components/workspace/api'
import { useCallback, useEffect, useMemo, useRef, useState } from 'react'
import { parseContentReferences, parseMarketReference } from '@traderalice/connector-protocol'
import type { ConversationItem } from '../components/conversation/types'

const isImage = (path: string) => /\.(png|jpe?g|webp|gif)$/i.test(path)

export function conversationReferences(items: readonly ConversationItem[]) {
  return items.flatMap(item => item.kind === 'assistant-turn'
    ? [...item.progress, item.final ?? ''].flatMap(text => parseContentReferences(text).references.map(ref => ({
      path: ref.path, key: JSON.stringify([item.key, ref.path]),
    }))) : [])
}

/** One mounted Session. Presentation consumes prose; no runtime protocol semantics. */
export function useConversationFiles(wsId: string, items: readonly ConversationItem[], ready: boolean, open: (path: string) => void) {
  const references = useMemo(() => conversationReferences(items), [items])
  const signature = JSON.stringify(references)
  const [imagePreview, setImagePreview] = useState<{ path: string; href: string } | null>(null)
  const closeImage = useCallback(() => setImagePreview(null), [])
  const baseline = useRef(false)
  const consumed = useRef(new Set<string>())
  const [fileHrefs, setFileHrefs] = useState<Record<string, string>>({})
  useEffect(() => {
    if (!ready) return
    const refs = JSON.parse(signature) as ReturnType<typeof conversationReferences>
    if (!baseline.current) {
      refs.forEach(ref => consumed.current.add(ref.key))
      baseline.current = true
    }
    let cancelled = false
    let timer: ReturnType<typeof setTimeout> | undefined
    const controller = new AbortController()
    let attempts = 0
    async function resolve() {
      const paths = [...new Set(refs.map(ref => ref.path))]
      const available = await Promise.all(paths.map(async path => {
        const market = parseMarketReference(path)
        // A valid market reference is a view request, not a Workspace file.
        // The chart hook owns loading/errors and retries on the selected source.
        if (market) return [path, `#${encodeURIComponent(path)}`] as const
        const href = workspaceContentHref(wsId, path)
        try {
          const response = await fetch(`${href}&metadata=1`, { signal: controller.signal })
          if (!response.ok) return null
          const metadata = await response.json() as { path?: string }
          return metadata.path === path ? [path, href] as const : null
        } catch { return null }
      }))
      if (cancelled) return
      const hrefs = Object.fromEntries(available.filter(entry => entry !== null))
      setFileHrefs(hrefs)
      for (const ref of refs) {
        if (!hrefs[ref.path] || consumed.current.has(ref.key)) continue
        consumed.current.add(ref.key)
        if (!isImage(ref.path) && !ref.path.startsWith('sticker/')) open(ref.path)
      }
      // A reference can precede its tool's file write. Retry without a render loop.
      if (available.some(entry => entry === null) && ++attempts < 30) timer = setTimeout(() => void resolve(), 2000)
    }
    void resolve()
    return () => { cancelled = true; controller.abort(); clearTimeout(timer) }
  }, [wsId, signature, ready, open])
  const onFileReference = useCallback((path: string) => {
    if (isImage(path)) {
      if (fileHrefs[path]) setImagePreview({ path, href: fileHrefs[path] })
    } else open(path)
  }, [fileHrefs, open])
  return { fileHrefs, onFileReference, imagePreview, closeImage }
}
