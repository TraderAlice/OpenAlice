import { http, HttpResponse } from 'msw'
import { demoInboxEntries } from '../fixtures/inbox'

export const inboxHandlers = [
  http.get('/api/inbox/history', () =>
    HttpResponse.json({ entries: demoInboxEntries, hasMore: false }),
  ),
  http.post('/api/inbox/seed', () =>
    HttpResponse.json({ error: 'Demo mode — inbox seed is disabled.' }, { status: 400 }),
  ),
  http.delete('/api/inbox/:id', () => new HttpResponse(null, { status: 204 })),
]
