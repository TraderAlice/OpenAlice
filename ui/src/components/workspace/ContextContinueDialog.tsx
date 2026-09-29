import type { ReactElement } from 'react'
import { useTranslation } from 'react-i18next'
import './context-continue.css'

/** Soft AutoQuant tip rendered in the transcript — informational only. */
export function ContextContinueTip(): ReactElement {
  const { t } = useTranslation()
  return (
    <article
      className="conversation-message oa-context-continue-panel"
      role="status"
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
      </div>
    </article>
  )
}

/** @deprecated Prefer ContextContinueTip. */
export const ContextContinuePanel = ContextContinueTip
/** @deprecated Prefer ContextContinueTip. */
export const ContextContinueDialog = ContextContinueTip
