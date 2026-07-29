import { http, HttpResponse } from 'msw'

import packageJson from '../../../../package.json'

const currentVersion = packageJson.version

export const devMiscHandlers = [
  http.get('/api/version', () =>
    HttpResponse.json({
      current: currentVersion,
      latest: null,
      hasUpdate: false,
      releaseUrl: null,
      releaseNotes: null,
      publishedAt: null,
      error: null,
    }),
  ),

  http.post('/api/version/check', () =>
    HttpResponse.json({
      current: currentVersion,
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
