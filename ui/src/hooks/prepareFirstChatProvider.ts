import { initializeChatWorkspace, updateWorkspaceRuntimeDefaults } from '../components/workspace/api'

/** Apply an explicitly chosen onboarding provider only to an unconfigured Chat. */
export async function prepareFirstChatProvider(credentialSlug: string, model?: string) {
  const workspace = await initializeChatWorkspace()
  const existing = workspace.runtimeSettings?.runtime
  const interactive = existing?.interactive
  if (workspace.runtimeSettingsError) throw new Error(workspace.runtimeSettingsError)
  if (interactive?.defaultAgent || interactive?.recent.agent || Object.keys(interactive?.agents ?? {}).length > 0) return
  await updateWorkspaceRuntimeDefaults(workspace.id, {
    interactive: { defaultAgent: 'pi', agents: { pi: { accessMode: 'vault', credentialSlug, ...(model ? { model } : {}) } } },
    headless: { defaultAgent: existing?.headless.defaultAgent ?? null, agents: existing?.headless.agents ?? {} },
  })
}
