import { http, HttpResponse } from 'msw'

import { defaultUiLayout, normalizeUiLayout, type UiLayout } from '../../live/ui-layout'

let layout: UiLayout = defaultUiLayout()

export const uiLayoutHandlers = [
  http.get('/api/ui-layout', () => HttpResponse.json(layout)),
  http.put('/api/ui-layout', async ({ request }) => {
    const body = await request.json().catch(() => null)
    try {
      layout = normalizeUiLayout(body)
      return HttpResponse.json(layout)
    } catch {
      return HttpResponse.json({ error: 'invalid_ui_layout' }, { status: 400 })
    }
  }),
]
