import { readFileSync, statSync } from 'node:fs'
import { writeFile, rename } from 'node:fs/promises'
import { z } from 'zod'

export const MAX_SOUND_BYTES = 2 * 1024 * 1024
const sourceSchema = z.object({
  name: z.string().min(1).max(160),
  dataUrl: z.string().max(Math.ceil(MAX_SOUND_BYTES / 3) * 4 + 64),
}).strict().refine(source => {
  const match = /^data:audio\/(wav|mpeg|ogg);base64,([A-Za-z0-9+/]+={0,2})$/.exec(source.dataUrl)
  if (!match) return false
  const bytes = Buffer.from(match[2], 'base64')
  if (bytes.length < 12 || bytes.length > MAX_SOUND_BYTES || bytes.toString('base64') !== match[2]) return false
  if (match[1] === 'wav') return bytes.toString('ascii', 0, 4) === 'RIFF' && bytes.toString('ascii', 8, 12) === 'WAVE'
  if (match[1] === 'ogg') return bytes.toString('ascii', 0, 4) === 'OggS'
  return bytes.toString('ascii', 0, 3) === 'ID3' || (bytes[0] === 0xff && (bytes[1] & 0xe0) === 0xe0)
}, 'Choose a valid WAV, MP3 or OGG audio file (up to 2 MB).')
const soundSchema = z.object({
  enabled: z.boolean(), volume: z.number().finite().min(0).max(1), source: sourceSchema.nullable(),
}).strict()
export type CompanionSound = z.infer<typeof soundSchema>
export const DEFAULT_SOUND: CompanionSound = { enabled: true, volume: .5, source: null }

/** Local copied audio only: never reads arbitrary paths supplied by a renderer. */
export function createCompanionSoundStore(path: string, fallback: CompanionSound = DEFAULT_SOUND) {
  const defaults = soundSchema.parse(fallback)
  let current = structuredClone(defaults)
  try {
    if (statSync(path).size <= 3 * 1024 * 1024) {
      const stored = soundSchema.parse(JSON.parse(readFileSync(path, 'utf8')))
      // The first shipped default was silent during development. Upgrade that
      // unreleased shape to the bundled sound; an explicit mute still wins.
      current = stored.source === null && defaults.source ? { ...stored, source: defaults.source } : stored
    }
  } catch { /* Unconfigured or damaged local preferences use the bundled default. */ }
  let queue = Promise.resolve()
  const persist = async (next: CompanionSound) => {
    await writeFile(path + '.tmp', JSON.stringify(next), { mode: 0o600 })
    await rename(path + '.tmp', path)
    current = next
    return structuredClone(current)
  }
  const enqueue = (operation: () => Promise<CompanionSound>) => {
    const next = queue.then(operation)
    queue = next.then(() => {}, () => {})
    return next
  }
  return {
    get: () => structuredClone(current),
    update(input: unknown): Promise<CompanionSound> {
      const patch = soundSchema.partial().parse(input)
      return enqueue(async () => {
        const next = soundSchema.parse({ ...current, ...patch })
        return persist(next)
      })
    },
    reset: () => enqueue(() => persist(structuredClone(defaults))),
  }
}
