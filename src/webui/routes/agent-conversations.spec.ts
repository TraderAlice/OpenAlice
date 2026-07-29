import { describe, expect, it, vi } from 'vitest'

import type { AgentConversationLog } from '../../workspaces/agent-conversation-log.js'
import { createAgentConversationRoutes } from './agent-conversations.js'

describe('GET /api/agent-conversations', () => {
  it('returns the joined log projection', async () => {
    const query = vi.fn().mockResolvedValue({
      entries: [{ taskId: 'run-1', status: 'running' }],
      total: 1,
      page: 1,
      pageSize: 50,
      totalPages: 1,
    })
    const app = createAgentConversationRoutes({ query } as unknown as AgentConversationLog)

    const response = await app.request('/')

    expect(response.status).toBe(200)
    expect(query).toHaveBeenCalledWith({ page: 1, pageSize: 50 })
    await expect(response.json()).resolves.toMatchObject({
      entries: [{ taskId: 'run-1', status: 'running' }],
      total: 1,
    })
  })

  it('normalizes invalid pagination and caps page size', async () => {
    const query = vi.fn().mockResolvedValue({
      entries: [],
      total: 0,
      page: 1,
      pageSize: 100,
      totalPages: 1,
    })
    const app = createAgentConversationRoutes({ query } as unknown as AgentConversationLog)

    await app.request('/?page=-4&pageSize=5000')

    expect(query).toHaveBeenCalledWith({ page: 1, pageSize: 100 })
  })
})
