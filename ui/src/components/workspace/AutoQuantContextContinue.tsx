import type { ReactNode } from 'react'
import type { ConversationItem } from '../conversation/types'
import type { WebSessionPhase } from './api'
import { ContextContinueTip } from './ContextContinueDialog'
import { shouldOfferContextContinue } from './context-continue-offer'
import type { WorkspaceSource } from '../../tabs/types'
import './context-continue.css'

export function AutoQuantContextContinueController(props: {
  readonly source: Extract<WorkspaceSource, 'auto-quant'>
  readonly items: readonly ConversationItem[]
  readonly phase?: WebSessionPhase
  readonly children: (ui: {
    readonly tip: ReactNode
  }) => ReactNode
}): React.ReactElement {
  const offer = shouldOfferContextContinue({
    source: props.source,
    items: props.items,
    ...(props.phase ? { phase: props.phase } : {}),
  })

  return <>{props.children({
    tip: offer ? <ContextContinueTip /> : null,
  })}</>
}
