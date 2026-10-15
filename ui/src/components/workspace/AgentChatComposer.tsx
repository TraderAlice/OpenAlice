import { ChatComposer, type ChatComposerProps } from '../conversation/ChatComposer'
import { AgentLaunchDetails, AgentLaunchSelectors } from './AgentLaunchControls'
import type { AgentLaunchConfigState } from '../../hooks/useAgentLaunchConfig'

/** Start and live Chat share the entire composer; their owners supply state and actions. */
export function AgentChatComposer({ config, onConfigureProvider, configurationDisabled = false,
  hasWorkspaceTarget = true, ...composer }: ChatComposerProps & {
  config: AgentLaunchConfigState; onConfigureProvider(): void;
  configurationDisabled?: boolean; hasWorkspaceTarget?: boolean;
}) {
  return <ChatComposer {...composer} controls={
    <fieldset disabled={configurationDisabled} inert={configurationDisabled} className="min-w-0 flex-1 disabled:opacity-60">
      <AgentLaunchSelectors config={config} showRuntime={false} toolbar combinedAi disabled={configurationDisabled} onConfigureProvider={onConfigureProvider} />
    </fieldset>
  } details={<>
    <AgentLaunchDetails config={config} hasWorkspaceTarget={hasWorkspaceTarget} showScopeDisclosure={false}
      className="mx-1 mt-1.5 border-t border-border/45 px-1 pt-2" />
    {composer.details}
  </>} />
}
