import { afterEach, expect, it } from 'vitest'
import { workspaceJourney } from '../../helpers/workspace-journey.js'

let journey: Awaited<ReturnType<typeof workspaceJourney>> | undefined
afterEach(async () => { await journey?.close(); journey = undefined })

it('creates one broker-free Chat, decodes a local reply, and reuses its Session after restart', async () => {
  journey = await workspaceJourney()
  const { createUTAClient } = await import('@traderalice/uta-protocol')
  const { UTAManagerSDK } = await import('../../../src/services/uta-client/UTAManagerSDK.js')
  // A genuinely unavailable carrier; lite reads must not attempt this URL.
  const uta = new UTAManagerSDK({ client: createUTAClient({ baseUrl: 'http://127.0.0.1:1', timeoutMs: 100 }), unavailableReason: 'lite mode' })
  expect(await uta.listUTAs()).toEqual([])
  const [first, duplicate] = await Promise.all([
    journey.service.resolveOrCreateChatWorkspace(), journey.service.resolveOrCreateChatWorkspace(),
  ])
  if (!first.ok || !duplicate.ok) throw new Error('Chat bootstrap failed: ' + JSON.stringify([first, duplicate]))
  expect(duplicate.workspace.id).toBe(first.workspace.id)
  expect(journey.service.registry.list()).toHaveLength(1)
  const command = journey.fixture()
  const { createWorkspaceConversationControl } = await import('../../../src/workspaces/conversation-control.js')
  let conversation = createWorkspaceConversationControl(journey.service)
  const offered = await conversation.ask({ target: { kind: 'workspace', workspaceId: first.workspace.id }, agent: 'codex', prompt: 'hello', source: { kind: 'human' } })
  if (offered.status === 'unavailable') throw new Error(JSON.stringify(offered))
  const completed = await journey.settled(offered.taskId)
  expect(completed.output?.assistantPreview).toBe('LOCAL_REPLY')
  expect(command).toHaveBeenCalledTimes(1)
  const nativeId = journey.service.resumeRegistry.get(offered.resumeId)?.agentSessionId
  expect(nativeId).toBe('local-native-session')

  await journey.restart()
  const restored = await journey.service.resolveOrCreateChatWorkspace()
  if (!restored.ok) throw new Error('Chat restore failed')
  expect(restored.workspace.id).toBe(first.workspace.id)
  expect(journey.service.registry.list()).toHaveLength(1)
  expect(journey.service.resumeRegistry.get(offered.resumeId)?.agentSessionId).toBe(nativeId)
  const resumedCommand = journey.fixture()
  conversation = createWorkspaceConversationControl(journey.service)
  const resumed = await conversation.ask({ target: { kind: 'resume', resumeId: offered.resumeId }, prompt: 'again', source: { kind: 'human' } })
  if (resumed.status === 'unavailable') throw new Error(JSON.stringify(resumed))
  expect(resumed.resumeId).toBe(offered.resumeId)
  expect((await journey.settled(resumed.taskId)).output?.assistantPreview).toBe('LOCAL_REPLY')
  expect(resumedCommand).toHaveBeenCalledTimes(1)
  expect(resumedCommand.mock.calls[0][1]).toMatchObject({ resume: { sessionId: nativeId } })
  expect(journey.service.executions.list(offered.resumeId).map(row => row.phase)).toEqual(['ended', 'ended'])
}, 45_000)
