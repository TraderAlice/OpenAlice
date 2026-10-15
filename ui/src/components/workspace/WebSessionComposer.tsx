import { useEffect } from 'react'
import type { AgentInfo, PausedSessionRuntimeUpdate, SessionRecord } from './api'
import { AgentChatComposer } from './AgentChatComposer'
import type { ChatComposerProps } from '../conversation/ChatComposer'
import { useWebSessionModelConfig } from '../../hooks/useWebSessionModelConfig'
import { useWorkspace } from '../../tabs/store'

export function WebSessionComposer(props: {
  composer: ChatComposerProps;
  workspaceId: string; record: SessionRecord; agents: readonly AgentInfo[]; busy: boolean;
  reconfigure(update: PausedSessionRuntimeUpdate): Promise<void>;
  onReadyChange(ready: boolean): void;
}) {
  const busy = props.busy || !!props.composer.pending
  const model = useWebSessionModelConfig({ ...props, busy })
  useEffect(() => { props.onReadyChange(!model.dirty && !model.error) }, [model.dirty, model.error, props.onReadyChange])
  const openOrFocus = useWorkspace(state => state.openOrFocus)
  return <AgentChatComposer {...props.composer} config={model.config} configurationDisabled={busy}
    canSend={props.composer.canSend && !model.dirty && !model.error}
    onConfigureProvider={() => openOrFocus({ kind: 'settings', params: { category: 'ai-provider' } })}
    details={model.error && <div role="alert" className="px-2 text-xs text-destructive">
      {model.error} <button type="button" onClick={model.retry}>Retry configuration</button>
    </div>} />
}
