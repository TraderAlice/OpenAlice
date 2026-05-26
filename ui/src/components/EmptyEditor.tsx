/**
 * Shown in the main editor area when no tabs are open. Phase-2 minimal:
 * logo + a couple of plain-text pointers so a fresh user knows where to
 * start. The full onboarding system (guided setup, status checks, etc.)
 * is a separate effort that will replace this surface.
 */
import { useTranslation } from 'react-i18next'

export function EmptyEditor() {
  const { t } = useTranslation()
  return (
    <div className="flex flex-col items-center justify-center h-full select-none px-6 gap-5 text-center">
      <img
        src="/alice.ico"
        alt="OpenAlice"
        className="w-16 h-16 rounded-2xl ring-1 ring-accent/25 shadow-[0_0_18px_rgba(88,166,255,0.18)]"
        draggable={false}
      />
      <div className="space-y-2 max-w-md">
        <h2 className="text-base font-semibold text-text">{t('emptyEditor.title', 'OpenAlice')}</h2>
        <p className="text-[13px] text-text-muted leading-relaxed">
          {t('emptyEditor.clickActivityBar', 'Click an icon on the activity bar to open its sidebar, then pick something from the sidebar to open it as a tab.')}
        </p>
        <p className="text-[12px] text-text-muted/70 leading-relaxed">
          {t('emptyEditor.firstTimeHint', 'First time here? Open Settings → AI Provider to configure a model, then jump back to Chat.')}
        </p>
      </div>
    </div>
  )
}
