import { createServer, type Server } from 'node:http'

export const ONBOARDING_AI_MOCK_KEY = 'oa_test_ok'
export const ONBOARDING_AI_MOCK_MODEL = 'openalice-onboarding-test'

function requestContainsReadinessPrompt(body: string): boolean {
  try {
    const parsed = JSON.parse(body) as { messages?: unknown }
    return JSON.stringify(parsed.messages ?? '').includes('OPENALICE_READY')
  } catch {
    return false
  }
}

function completionStream(text: string): string {
  const id = 'chatcmpl-openalice-onboarding'
  const created = Math.floor(Date.now() / 1000)
  const chunk = (choices: unknown[], usage?: Record<string, number>) => JSON.stringify({
    id,
    object: 'chat.completion.chunk',
    created,
    model: ONBOARDING_AI_MOCK_MODEL,
    choices,
    ...(usage ? { usage } : {}),
  })
  return [
    `data: ${chunk([{ index: 0, delta: { role: 'assistant' }, finish_reason: null }])}`,
    `data: ${chunk([{ index: 0, delta: { content: text }, finish_reason: null }])}`,
    `data: ${chunk([{ index: 0, delta: {}, finish_reason: 'stop' }], {
      prompt_tokens: 8,
      completion_tokens: 8,
      total_tokens: 16,
    })}`,
    'data: [DONE]',
    '',
  ].join('\n\n')
}

/** A loopback-only OpenAI-compatible endpoint for the complete onboarding
 *  feedback loop. Unlike the credential form's synthetic "Test" response,
 *  this is exercised by the real Pi process for both readiness and first chat. */
export function createOnboardingAiMockServer(): Server {
  return createServer((req, res) => {
    if (req.method === 'GET' && req.url === '/healthz') {
      res.writeHead(200, { 'content-type': 'application/json' })
      res.end(JSON.stringify({ ok: true }))
      return
    }
    if (req.method !== 'POST' || req.url !== '/v1/chat/completions') {
      res.writeHead(404, { 'content-type': 'application/json' })
      res.end(JSON.stringify({ error: { message: 'Not found' } }))
      return
    }
    if (req.headers.authorization !== `Bearer ${ONBOARDING_AI_MOCK_KEY}`) {
      res.writeHead(401, { 'content-type': 'application/json' })
      res.end(JSON.stringify({ error: { message: 'Invalid onboarding test key' } }))
      return
    }

    let body = ''
    req.setEncoding('utf8')
    req.on('data', (chunk: string) => {
      if (body.length < 1_000_000) body += chunk
    })
    req.on('end', () => {
      const text = requestContainsReadinessPrompt(body)
        ? 'OPENALICE_READY'
        : '这是隔离测试回复：Alice 已收到你的第一条消息。'
      res.writeHead(200, {
        'content-type': 'text/event-stream; charset=utf-8',
        'cache-control': 'no-cache',
        connection: 'keep-alive',
      })
      res.end(completionStream(text))
    })
  })
}

export async function startOnboardingAiMockServer(port = 0): Promise<Server> {
  const server = createOnboardingAiMockServer()
  await new Promise<void>((resolve, reject) => {
    server.once('error', reject)
    server.listen(port, '127.0.0.1', () => {
      server.off('error', reject)
      resolve()
    })
  })
  return server
}
