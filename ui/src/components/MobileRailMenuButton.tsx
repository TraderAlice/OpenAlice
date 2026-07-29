import { useTranslation } from 'react-i18next'

export function MobileRailMenuButton({ onOpen }: { onOpen: () => void }) {
  const { t } = useTranslation()
  return (
    <button
      type="button"
      onClick={onOpen}
      className="oa-icon-action -ml-2 flex h-10 w-10 shrink-0 items-center justify-center rounded-md text-muted-foreground transition-colors hover:bg-accent hover:text-foreground"
      aria-label={t('nav.expandRail')}
    >
      <svg
        width="20"
        height="20"
        viewBox="0 0 20 20"
        fill="none"
        stroke="currentColor"
        strokeWidth="1.5"
        strokeLinecap="round"
        aria-hidden
      >
        <path d="M3 5h14M3 10h14M3 15h14" />
      </svg>
    </button>
  )
}
