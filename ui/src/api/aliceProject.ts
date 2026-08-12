import { fetchJson } from './client'

export interface AliceProject {
  readonly id: string
  readonly key: string
  readonly displayName: string
  readonly home: string
  readonly appRoot: string | null
  readonly product?: 'trader' | 'nano'
}

export const aliceProjectApi = {
  get: () => fetchJson<{ project: AliceProject }>('/api/alice-project'),
}
