import { fetchJson } from './client'
import type { TopologyResponse } from './types'

export const topologyApi = {
  async get(): Promise<TopologyResponse> {
    return fetchJson('/api/topology')
  },
}
