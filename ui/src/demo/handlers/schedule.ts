import { http, HttpResponse } from 'msw'
import { demoScheduleSnapshot } from '../fixtures/schedule'

// Read the same mutable declarations as the Issue board and detail.
export const scheduleHandlers = [
  http.get('/api/schedule', () => HttpResponse.json(demoScheduleSnapshot())),
]
