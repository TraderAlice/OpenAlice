import { useTranslation } from 'react-i18next'

export function MobileRailMenuButton({ onOpen }: { onOpen: () => void }) {
  const { t } = useTranslation()
  return (
    <button
      type="button"
      onClick={onOpen}
      className="text-muted-foreground hover:text-foreground p-1 -ml-1"
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
