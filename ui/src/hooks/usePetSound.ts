import { useEffect, useRef, useState } from 'react'

const MAX_BYTES = 2 * 1024 * 1024
export function usePetSound() {
  const bridge = window.openAlice?.companion
  const [settings, setSettings] = useState<PetSoundSettings | null>(null)
  const [loading, setLoading] = useState(!!bridge?.getSound)
  const [pending, setPending] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const busy = useRef(false)
  const audio = useRef<HTMLAudioElement | null>(null)
  useEffect(() => {
    if (!bridge?.getSound) return
    let active = true, notified = false
    const unsubscribe = bridge.onSound(value => {
      notified = true
      audio.current?.pause()
      if (active) setSettings(value)
    })
    void bridge.getSound().then(value => { if (active && !notified) setSettings(value) })
      .catch(() => { if (active) setError('unavailable') })
      .finally(() => { if (active) setLoading(false) })
    return () => { active = false; unsubscribe(); audio.current?.pause() }
  }, [bridge])
  const run = async (action: () => Promise<void>) => {
    if (busy.current) return
    busy.current = true; setPending(true); setError(null)
    audio.current?.pause()
    try { await action() } catch (e) { setError(e instanceof Error && e.message === 'invalidFile' ? 'invalidFile' : 'failed') }
    finally { busy.current = false; setPending(false) }
  }
  const update = (patch: Partial<PetSoundSettings>) => run(async () => {
    if (!bridge) throw new Error('unavailable')
    setSettings(await bridge.updateSound(patch))
  })
  const importFile = (file: File) => run(async () => {
    if (!bridge) throw new Error('unavailable')
    const mime = ({ wav: 'wav', mp3: 'mpeg', ogg: 'ogg' } as Record<string, string>)[file.name.split('.').pop()?.toLowerCase() ?? '']
    if (!mime || file.size === 0 || file.size > MAX_BYTES || file.name.length > 160) throw new Error('invalidFile')
    const dataUrl = await new Promise<string>((resolve, reject) => {
      const reader = new FileReader()
      reader.onload = () => resolve(`data:audio/${mime};base64,${String(reader.result).split(',')[1]}`)
      reader.onerror = reject
      reader.readAsDataURL(file)
    })
    // Decode locally before saving; the main process separately validates size and signatures.
    const context = new AudioContext()
    try {
      const decoded = await context.decodeAudioData(await file.arrayBuffer())
      if (!Number.isFinite(decoded.duration) || decoded.duration <= 0 || decoded.duration > 10) throw new Error('invalidFile')
    } catch { throw new Error('invalidFile') }
    finally { await context.close() }
    setSettings(await bridge.updateSound({ source: { name: file.name, dataUrl } }))
  })
  const preview = async () => {
    if (!settings?.source) return
    audio.current?.pause()
    const next = new Audio(settings.source.dataUrl)
    next.volume = settings.volume
    audio.current = next
    setError(null)
    try { await next.play() } catch { setError('playback') }
  }
  const reset = () => run(async () => {
    if (!bridge?.resetSound) throw new Error('unavailable')
    setSettings(await bridge.resetSound())
  })
  return { settings, loading, pending, error, update, importFile, preview, reset }
}
