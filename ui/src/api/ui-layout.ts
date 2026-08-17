import { fetchJson, headers } from './client'
import type { UiLayout } from '../live/ui-layout'

export const uiLayoutApi = {
  get(): Promise<UiLayout> {
    return fetchJson('/api/ui-layout')
  },

  put(layout: UiLayout): Promise<UiLayout> {
    return fetchJson('/api/ui-layout', {
      method: 'PUT',
      headers,
      body: JSON.stringify(layout),
    })
  },
}
