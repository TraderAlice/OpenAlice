import type { AddressInfo } from 'node:net'
import { afterEach, describe, expect, it } from 'vitest'

import {
  ONBOARDING_AI_MOCK_KEY,
  createOnboardingAiMockServer,
} from './onboarding-ai-mock.js'

let closeServer: (() => Promise<void>) | null = null

afterEach(async () => {
  await closeServer?.()
  closeServer = null
})

async function startMock() {
  const server = createOnboardingAiMockServer()
  await new Promise<void>((resolve) => server.listen(0, '127.0.0.1', resolve))
  closeServer = () => new Promise<void>((resolve, reject) => {
    server.close((error) => error ? reject(error) : resolve())
  })
  const address = server.address() as AddressInfo
  return `http://127.0.0.1:${address.port}`
}

describe('onboarding AI mock', () => {
  it('streams a real OpenAI-compatible readiness reply on loopback', async () => {
    const baseUrl = await startMock()
    const response = await fetch(`${baseUrl}/v1/chat/completions`, {
      method: 'POST',
      headers: {
        authorization: `Bearer ${ONBOARDING_AI_MOCK_KEY}`,
        'content-type': 'application/json',
      },
      body: JSON.stringify({
        model: 'openalice-onboarding-test',
        stream: true,
        messages: [{ role: 'user', content: 'Reply exactly with OPENALICE_READY.' }],
      }),
    })

    expect(response.status).toBe(200)
    expect(response.headers.get('content-type')).toContain('text/event-stream')
    const body = await response.text()
    expect(body).toContain('OPENALICE_READY')
    expect(body).toContain('data: [DONE]')
  })

  it('rejects any key other than the isolated test key', async () => {
    const baseUrl = await startMock()
    const response = await fetch(`${baseUrl}/v1/chat/completions`, {
      method: 'POST',
      headers: { authorization: 'Bearer wrong' },
    })

    expect(response.status).toBe(401)
  })
})
