import { useState, useRef, useCallback, useEffect } from 'react'

export type SaveStatus = 'idle' | 'saving' | 'saved' | 'error'

interface UseAutoSaveOptions<T> {
  data: T
  save: (data: T) => Promise<void>
  delay?: number
  enabled?: boolean
  /**
   * Skip the first enabled save cycle. This is useful for forms that become
   * enabled after their initial data loads. Dirty-gated editors should set
   * this to false so their first user edit is not mistaken for hydration.
   */
  skipInitialSave?: boolean
}

export function useAutoSave<T>({
  data,
  save,
  delay = 600,
  enabled = true,
  skipInitialSave = true,
}: UseAutoSaveOptions<T>): { status: SaveStatus; flush: () => void; retry: () => void } {
  const [status, setStatus] = useState<SaveStatus>('idle')
  const timerRef = useRef<ReturnType<typeof setTimeout> | null>(null)
  const savedTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null)
  const latestDataRef = useRef<T>(data)
  const saveRef = useRef(save)
  const inflightRef = useRef(false)
  const initialRef = useRef(true)
  const pendingRef = useRef(false)

  latestDataRef.current = data
  saveRef.current = save

  const doSave = useCallback(async () => {
    if (inflightRef.current) {
      pendingRef.current = true
      return
    }
    inflightRef.current = true
    setStatus('saving')
    try {
      await saveRef.current(latestDataRef.current)
      setStatus('saved')
      if (savedTimerRef.current) clearTimeout(savedTimerRef.current)
      savedTimerRef.current = setTimeout(() => setStatus('idle'), 2000)
      if (pendingRef.current) {
        pendingRef.current = false
        inflightRef.current = false
        doSave()
        return
      }
    } catch {
      setStatus('error')
    } finally {
      inflightRef.current = false
    }
  }, [])

  useEffect(() => {
    if (!enabled) return
    if (initialRef.current) {
      initialRef.current = false
      if (skipInitialSave) return
    }
    if (timerRef.current) clearTimeout(timerRef.current)
    timerRef.current = setTimeout(doSave, delay)
    return () => {
      if (timerRef.current) clearTimeout(timerRef.current)
    }
  }, [data, delay, enabled, skipInitialSave, doSave])

  useEffect(() => {
    return () => {
      if (timerRef.current) clearTimeout(timerRef.current)
      if (savedTimerRef.current) clearTimeout(savedTimerRef.current)
    }
  }, [])

  const flush = useCallback(() => {
    if (timerRef.current) clearTimeout(timerRef.current)
    doSave()
  }, [doSave])

  const retry = useCallback(() => {
    doSave()
  }, [doSave])

  return { status, flush, retry }
}
