import { inboxFiles } from '@traderalice/connector-protocol'
import { http, HttpResponse } from 'msw'
import { demoInboxEntries, demoWorkspaceFiles } from '../fixtures/inbox'

const demoInboxReadState = new Map<string, number>()

export function demoInboxReadAt(inboxEntryId: string): number | undefined {
  return demoInboxReadState.get(inboxEntryId)
}

export const inboxHandlers = [
  http.get('/api/inbox/:id/files/:index', ({ params }) => {
    const entry = demoInboxEntries.find(entry => entry.id === params.id)
    const file = entry && inboxFiles(entry)[Number(params.index)]
    const content = file && demoWorkspaceFiles[file.path]
    return content === undefined ? new HttpResponse(null, { status: 404 }) : HttpResponse.text(content)
  }),
  http.get('/api/inbox/:id/files', ({ params }) => {
    const entry = demoInboxEntries.find(entry => entry.id === params.id)
    return entry ? HttpResponse.json({ files: inboxFiles(entry).map((file, index) => ({ ...file, available: true, href: `/api/inbox/${entry.id}/files/${index}` })) }) : HttpResponse.json({ error: 'not_found' }, { status: 404 })
  }),
  http.get('/api/inbox/history', () =>
    HttpResponse.json({
      entries: demoInboxEntries.map((entry) => {
        const readAt = demoInboxReadAt(entry.id)
        return readAt === undefined ? entry : { ...entry, readAt }
      }),
      hasMore: false,
    }),
  ),
  http.post('/api/inbox/seed', () =>
    HttpResponse.json({ error: 'Demo mode — inbox seed is disabled.' }, { status: 400 }),
  ),
  http.put('/api/inbox/:id/read', ({ params }) => {
    const id = String(params.id)
    if (!demoInboxEntries.some((entry) => entry.id === id)) {
      return HttpResponse.json({ error: 'not_found' }, { status: 404 })
    }
    const readAt = Date.now()
    demoInboxReadState.set(id, readAt)
    return HttpResponse.json({ ok: true, id, readAt })
  }),
  http.delete('/api/inbox/:id/read', ({ params }) => {
    const id = String(params.id)
    if (!demoInboxEntries.some((entry) => entry.id === id)) {
      return HttpResponse.json({ error: 'not_found' }, { status: 404 })
    }
    demoInboxReadState.delete(id)
    return HttpResponse.json({ ok: true, id })
  }),
  http.delete('/api/inbox/:id', () => new HttpResponse(null, { status: 204 })),
]
