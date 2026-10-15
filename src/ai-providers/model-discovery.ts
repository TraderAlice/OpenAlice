import { z } from 'zod'
import { resolveAnthropicAuthMode } from '../core/credential-inference.js'

export const modelDiscoveryInput = z.object({
  wireShape: z.enum(['openai-chat', 'openai-responses', 'anthropic', 'google-generative-ai']),
  baseUrl: z.string().trim().max(2048).optional(),
  apiKey: z.string().trim().min(1),
}).strict()

import type { DiscoveredModel } from './discovered-model.js'
export type { DiscoveredModel } from './discovered-model.js'
import { discoverModelSemantics } from './discovery-semantics.js'

const catalogPage = z.object({
  data: z.array(z.object({ id: z.string().min(1).max(512), display_name: z.string().optional(), name: z.string().optional() }).passthrough()).optional(),
  models: z.array(z.object({
    name: z.string().min(1).max(512), displayName: z.string().optional(),
    supportedGenerationMethods: z.array(z.string()).optional(),
  }).passthrough()).optional(),
  has_more: z.boolean().optional(), last_id: z.string().optional(), nextPageToken: z.string().optional(),
})

/** Read model IDs from the selected endpoint; never send a generation request. */
export async function discoverModels(input: z.infer<typeof modelDiscoveryInput>, semanticsProtocol?: 'anthropic' | 'google' | 'openai'): Promise<DiscoveredModel[]> {
  const google = input.wireShape === 'google-generative-ai'
  const anthropic = input.wireShape === 'anthropic'
  const base = input.baseUrl || (google ? 'https://generativelanguage.googleapis.com/v1beta'
    : anthropic ? 'https://api.anthropic.com' : 'https://api.openai.com/v1')
  let url: URL
  try { url = new URL(base) } catch { throw new Error('Invalid model API endpoint') }
  if (!['http:', 'https:'].includes(url.protocol) || url.username || url.password || url.hash || url.search) {
    throw new Error('Invalid model API endpoint')
  }
  url.pathname = `${url.pathname.replace(/\/+$/, '')}${anthropic && !/\/v1\/?$/.test(url.pathname) ? '/v1/models' : '/models'}`
  const headers: Record<string, string> = google ? { 'x-goog-api-key': input.apiKey }
    : anthropic && resolveAnthropicAuthMode({ baseUrl: base }) === 'x-api-key'
      ? { 'x-api-key': input.apiKey } : { Authorization: `Bearer ${input.apiKey}` }
  if (anthropic) { headers['anthropic-version'] = '2023-06-01'; url.searchParams.set('limit', '1000') }
  if (google) url.searchParams.set('pageSize', '1000')
  const models = new Map<string, DiscoveredModel>()
  const cursors = new Set<string>()
  const signal = AbortSignal.timeout(15_000)
  for (let page = 0; page < 20; page++) {
    let response: Response
    try {
      response = await fetch(url, { headers, signal, redirect: 'error' })
    } catch {
      throw new Error('Could not reach the model API (request failed or timed out)')
    }
    // Do not echo provider error bodies: gateways can include request secrets.
    if (!response.ok) throw new Error(`Model API returned HTTP ${response.status}`)
    const parsed = catalogPage.safeParse(await response.json().catch(() => null))
    if (!parsed.success || (google ? !parsed.data.models : !parsed.data.data)) {
      throw new Error('Model API returned an invalid model list')
    }
    const data = parsed.data
    const entries: DiscoveredModel[] = google
      ? data.models!.filter((model) => !model.supportedGenerationMethods || model.supportedGenerationMethods.includes('generateContent'))
        .map((model) => ({ id: model.name.replace(/^models\//, ''), label: model.displayName || model.name.replace(/^models\//, '') }))
      : data.data!.map((model) => ({ id: model.id, label: model.display_name || model.name || model.id }))
    const originals = google ? data.models! : data.data!
    for (const model of entries) {
      const raw = originals.find((item) => ('id' in item ? item.id : String(item.name).replace(/^models\//, '')) === model.id)
      const semantics = discoverModelSemantics(raw, semanticsProtocol ?? (google ? 'google' : anthropic ? 'anthropic' : 'openai'))
      models.set(model.id, { ...model, ...(semantics ? { semantics } : {}) })
    }
    const cursor = google ? data.nextPageToken : anthropic && data.has_more ? data.last_id : undefined
    if (!cursor) {
      if (anthropic && data.has_more) throw new Error('Model API returned an invalid page cursor')
      return [...models.values()]
    }
    if (cursors.has(cursor)) throw new Error('Model API repeated a page cursor')
    cursors.add(cursor)
    url.searchParams.set(google ? 'pageToken' : 'after_id', cursor)
  }
  throw new Error('Model API exceeded the page limit')
}
