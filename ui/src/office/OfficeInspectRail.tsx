import type { ReactNode } from 'react'
import { useTranslation } from 'react-i18next'

import type { OfficeDrawerItem, OfficeFloorEmployee } from '../api/office'

export function OfficeInspectRail({
  employee,
  roomName,
  onOpen,
  onOpenDrawer,
  children,
}: {
  employee: OfficeFloorEmployee | null
  roomName?: string
  onOpen: () => void
  onOpenDrawer: (item: OfficeDrawerItem) => void
  children: ReactNode
}) {
  const { t } = useTranslation()

  return (
    <aside
      data-testid="office-inspect"
      className="flex w-full shrink-0 flex-col border-t border-border bg-background md:h-full md:w-72 md:overflow-y-auto md:border-l md:border-t-0"
    >
      <div className="border-b border-border px-4 py-3">
        {employee ? (
          <>
            <p className="text-sm font-medium text-foreground">{employee.name}</p>
            {roomName && (
              <p className="text-[11px] text-muted-foreground">{t('office.roomTitle', { name: roomName })}</p>
            )}
            <p className="mt-1 truncate font-mono text-[11px] text-muted-foreground">@{employee.resumeId}</p>
            <p className="mt-1 text-[11px] text-muted-foreground">
              {t(`office.mood.${employee.mood}`)}
              {employee.surface ? ` · ${employee.surface}` : ''}
            </p>
            <button
              type="button"
              className="oa-pressable mt-3 w-full rounded-md border border-border px-2 py-1.5 text-xs"
              onClick={onOpen}
            >
              {t('office.openSession')}
            </button>
            {employee.drawers.length > 0 && (
              <ul className="mt-3 space-y-1">
                {employee.drawers.map((item) => (
                  <li key={item.id}>
                    <button
                      type="button"
                      className="oa-pressable w-full truncate rounded px-1 py-1 text-left text-[11px] text-muted-foreground hover:text-foreground"
                      onClick={() => onOpenDrawer(item)}
                    >
                      {item.label}
                    </button>
                  </li>
                ))}
              </ul>
            )}
          </>
        ) : (
          <p className="text-sm text-muted-foreground">{t('office.selectDesk')}</p>
        )}
      </div>
      <div className="min-h-0 flex-1 overflow-y-auto px-4 py-3">
        <h3 className="mb-2 text-xs font-semibold text-muted-foreground">{t('office.timeline')}</h3>
        {children}
      </div>
    </aside>
  )
}
