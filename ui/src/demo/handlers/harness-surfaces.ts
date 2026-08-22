import { http, HttpResponse } from 'msw'

function response(workspaceId: string, capability: string) {
  return HttpResponse.json({
    surface: {
      workspaceId,
      capability,
      phase: 'failed',
      generation: 1,
      error: 'Harness Studio processes are unavailable in Demo mode.',
      logs: '[demo] managed Harness processes are disabled\n',
    },
  })
}

export const harnessSurfaceHandlers = [
  http.get('/api/harness-surfaces/:workspaceId/:capability', ({ params }) =>
    response(String(params.workspaceId), String(params.capability))),
  http.post('/api/harness-surfaces/:workspaceId/:capability/:action', ({ params }) =>
    response(String(params.workspaceId), String(params.capability))),
]
