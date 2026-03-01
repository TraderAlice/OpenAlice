import { fetchJson, headers } from './client'

export interface ToolInfo {
  name: string
  group: string
  description: string
}

export interface ToolsResponse {
  inventory: ToolInfo[]
  disabled: string[]
}

export const toolsApi = {
  async load(): Promise<ToolsResponse> {
    return fetchJson('/api/tools')
  },

  async update(disabled: string[]): Promise<{ disabled: string[] }> {
    return fetchJson('/api/tools', {
      method: 'PUT',
      headers,
      body: JSON.stringify({ disabled }),
    })
  },
}
