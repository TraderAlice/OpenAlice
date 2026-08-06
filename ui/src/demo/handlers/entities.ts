import { http, HttpResponse } from 'msw'
import { demoEntities, demoEntityDetail, demoEntityGraph } from '../fixtures/entities'

export const entitiesHandlers = [
  http.get('/api/entities', () => HttpResponse.json({ entities: demoEntities })),
  http.get('/api/entities/relationships/graph', () => HttpResponse.json(demoEntityGraph)),
  http.get('/api/entities/:name', ({ params }) => {
    const detail = demoEntityDetail[String(params['name']).toLowerCase()]
    if (!detail) return HttpResponse.json({ error: 'not_found' }, { status: 404 })
    return HttpResponse.json(detail)
  }),
]
