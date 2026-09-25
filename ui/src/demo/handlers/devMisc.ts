import { http, HttpResponse } from 'msw'

import packageJson from '../../../../package.json'
import { currentDemoRelayProject } from './relay'

const currentVersion = packageJson.version

export const devMiscHandlers = [
  http.get('/api/alice-project', () =>
    HttpResponse.json({
      project: {
        ...currentDemoRelayProject(),
        home: '/demo/openalice',
        appRoot: null,
        product: 'trader',
      },
    }),
  ),

  http.get('/api/version', () =>
    HttpResponse.json({
      current: currentVersion,
      channel: 'stable',
      updateAuthority: 'source',
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
      channel: 'stable',
      updateAuthority: 'source',
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
