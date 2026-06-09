import { ArrowUp, Boxes, Paperclip, Sparkles } from 'lucide-react'
import { useTranslation } from 'react-i18next'

/**
 * Default editor surface when no tab is open.
 *
 * The empty state is intentionally a product surface, not onboarding copy:
 * the central composer is the primary object on screen and the surrounding
 * canvas stays quiet until Alice has something to render.
 */
export function EmptyEditor() {
  const { t } = useTranslation()

  return (
    <div className="relative h-full min-h-0 overflow-hidden bg-bg text-text select-none">
      <div className="absolute inset-x-0 top-0 h-40 bg-gradient-to-b from-white/[0.035] to-transparent" />
      <div className="absolute inset-x-0 bottom-0 h-[38%] bg-gradient-to-t from-black/35 to-transparent" />

      <div className="absolute inset-0 opacity-[0.08] [background-image:linear-gradient(to_right,#ffffff_1px,transparent_1px),linear-gradient(to_bottom,#ffffff_1px,transparent_1px)] [background-size:96px_96px]" />

      <div className="absolute left-1/2 top-[29%] h-[26rem] w-[26rem] -translate-x-1/2 rounded-full border border-white/[0.045]" />
      <div className="absolute left-1/2 top-[38%] h-12 w-80 -translate-x-[43%] rotate-[-45deg] rounded-xl bg-white/[0.025]" />
      <div className="absolute left-1/2 top-[43%] h-10 w-64 -translate-x-[52%] rotate-[-45deg] rounded-xl bg-white/[0.02]" />
      <div className="absolute left-1/2 top-[48%] h-10 w-44 -translate-x-[62%] rotate-[-45deg] rounded-xl bg-white/[0.018]" />

      <div className="relative z-10 flex h-full flex-col items-center justify-center px-6">
        <div className="w-full max-w-[890px] rounded-xl border border-border bg-bg-tertiary/88 shadow-[0_34px_90px_rgba(0,0,0,0.48)] backdrop-blur-sm">
          <label htmlFor="ask-alice-input" className="sr-only">{t('home.askLabel')}</label>
          <textarea
            id="ask-alice-input"
            rows={2}
            placeholder={t('home.askPlaceholder')}
            className="block h-20 w-full resize-none bg-transparent px-6 py-5 text-[20px] font-medium leading-7 text-text outline-none placeholder:text-text-muted/55"
          />

          <div className="flex h-14 items-center gap-3 border-t border-border/80 px-5">
            <button
              type="button"
              className="inline-flex h-8 items-center gap-2 rounded-lg px-2.5 text-[13px] font-semibold text-text-muted transition-colors hover:bg-white/[0.045] hover:text-text"
            >
              <Boxes size={15} strokeWidth={1.8} />
              <span>{t('home.skills')}</span>
            </button>

            <div className="inline-flex h-7 items-center gap-2 rounded-full border border-border bg-white/[0.035] px-3 text-[12px] font-medium text-text-muted">
              <span className="h-1.5 w-1.5 rounded-full bg-accent shadow-[0_0_12px_rgba(35,185,154,0.65)]" />
              <span>{t('home.agentRuntime')}</span>
            </div>

            <div className="ml-auto flex items-center gap-2">
              <button
                type="button"
                aria-label={t('home.attachContext')}
                className="flex h-8 w-8 items-center justify-center rounded-full text-text-muted transition-colors hover:bg-white/[0.045] hover:text-text"
              >
                <Paperclip size={16} strokeWidth={1.9} />
              </button>
              <button
                type="button"
                aria-label={t('home.submit')}
                className="flex h-9 w-9 items-center justify-center rounded-full bg-white/[0.07] text-text-muted transition-colors hover:bg-white/[0.11] hover:text-text"
              >
                <ArrowUp size={17} strokeWidth={2.1} />
              </button>
            </div>
          </div>
        </div>

        <div className="mt-3 flex w-full max-w-[872px] items-center gap-3 rounded-full border border-border/80 bg-[#0f1012]/90 px-3 py-2 text-[13px] shadow-[0_18px_44px_rgba(0,0,0,0.3)]">
          <span className="rounded-full border border-border bg-bg-tertiary px-2.5 py-1 font-mono text-[10px] font-medium text-text-muted">
            {t('home.newBadge')}
          </span>
          <span className="flex-1 truncate font-semibold text-text/85">
            {t('home.sharedSkills')}
          </span>
          <button type="button" className="hidden text-text-muted transition-colors hover:text-text sm:inline">
            {t('home.dismiss')}
          </button>
          <button
            type="button"
            className="inline-flex h-7 items-center gap-1.5 rounded-full bg-white/[0.08] px-3 text-[12px] font-semibold text-text transition-colors hover:bg-white/[0.12]"
          >
            <Sparkles size={13} strokeWidth={1.8} />
            {t('home.shareSkills')}
          </button>
        </div>
      </div>
    </div>
  )
}
