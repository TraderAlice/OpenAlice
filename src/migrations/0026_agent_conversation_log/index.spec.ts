import { mkdtemp, readFile, rm, stat } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'

import { afterEach, describe, expect, it } from 'vitest'

import { ensureAgentConversationLog } from './index.js'

const dirs: string[] = []
afterEach(async () => {
  await Promise.all(dirs.splice(0).map((dir) => rm(dir, { recursive: true, force: true })))
})

describe('0026_agent_conversation_log', () => {
  it('creates one private empty event stream and is idempotent', async () => {
    const root = await mkdtemp(join(tmpdir(), 'migration-conversation-log-'))
    dirs.push(root)
    const path = join(root, 'state', 'agent-conversations.jsonl')

    await expect(ensureAgentConversationLog(root)).resolves.toEqual({ created: true })
    await expect(ensureAgentConversationLog(root)).resolves.toEqual({ created: false })
    await expect(readFile(path, 'utf8')).resolves.toBe('')
    if (process.platform !== 'win32') {
      expect((await stat(path)).mode & 0o777).toBe(0o600)
    }
  })
})
