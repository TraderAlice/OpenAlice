import { http, HttpResponse } from 'msw'

export const devMiscHandlers = [
  http.get('/api/version', () =>
    HttpResponse.json({
      current: '0.21.0-demo',
      latest: null,
      hasUpdate: false,
      releaseUrl: null,
      releaseNotes: null,
      publishedAt: null,
      error: null,
    }),
  ),

  http.get('/api/media/:date/:name', () => new HttpResponse(null, { status: 404 })),
]
