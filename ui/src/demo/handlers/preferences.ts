import { http, HttpResponse } from 'msw'

const lastCredentialByAgent: Record<string, string> = { pi: 'minimax-1' }

export const preferencesHandlers = [
  http.get('/api/preferences/quick-chat', () =>
    HttpResponse.json({ lastCredentialByAgent: { ...lastCredentialByAgent } }),
  ),
  http.put('/api/preferences/quick-chat', async ({ request }) => {
    const body = (await request.json().catch(() => null)) as {
      agent?: unknown
      credentialSlug?: unknown
    } | null
    if (
      !body ||
      (body.agent !== 'opencode' && body.agent !== 'pi') ||
      (typeof body.credentialSlug !== 'string' && body.credentialSlug !== null)
    ) {
      return HttpResponse.json({ error: 'invalid_quick_chat_preference' }, { status: 400 })
    }
    if (body.credentialSlug === null) delete lastCredentialByAgent[body.agent]
    else lastCredentialByAgent[body.agent] = body.credentialSlug
    return HttpResponse.json({ lastCredentialByAgent: { ...lastCredentialByAgent } })
  }),
]
