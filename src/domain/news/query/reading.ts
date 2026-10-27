import { tool } from 'ai'
import { z } from 'zod'
import type { NewsStoryStore } from '../stories.js'
import { newsStorySchema } from '../reading-contract.js'
import { newsCountrySchema, newsIndustrySchema } from '../association-contract.js'

const MAX_ARTIFACT_BYTES = 1024 * 1024

/** Native CLIs prepare the content; these tools only read and validate stored results. */
export function createNewsReadingTools(stories: NewsStoryStore) {
  return {
    pendingNewsReports: tool({
      description: 'List unprepared originals from the complete durable archive. Defaults to oldest ingestion first; order recent selects a bounded newest-publication queue head, without offset pagination or discarding older pending work. Includes due failed retries and complete pending/review/failed counts. Read each original with rss read, inspect existing events, then publish or record an unresolved review. Successful publication acknowledges its report IDs; interrupted work remains pending after restart.',
      inputSchema: z.object({ limit: z.number().int().min(1).max(40).optional(), status: z.enum(['pending', 'review', 'failed']).optional(), order: z.enum(['oldest', 'recent']).optional() }).strict(),
      execute: async query => stories.pending(query),
    }),
    recordNewsReview: tool({
      description: 'Keep original report IDs unresolved with a concrete reason. review holds an uncertain relation for a human; failed schedules a durable bounded-backoff retry for a transient processing failure. Never clear work by inventing facts. Agents cannot release a human review hold.',
      inputSchema: z.object({ reportIds: z.array(z.number().int().nonnegative()).min(1).max(40), status: z.enum(['review', 'failed']), reason: z.string().trim().min(1).max(1000) }).strict(),
      execute: async ({ reportIds, status, reason }) => stories.disposition(reportIds, status, reason),
    }),
    listNewsStories: tool({
      description: 'List prepared events and their original report IDs before organizing new material. Includes all subjects and non-selected events by default. Follow nextOffset to find older events. This reads stored results; it does not call a model or search news outside the subscribed archive.',
      inputSchema: z.object({
        country: newsCountrySchema.optional(),
        industry: newsIndustrySchema.optional(), asset: z.string().min(3).max(500).optional(),
        keyword: z.string().max(500).optional(),
        topics: z.array(z.string().max(80)).max(24).optional(),
        source: z.string().max(200).optional(),
        offset: z.number().int().nonnegative().optional(),
        order: z.enum(['recent', 'heat', 'relevance']).optional(),
      }).strict(),
      execute: async query => stories.list(query),
    }),
    readNewsStory: tool({
      description: 'Read one prepared event, its revision, distinct developments and original evidence. Read before updating; retain existing developments and originals. A missing report is an evidence gap, not a reason to invent its content.',
      inputSchema: z.object({ id: newsStorySchema.shape.id }).strict(),
      execute: async ({ id }) => stories.get(id),
    }),
    readNewsAssociations: tool({
      description: 'Read a stored event association history, current/review status and exact original evidence fields with UTF-8 SHA-256 digests. Missing/ambiguous identities remain unresolved. No model or external lookup runs on this read.',
      inputSchema: z.object({ id: newsStorySchema.shape.id }).strict(),
      execute: async ({ id }) => stories.getAssociations(id),
    }),
    publishNewsAssociations: tool({
      description: 'Publish a complete version-1 association snapshot separately from event content. Bind storyId/storyRevision and next association revision; keep preparedBy/preparedAt, relations and unresolved labels. Each relation has exactly one country code, industry ETF classification ID or resolved asset:{barId,assetClass}; kind mentioned/directly-involved, or conditional-transmission with a separate condition for industry/assets. Include status active/withdrawn, explanation and evidence:[{reportId,field:content|title,sha256,excerpt}]. Exact excerpt and digest must match current event originals. Title is allowed only when body is absent. Respect protected human corrections, locked events and held reports. Unknown/ambiguous identities belong in unresolved, never invent codes or causality. Use readNewsAssociations first and market search-bars for a complete sourceId|nativeSymbol. artifact is JSON; CLI supports --artifact-file.',
      inputSchema: z.object({ artifact: z.string().max(MAX_ARTIFACT_BYTES) }).strict(),
      execute: async ({ artifact }) => {
        if (Buffer.byteLength(artifact, 'utf8') > MAX_ARTIFACT_BYTES) throw new Error('Association artifact exceeds 1 MiB')
        const value = JSON.parse(artifact)
        const id = newsStorySchema.shape.id.parse(value?.storyId)
        return stories.publishAssociations(id, value, { automatic: true })
      },
    }),
    publishNewsStory: tool({
      description: 'Publish a complete version-1 evidence-linked event prepared by the native agent. Every publication must include importance:{level:important|normal|uncertain,reason,reportIds} and transmission:{steps:2-5 short strings,condition,reportIds} or transmission:null when no defensible path exists. Reassess both from this revision\'s originals. Transmission is conditional analysis, not verified market impact; cite distinct report IDs belonging to this event. Never substitute heat, selected or tickers. artifact is JSON text; the CLI accepts --artifact-file to avoid shell interpolation. First revision is 1; subsequent revisions increment the current revision. Same-fact reports share a development; follow-ups stay distinct. All originals remain intact. No stock symbol or AI topic is required. Structural validation does not establish truth or authorize trading.',
      inputSchema: z.object({ artifact: z.string().max(MAX_ARTIFACT_BYTES) }).strict(),
      execute: async ({ artifact }) => {
        if (Buffer.byteLength(artifact, 'utf8') > MAX_ARTIFACT_BYTES) throw new Error('Event artifact exceeds 1 MiB')
        let value: unknown
        try { value = JSON.parse(artifact) }
        catch { throw new Error('Invalid event artifact JSON') }
        try {
          const result = await stories.publish(value, { automatic: true })
          return { id: result.id, revision: result.revision }
        } catch (error) {
          if (error instanceof Error && /revision.*conflict/i.test(error.message)) throw new Error('Event revision conflict; read the current event and reconcile before publishing again')
          if (error instanceof Error && /locked|retain|assigned|awaiting human review|importance assessment|transmission/i.test(error.message)) throw new Error(error.message)
          throw new Error('Event publication failed; check artifact fields and original report IDs')
        }
      },
    }),
  }
}
