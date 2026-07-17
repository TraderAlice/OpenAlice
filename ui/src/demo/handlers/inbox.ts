import { http, HttpResponse } from 'msw'
import { demoInboxEntries } from '../fixtures/inbox'

export const inboxHandlers = [
  http.get('/api/inbox/history', ({ request }) => {
    const entries = request.headers.get('x-openalice-theme-audit-fixture') === 'inbox-markdown'
      ? demoInboxEntries.map((entry, index) => index === 0
        ? { ...entry, comments: `${entry.comments ?? ''}\n\nSee [[AAPL]] analysis from @resume-audit-session.` }
        : entry)
      : demoInboxEntries
    return HttpResponse.json({ entries, hasMore: false })
  }),
  http.post('/api/inbox/seed', () =>
    HttpResponse.json({ error: 'Demo mode — inbox seed is disabled.' }, { status: 400 }),
  ),
  http.put('/api/inbox/:id/read', ({ params }) =>
    HttpResponse.json({ ok: true, id: String(params.id), readAt: Date.now() }),
  ),
  http.delete('/api/inbox/:id/read', ({ params }) =>
    HttpResponse.json({ ok: true, id: String(params.id) }),
  ),
  http.delete('/api/inbox/:id', () => new HttpResponse(null, { status: 204 })),
]
