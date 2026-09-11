import { useTranslation } from 'react-i18next'

import { officePixelImg } from './furniture'
import { OFFICE_HUD_ASSETS } from './hud-assets'

export function OfficeConnectionScreen({
  error,
  retrying,
  onRetry,
}: {
  error?: string | null
  retrying?: boolean
  onRetry: () => void
}) {
  const { t } = useTranslation()
  const failed = Boolean(error)
  const busy = !failed || retrying

  return (
    <div className="oa-office-layout">
      <div className="oa-office-main">
        <section
          className="oa-office-connection-screen"
          data-state={failed ? 'error' : 'loading'}
          data-testid="office-connection-screen"
          role={failed ? 'alert' : 'status'}
          aria-busy={busy}
        >
          <div className="oa-office-connection-screen__receiver" aria-hidden>
            <span />
            <span />
            <img src={OFFICE_HUD_ASSETS.signalReceiver} alt="" style={officePixelImg} />
          </div>
          <p className="oa-office-kicker">{t('office.connectionKicker')}</p>
          <h2>{failed ? t('office.loadFailed') : t('office.loadingFloor')}</h2>
          <p>{failed ? t('office.connectionFailedHint') : t('office.loadingFloorHint')}</p>
          <div className="oa-office-connection-screen__meter" aria-hidden>
            {Array.from({ length: 8 }, (_, index) => <span key={index} />)}
          </div>
          {failed && (
            <button type="button" disabled={retrying} onClick={onRetry}>
              <img src={OFFICE_HUD_ASSETS.resetCompass} alt="" aria-hidden style={officePixelImg} />
              {retrying ? t('office.reconnectingFloor') : t('office.retryFloor')}
            </button>
          )}
          {failed && error && <small title={error}>{error}</small>}
        </section>
      </div>
    </div>
  )
}

export function OfficeConnectionBanner({
  error,
  retrying,
  onRetry,
}: {
  error: string
  retrying?: boolean
  onRetry: () => void
}) {
  const { t } = useTranslation()

  return (
    <div className="oa-office-connection-banner" role="alert">
      <img src={OFFICE_HUD_ASSETS.signalReceiver} alt="" aria-hidden style={officePixelImg} />
      <span>
        <strong>{t('office.connectionLost')}</strong>
        <small title={error}>{error}</small>
      </span>
      <button type="button" disabled={retrying} onClick={onRetry}>
        {retrying ? t('office.reconnectingFloor') : t('office.retryFloor')}
      </button>
    </div>
  )
}
