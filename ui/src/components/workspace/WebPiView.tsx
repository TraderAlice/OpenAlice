import { type ReactNode } from 'react'
import { LoaderCircle } from 'lucide-react'
import { PageTopBar } from '../PageTopBar'
import { ConversationView } from '../conversation/ConversationView'
import { useWebPiConversation } from './useWebPiConversation'

export { isConversationNearBottom as isWebPiNearBottom } from '../conversation/ConversationView'

interface Props {
  readonly wsId: string
  readonly sessionId: string
  readonly label?: string
  readonly headerActions?: ReactNode
  readonly onSessionLost: () => void
}

export function WebPiView(props: Props) {
  return <WebPiSession key={JSON.stringify([props.wsId, props.sessionId])} {...props} />
}

function WebPiSession({ wsId, sessionId, label, headerActions, onSessionLost }: Props) {
  const session = useWebPiConversation(wsId, sessionId)
  const { snapshot, busy } = session
  return <>
    <PageTopBar title={label ?? 'Conversation'} actions={headerActions}>
      {(busy || !snapshot || snapshot.phase === 'failed') && <span className="inline-flex items-center gap-1.5 text-xs text-muted-foreground">
        {(busy || !snapshot) && <LoaderCircle size={12} className="animate-spin" aria-hidden />}
        {snapshot?.phase ?? 'starting'}
      </span>}
    </PageTopBar>
    <ConversationView
      items={session.items}
      revision={snapshot?.revision ?? 0}
      busy={busy}
      ready={!!snapshot && snapshot.phase !== 'failed' && snapshot.phase !== 'starting' && snapshot.phase !== 'stopped'}
      placeholder="Message Pi…"
      empty={snapshot ? 'What should Alice work on next?' : 'Opening conversation…'}
      controls={<span className="px-1.5 py-1 text-xs text-muted-foreground" title="Pi browser adapter">Pi <span className="opacity-60">· Web preview</span></span>}
      status={snapshot?.phase === 'compacting' && <div className="conversation-compaction-status" role="status">
        <LoaderCircle size={14} className="animate-spin" aria-hidden />
        <div><strong>Compacting conversation context</strong><span>Pi is summarizing older history. Sending will resume when the compact finishes.</span></div>
      </div>}
      error={session.error ?? (snapshot?.phase === 'stopped' ? 'This session has stopped. Refresh the session to reconnect.' : null)}
      send={session.send}
      stop={session.stop}
      stopLabel="Stop Pi"
      retry={() => void session.refresh()}
      recover={onSessionLost}
    />
  </>
}
