import { http, HttpResponse } from 'msw'
import { demoScheduleSnapshot } from '../fixtures/schedule'

// GET /api/schedule returns the SNAPSHOT shape (workspaces[].tasks[], each task
// now carrying `issue`) — NOT the workspace file shape. The `.alice/issue.json`
// file's `issues` wrapper key is server-side only and is not mocked here, so no
// wrapper-key rename applies; the demo just passes the snapshot fixture through.
export const scheduleHandlers = [
  http.get('/api/schedule', () => HttpResponse.json(demoScheduleSnapshot)),
]
