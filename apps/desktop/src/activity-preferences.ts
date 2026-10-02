import { readFileSync, statSync } from 'node:fs'
import { writeFile, rename } from 'node:fs/promises'
import { z } from 'zod'
import { DEFAULT_ACTIVITY_PREFERENCES, type ActivityPreferences } from './activity-policy.js'
const decision = z.enum(['show', 'hide']).optional()
const controls = {
  enabled: z.boolean(), main: z.boolean(), pet: z.boolean(), brief: z.boolean(),
  pausedUntil: z.number().finite().nonnegative().max(8.64e15),
}
const eventsSchema = z.object({ completion: z.boolean(), failure: z.boolean(), action: z.boolean(), news: z.boolean(), progress: z.boolean() }).strict()
export const preferencesSchema = z.object({
  version: z.literal(2), defaultsVersion: z.number().int().nonnegative(),
  events: eventsSchema, ...controls,
}).strict()
const legacySchema = z.object({
  version: z.literal(1), defaultsVersion: z.number().int().min(0).max(1),
  preset: z.enum(['action', 'important', 'all']),
  overrides: z.object({ completion: decision, failure: decision, action: decision, news: decision, progress: decision }).strict(),
  ...controls,
}).strict()
/** Expand saved choices, independently of temporary delivery gates. */
export function migrateActivityPreferences(input: unknown): ActivityPreferences {
  if (typeof input === 'object' && input !== null && 'version' in input && input.version === 1) {
    const { preset, overrides, ...saved } = legacySchema.parse(input)
    const events = { ...DEFAULT_ACTIVITY_PREFERENCES.events }
    for (const kind of Object.keys(events) as Array<keyof typeof events>) {
      events[kind] = overrides[kind] ? overrides[kind] === 'show'
        : preset === 'all' || (preset === 'important' && kind !== 'progress')
          || (preset === 'action' && (kind === 'action' || kind === 'failure'))
    }
    return { ...saved, version: 2, defaultsVersion: DEFAULT_ACTIVITY_PREFERENCES.defaultsVersion, events }
  }
  // A new official default never replaces an existing explicit choice.
  return preferencesSchema.parse(input)
}
export function createActivityPreferenceStore(path: string) {
  let current = structuredClone(DEFAULT_ACTIVITY_PREFERENCES)
  try { if (statSync(path).size < 16_384) current = migrateActivityPreferences(JSON.parse(readFileSync(path, 'utf8'))) } catch { /* Invalid disk state: official defaults. */ }
  let queue = Promise.resolve()
  const persist = async (value: ActivityPreferences) => {
    await writeFile(path + '.tmp', JSON.stringify(value), { mode: 0o600 })
    await rename(path + '.tmp', path)
    current = value
    return structuredClone(current)
  }
  const enqueue = (fn: () => Promise<ActivityPreferences>) => { const next = queue.then(fn); queue = next.then(() => {}, () => {}); return next }
  return {
    get: () => structuredClone(current),
    update(input: unknown) {
      const patch = preferencesSchema.omit({ version: true, defaultsVersion: true, events: true }).extend({ events: eventsSchema.partial() }).partial().parse(input)
      return enqueue(() => persist(preferencesSchema.parse({ ...current, ...patch, events: { ...current.events, ...patch.events } })))
    },
    reset: () => enqueue(() => persist({ ...current, defaultsVersion: DEFAULT_ACTIVITY_PREFERENCES.defaultsVersion, events: { ...DEFAULT_ACTIVITY_PREFERENCES.events } })),
  }
}
