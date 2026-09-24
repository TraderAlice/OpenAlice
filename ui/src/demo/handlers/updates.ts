import { http, HttpResponse } from 'msw'

let preferences = {
  autoCheckApp: true,
  autoUpdateAutoQuant: true,
  autoUpdateAutoPrediction: true,
}
const snapshot = () => ({ preferences, workspaces: [] })

export const updatesHandlers = [
  http.post('/api/updates/activate', () => HttpResponse.json({ accepted: true }, { status: 202 })),
  http.get('/api/updates', () => HttpResponse.json(snapshot())),
  http.post('/api/updates/check', () => HttpResponse.json(snapshot())),
  http.get('/api/preferences/updates', () => HttpResponse.json(preferences)),
  http.put('/api/preferences/updates', async ({ request }) => {
    const body = await request.json().catch(() => null) as typeof preferences | null
    if (!body || Object.values(body).some(value => typeof value !== 'boolean')) {
      return HttpResponse.json({ error: 'invalid_update_preferences' }, { status: 400 })
    }
    preferences = body
    return HttpResponse.json(preferences)
  }),
]
