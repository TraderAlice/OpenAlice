import { z } from 'zod'
const text = z.string().nullable().default(null)
const value = z.union([z.string(), z.number()]).nullable().default(null)
const eventSchema = z.object({ date: text, country: text, event: text, importance: text, source: text, currency: text, unit: text, actual: value, consensus: value, previous: value })

export const economicCalendarSchema = z.object({
  events: z.array(eventSchema).max(5000),
  window: z.object({ start: z.string().regex(/^\d{4}-\d{2}-\d{2}$/), end: z.string().regex(/^\d{4}-\d{2}-\d{2}$/) }),
  meta: z.object({
    provider: z.string().min(1), asOf: z.string().datetime({ offset: true }),
    origin: z.enum(['hub', 'local']).optional(), cachedAt: z.string().optional(), stale: z.boolean().optional(),
  }),
})

export type EconomicCalendarBoard = z.infer<typeof economicCalendarSchema>
