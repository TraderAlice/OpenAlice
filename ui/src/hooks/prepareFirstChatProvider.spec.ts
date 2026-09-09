import { beforeEach, expect, it, vi } from 'vitest'
import { initializeChatWorkspace, updateWorkspaceRuntimeDefaults } from '../components/workspace/api'
import { prepareFirstChatProvider } from './prepareFirstChatProvider'
vi.mock('../components/workspace/api', () => ({ initializeChatWorkspace: vi.fn(), updateWorkspaceRuntimeDefaults: vi.fn() }))
beforeEach(() => vi.clearAllMocks())
it('binds a chosen provider to fresh Chat without launching an Agent', async () => {
  vi.mocked(initializeChatWorkspace).mockResolvedValue({ id: 'chat-1' } as never)
  await prepareFirstChatProvider('mock-key', 'model-1')
  expect(updateWorkspaceRuntimeDefaults).toHaveBeenCalledWith('chat-1', {
    interactive: { defaultAgent: 'pi', agents: { pi: { accessMode: 'vault', credentialSlug: 'mock-key', model: 'model-1' } } },
    headless: { defaultAgent: null, agents: {} },
  })
})
it('preserves an existing explicit runtime choice', async () => {
  vi.mocked(initializeChatWorkspace).mockResolvedValue({ id: 'chat-1', runtimeSettings: {
    runtime: { interactive: { defaultAgent: 'codex', agents: {}, recent: {} } },
  } } as never)
  await prepareFirstChatProvider('mock-key')
  expect(updateWorkspaceRuntimeDefaults).not.toHaveBeenCalled()
})
it('does not overwrite malformed workspace settings', async () => {
  vi.mocked(initializeChatWorkspace).mockResolvedValue({ id: 'chat-1', runtimeSettingsError: 'invalid settings' } as never)
  await expect(prepareFirstChatProvider('mock-key')).rejects.toThrow('invalid settings')
  expect(updateWorkspaceRuntimeDefaults).not.toHaveBeenCalled()
})
