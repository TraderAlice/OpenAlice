import { useLayoutEffect, useMemo, useRef, useState, type ReactElement, type RefObject } from 'react'
import { useTranslation } from 'react-i18next'
import { Button } from '../ui/button'
import { Textarea } from '../ui/textarea'
import type { ConversationItem } from '../conversation/types'
import {
  applySuggestionToDraft,
  buildAliceSuggestions,
  CONTEXT_CONTINUE_SCAFFOLD,
  countUserTurns,
  type ContextContinueSuggestion,
  writeDismissState,
} from './archive-and-continue'
import { clearDockDismissStyles, playDockDismissAnimation } from './context-continue-motion'
import './context-continue.css'

/**
 * Soft AutoQuant continue offer rendered in the transcript like a normal
 * turn — no modal overlay, composer stays free. "Later" docks into the
 * header affordance.
 */
export function ContextContinuePanel(props: {
  readonly open: boolean
  readonly sessionId: string
  readonly items: readonly ConversationItem[]
  readonly busy?: boolean
  readonly error?: string | null
  readonly dockAnchorRef?: RefObject<HTMLElement | null>
  readonly onOpenChange: (open: boolean) => void
  readonly onDismissDocked?: () => void
  readonly onConfirm: (consensus: string) => Promise<void>
}): ReactElement {
  const { t } = useTranslation()
  const surfaceRef = useRef<HTMLElement>(null)
  const docking = useRef(false)
  const [dockingUi, setDockingUi] = useState(false)
  const [draft, setDraft] = useState(CONTEXT_CONTINUE_SCAFFOLD)
  const [suggestions, setSuggestions] = useState<ContextContinueSuggestion[] | null>(null)
  const [accepted, setAccepted] = useState<ReadonlySet<string>>(() => new Set())
  const [working, setWorking] = useState(false)
  const userTurns = useMemo(() => countUserTurns(props.items), [props.items])
  const visible = props.open || dockingUi

  useLayoutEffect(() => {
    if (!props.open) return
    const surface = surfaceRef.current
    if (!surface) return
    clearDockDismissStyles(surface)
    surface.scrollIntoView({ block: 'nearest', behavior: 'smooth' })
  }, [props.open])

  const finishDismiss = () => {
    writeDismissState(props.sessionId, userTurns)
    props.onOpenChange(false)
  }

  const dismiss = async () => {
    if (docking.current || working) return
    docking.current = true
    setDockingUi(true)
    try {
      // Let React paint `is-docking` before measuring flight geometry.
      await new Promise<void>((resolve) => requestAnimationFrame(() => resolve()))
      const surface = surfaceRef.current
      const anchor = props.dockAnchorRef?.current?.querySelector<HTMLElement>('[data-oa-context-continue-dock]')
        ?? props.dockAnchorRef?.current
      if (surface && anchor) {
        await playDockDismissAnimation(surface, anchor)
        props.onDismissDocked?.()
      }
      finishDismiss()
    } finally {
      docking.current = false
      setDockingUi(false)
    }
  }

  const askAlice = () => {
    setSuggestions(buildAliceSuggestions(props.items))
  }

  const accept = (suggestion: ContextContinueSuggestion) => {
    setDraft((current) => applySuggestionToDraft(current, suggestion))
    setAccepted((prev) => new Set([...prev, suggestion.id]))
  }

  const confirm = async () => {
    const consensus = draft.trim()
    if (!consensus || working || docking.current) return
    setWorking(true)
    try {
      await props.onConfirm(consensus)
      writeDismissState(props.sessionId, userTurns)
      props.onOpenChange(false)
    } finally {
      setWorking(false)
    }
  }

  return (
    <article
      ref={surfaceRef}
      hidden={!visible}
      className={`conversation-message oa-context-continue-panel${dockingUi ? ' is-docking' : ''}${visible ? '' : ' oa-context-continue-panel--idle'}`}
      role="region"
      aria-labelledby="oa-context-continue-title"
    >
      <div className="conversation-message-body">
        <header className="oa-context-continue-panel__header">
          <h3 id="oa-context-continue-title" className="oa-context-continue-panel__title">
            {t('contextContinue.title')}
          </h3>
          <p className="oa-context-continue-panel__description">
            {t('contextContinue.description')}
          </p>
        </header>

        <p className="oa-context-continue-panel__hint">{t('contextContinue.scaffoldHint')}</p>
        <Textarea
          value={draft}
          onChange={(event) => setDraft(event.target.value)}
          rows={12}
          className="oa-context-continue-panel__draft min-h-[12rem] resize-y font-mono text-xs leading-relaxed"
          aria-label={t('contextContinue.draftLabel')}
        />

        <div className="oa-context-continue-panel__alice">
          <Button type="button" variant="secondary" size="sm" onClick={askAlice} disabled={working || props.busy}>
            {t('contextContinue.askAlice')}
          </Button>
          <span className="text-xs text-muted-foreground">{t('contextContinue.askAliceHint')}</span>
        </div>

        {suggestions && suggestions.length > 0 && (
          <ul className="oa-context-continue-panel__suggestions">
            {suggestions.map((suggestion) => {
              const taken = accepted.has(suggestion.id)
              return (
                <li key={suggestion.id} className="oa-context-continue-panel__suggestion">
                  <p className="min-w-0 flex-1 text-sm text-foreground/90">{suggestion.text}</p>
                  <Button
                    type="button"
                    variant="ghost"
                    size="sm"
                    className="shrink-0"
                    disabled={taken || working}
                    onClick={() => accept(suggestion)}
                  >
                    {taken ? t('contextContinue.accepted') : t('contextContinue.accept')}
                  </Button>
                </li>
              )
            })}
          </ul>
        )}

        {props.error && <p className="text-sm text-destructive" role="alert">{props.error}</p>}

        <footer className="oa-context-continue-panel__footer">
          <Button type="button" variant="ghost" onClick={() => void dismiss()} disabled={working}>
            {t('contextContinue.later')}
          </Button>
          <Button type="button" onClick={() => void confirm()} disabled={working || !draft.trim() || !!props.busy}>
            {working ? t('contextContinue.working') : t('contextContinue.confirm')}
          </Button>
        </footer>
      </div>
    </article>
  )
}

/** @deprecated Prefer ContextContinuePanel. */
export const ContextContinueDialog = ContextContinuePanel
