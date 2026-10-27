import { z } from 'zod'
import type { newsReport } from './report.js'
import type { NewsAssociationView } from './association-contract.js'

const identity = z.string().regex(/^[a-z0-9][a-z0-9-]{0,79}$/)
const text = z.string().trim().min(1).max(6000)
const reportIds = z.array(z.number().int().nonnegative()).min(1).max(100)

export const newsReadStatusSchema = z.enum(['all', 'unread', 'updated'])
export type NewsReadStatus = z.infer<typeof newsReadStatusSchema>

export const newsReadProgressSchema = z.object({
  revision: z.number().int().positive(),
  developmentIds: z.array(identity).min(1).max(100),
}).strict()
export type NewsReadProgress = z.infer<typeof newsReadProgressSchema>
export const newsReaderPatchSchema = z.object({
  following: z.boolean().optional(),
  bookmarked: z.boolean().optional(), locked: z.boolean().optional(), important: z.boolean().optional(),
  readRevision: z.number().int().positive().nullable().optional(),
}).strict().refine(value => Object.keys(value).length > 0)
export type NewsReaderPatch = z.infer<typeof newsReaderPatchSchema>
export type NewsReaderState = Pick<NewsReaderPatch, 'bookmarked' | 'locked' | 'important' | 'following'> & { readProgress?: NewsReadProgress | null }

export interface NewsFollowUpdate {
  storyId: string
  revision: number
  title: string
  developmentIds: string[]
}

/** Reviewed reading results, separate from immutable original reports. */
export const newsStorySchema = z.object({
  version: z.literal(1),
  id: identity,
  revision: z.number().int().positive(),
  title: text.max(300),
  summary: text,
  reason: text,
  importance: z.object({
    level: z.enum(['important', 'normal', 'uncertain']),
    reason: text.max(1000),
    reportIds,
  }).strict().optional(),
  transmission: z.object({
    steps: z.array(text.max(80)).min(2).max(5),
    condition: text.max(1000),
    reportIds,
  }).strict().nullable().optional(),
  comparisons: z.array(z.object({
    kind: z.enum(['official-response', 'difference', 'correction']),
    summary: text.max(1000),
    reportIds,
  }).strict()).max(32).optional(),
  topics: z.array(z.string().trim().min(1).max(80)).min(1).max(24),
  symbols: z.array(z.string().regex(/^[A-Z0-9._-]+:[A-Z0-9.^_-]+$/)).max(32),
  selected: z.boolean(),
  status: z.enum(['active', 'watching', 'settled']),
  updatedAt: z.string().datetime({ offset: true }),
  preparedBy: z.string().trim().min(1).max(120),
  overviewReportIds: reportIds,
  developments: z.array(z.object({
    id: identity,
    time: z.string().datetime({ offset: true }),
    title: text.max(300),
    summary: text,
    reportIds,
  }).strict()).min(1).max(100),
}).strict().superRefine((story, ctx) => {
  const facts = new Set<string>(), reports = new Set<number>()
  for (const development of story.developments) {
    if (facts.has(development.id)) ctx.addIssue({ code: 'custom', message: 'Duplicate development identity' })
    facts.add(development.id)
    if (Date.parse(development.time) > Date.parse(story.updatedAt)) ctx.addIssue({ code: 'custom', message: 'Development follows revision time' })
    for (const id of development.reportIds) {
      if (reports.has(id)) ctx.addIssue({ code: 'custom', message: 'A report may support only one development' })
      reports.add(id)
    }
  }
  if (new Set(story.overviewReportIds).size !== story.overviewReportIds.length || story.overviewReportIds.some(id => !reports.has(id))) {
    ctx.addIssue({ code: 'custom', message: 'Overview evidence must reference distinct development reports' })
  }
  if (reports.size > 100) ctx.addIssue({ code: 'custom', message: 'An event may reference at most 100 original reports' })
  if (story.importance && (new Set(story.importance.reportIds).size !== story.importance.reportIds.length || story.importance.reportIds.some(id => !reports.has(id)))) {
    ctx.addIssue({ code: 'custom', message: 'Importance evidence must reference distinct development reports', path: ['importance', 'reportIds'] })
  }
  if (story.transmission && (new Set(story.transmission.reportIds).size !== story.transmission.reportIds.length || story.transmission.reportIds.some(id => !reports.has(id)))) {
    ctx.addIssue({ code: 'custom', message: 'Transmission evidence must reference distinct development reports', path: ['transmission', 'reportIds'] })
  }
  for (const [index, comparison] of (story.comparisons ?? []).entries()) {
    if (new Set(comparison.reportIds).size !== comparison.reportIds.length || comparison.reportIds.some(id => !reports.has(id)) || comparison.kind !== 'official-response' && comparison.reportIds.length < 2) {
      ctx.addIssue({ code: 'custom', message: 'Source comparison requires distinct event evidence; differences and corrections need at least two reports', path: ['comparisons', index, 'reportIds'] })
    }
  }
})

export type NewsStory = z.infer<typeof newsStorySchema>

export type NewsStoryReport = ReturnType<typeof newsReport>

export interface NewsStoryDetail extends NewsStory {
  associations?: NewsAssociationView
  reports: NewsStoryReport[]
  missingReportIds: number[]
}

export interface NewsStoryPreview extends NewsStory {
  associations?: NewsAssociationView
  reading?: {
    following?: boolean
    readProgress?: NewsReadProgress | null
    important?: boolean
    bookmarked: boolean
    locked: boolean
    heat: number
    participants: number
    publishers?: number
    trend: 'rising' | 'falling' | 'steady' | 'unknown'
    isNew: boolean
    hasUpdate: boolean
  }
  reports: Array<Omit<NewsStoryReport, 'content' | 'quote' | 'media' | 'image'>>
  missingReportIds: number[]
}
