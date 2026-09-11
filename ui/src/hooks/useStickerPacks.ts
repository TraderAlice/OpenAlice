import { useCallback, useEffect, useRef, useState } from 'react'
import { fetchJson, headers } from '../api/client'
export interface StickerPack { id: string; name: string; version: string; revision: string; source: 'builtin' | 'imported'; stickers: { file: string; description: string }[] }
export interface StickerWorkspace { id: string; name: string; state: { enabled: boolean; packId: string; revision: string } | null; skillPresent: boolean; changed: string[]; error?: string }
export interface StickerCatalog { packs: StickerPack[]; defaultPackId: string; workspaces: StickerWorkspace[] }
export interface StickerPreview { digest: string; revision: string; files: string[]; conflicts: { path: string; owned: boolean }[] }
const base = '/api/workspaces/stickers'
export const stickerImage = (id: string, file: string) => `${base}/packs/${encodeURIComponent(id)}/${encodeURIComponent(file)}`
export function useStickerPacks() {
  const [data, setData] = useState<StickerCatalog | null>(null)
  const [error, setError] = useState<string | null>(null)
  const [busy, setBusy] = useState(false)
  const lock = useRef(false)
  const [revision, setRevision] = useState(0)
  const refresh = useCallback(() => setRevision(n => n + 1), [])
  useEffect(() => {
    const controller = new AbortController()
    setError(null)
    void fetchJson<StickerCatalog>(base, { signal: controller.signal }).then(value => { if (!controller.signal.aborted) setData(value) }, error => { if (!controller.signal.aborted) setError(error.message) })
    return () => controller.abort()
  }, [revision])
  async function request<T>(path: string, body: unknown, method = 'POST'): Promise<T> {
    if (lock.current) throw new Error('Another sticker operation is running')
    lock.current = true; setBusy(true); setError(null)
    try {
      return await fetchJson<T>(base + path, body instanceof FormData ? { method, body } : { method, headers, body: JSON.stringify(body) })
    } catch (error) { setError((error as Error).message); throw error }
    finally { lock.current = false; setBusy(false) }
  }
  return { data, error, busy, refresh, request }
}
