import type { WireShape } from '../../ai-providers/preset-catalog.js'

export const DEFAULT_OPENAI_BASE = 'https://api.openai.com/v1'
export const MODEL_DISCOVERY_TIMEOUT_MS = 10_000
const MAX_MODEL_COUNT = 100
const MAX_MODEL_ID_LENGTH = 128

export type ModelDiscoveryResult =
  | { status: 'success'; models: string[] }
  | { status: 'unsupported' }
  | { status: 'failure'; retryable: boolean }

interface ModelListPayload {
  data?: unknown
}

function failure(retryable: boolean): ModelDiscoveryResult {
  return { status: 'failure', retryable }
}

/** Compose the OpenAI list-models endpoint from the configured API root. */
export function composeOpenAIModelsUrl(baseUrl?: string): string | null {
  const raw = baseUrl?.trim() || DEFAULT_OPENAI_BASE
  try {
    const url = new URL(raw)
    if ((url.protocol !== 'http:' && url.protocol !== 'https:') || url.username || url.password) return null
    url.search = ''
    url.hash = ''
    const path = url.pathname.replace(/^\/+|\/+$/g, '')
    url.pathname = path ? '/' + path + '/models' : '/models'
    return url.toString()
  } catch {
    return null
  }
}

function sanitizeModelIds(payload: ModelListPayload): string[] | null {
  if (!Array.isArray(payload.data)) return null
  const seen = new Set<string>()
  const models: string[] = []
  for (const item of payload.data) {
    if (!item || typeof item !== 'object') continue
    const rawId = (item as { id?: unknown }).id
    if (typeof rawId !== 'string') continue
    const id = rawId.trim()
    if (!id || id.length > MAX_MODEL_ID_LENGTH || /[\u0000-\u001f\u007f-\u009f]/.test(id)) continue
    if (seen.has(id)) continue
    seen.add(id)
    models.push(id)
    if (models.length >= MAX_MODEL_COUNT) break
  }
  return models
}

export async function discoverOpenAIModels(input: {
  wireShape: WireShape | string
  baseUrl?: string
  apiKey?: string
}): Promise<ModelDiscoveryResult> {
  if (input.wireShape !== 'openai-chat') return { status: 'unsupported' }
  const apiKey = input.apiKey?.trim()
  const url = composeOpenAIModelsUrl(input.baseUrl)
  if (!apiKey || !url) return failure(false)

  let response: Response
  try {
    response = await fetch(url, {
      method: 'GET',
      headers: {
        Accept: 'application/json',
        Authorization: 'Bearer ' + apiKey,
      },
      redirect: 'error',
      signal: AbortSignal.timeout(MODEL_DISCOVERY_TIMEOUT_MS),
    })
  } catch {
    return failure(true)
  }
  if (!response.ok) return failure(true)

  let payload: ModelListPayload
  try {
    payload = await response.json() as ModelListPayload
  } catch {
    return failure(true)
  }
  const models = sanitizeModelIds(payload)
  return models === null ? failure(true) : { status: 'success', models }
}
