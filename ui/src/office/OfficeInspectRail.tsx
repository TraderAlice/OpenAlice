import type { ReactNode } from 'react'
import { ArrowUpRight, Crosshair, FileText, X } from 'lucide-react'
import { useTranslation } from 'react-i18next'

import type { OfficeDrawerItem, OfficeFloorEmployee } from '../api/office'
import { officeBubbleText } from './bubble-text'
import { OfficeEmployeeSprite } from './OfficeEmployeeSprite'
import { officeCoworkerLabel } from './label'
import { useReducedMotion } from './use-reduced-motion'

export function OfficeInspectRail({
  employee,
  roomName,
  onOpen,
  onOpenDrawer,
  onClose,
  children,
}: {
  employee: OfficeFloorEmployee | null
  roomName?: string
  onOpen: () => void
  onOpenDrawer: (item: OfficeDrawerItem) => void
  onClose?: () => void
  children?: ReactNode
}) {
  const { t } = useTranslation()
  const reducedMotion = useReducedMotion()

  return (
    <aside
      role="dialog"
      aria-modal="true"
      aria-label={employee ? officeCoworkerLabel(employee) : t('office.employeeFile')}
      data-testid="office-inspect"
      className="oa-office-inspect oa-office-window"
      onKeyDown={(event) => {
        if (event.key === 'Escape') onClose?.()
      }}
    >
      {onClose && (
        <button type="button" autoFocus className="oa-office-window__close" aria-label={t('common.close')} onClick={onClose}>
          <X size={15} />
        </button>
      )}
      <div className="oa-office-inspect__profile">
        {employee ? (
          <>
            <div className="oa-office-inspect__portrait" aria-hidden>
              <OfficeEmployeeSprite
                mood={employee.mood}
                reducedMotion={reducedMotion}
                label={officeCoworkerLabel(employee)}
                scale={0.34}
              />
            </div>
            <div className="oa-office-inspect__dialogue">
              <div className="oa-office-inspect__kicker">
                <span className="oa-office-live-dot" aria-hidden />
                {t('office.employeeFile')}
              </div>
              <div className="oa-office-inspect__identity">
                <p>{officeCoworkerLabel(employee)}</p>
                <span>@{employee.resumeId}</span>
              </div>
              <blockquote>
                {employee.bubble
                  ? officeBubbleText(employee.bubble, t)
                  : `${t(`office.mood.${employee.mood}`)} · ${employee.surface || roomName || '—'}`}
              </blockquote>
            </div>
            <dl className="oa-office-inspect__facts">
              <div>
                <dt>{t('office.status')}</dt>
                <dd data-mood={employee.mood}>
                  <span aria-hidden />
                  {t(`office.mood.${employee.mood}`)}
                </dd>
              </div>
              <div>
                <dt>{t('office.location')}</dt>
                <dd>{roomName || '—'}</dd>
              </div>
              <div>
                <dt>{t('office.surface')}</dt>
                <dd>{employee.surface || '—'}</dd>
              </div>
            </dl>
            <div className="oa-office-inspect__actions">
              <button
                type="button"
                className="oa-office-inspect__open"
                onClick={onOpen}
              >
                {t('office.openSession')}
                <ArrowUpRight size={14} />
              </button>
            </div>
            {employee.drawers.length > 0 && (
              <div className="oa-office-drawers">
                <p>{t('office.deskDrawers')}</p>
                <ul>
                  {employee.drawers.map((item) => (
                    <li key={item.id}>
                      <button
                        type="button"
                        className="oa-office-drawer"
                        onClick={() => onOpenDrawer(item)}
                      >
                        <FileText size={13} />
                        <span>{item.label}</span>
                      </button>
                    </li>
                  ))}
                </ul>
              </div>
            )}
          </>
        ) : (
          <div className="oa-office-inspect__empty">
            <Crosshair size={24} strokeWidth={1.5} />
            <p>{t('office.selectDesk')}</p>
            <span>{t('office.selectDeskHint')}</span>
          </div>
        )}
      </div>
      {children && (
        <div className="oa-office-inspect__timeline">
          <div className="oa-office-inspect__timeline-title">
            <span>{t('office.timeline')}</span>
            <span className="oa-office-live-dot" aria-hidden />
          </div>
          {children}
        </div>
      )}
    </aside>
  )
}
