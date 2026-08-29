import { useMemo } from 'react'
import { useTranslation } from 'react-i18next'

import type { OfficeDrawerItem, OfficeFloorEmployee, OfficeRoomSnapshot } from '../api/office'
import { employeesForOffice } from './desk-slots'
import { OFFICE_FURNITURE, officePixelImg } from './furniture'
import { OFFICE_HUD_ASSETS } from './hud-assets'
import { officeCoworkerLabel } from './label'

interface CabinetRecord {
  employee: OfficeFloorEmployee
  item: OfficeDrawerItem
}

export function OfficeCabinetWindow({
  group,
  roomName,
  onOpenWorkspaceFiles,
  onOpenRecord,
  onClose,
}: {
  group: OfficeRoomSnapshot
  roomName: string
  onOpenWorkspaceFiles: () => void
  onOpenRecord: (employee: OfficeFloorEmployee, item: OfficeDrawerItem) => void
  onClose: () => void
}) {
  const { t } = useTranslation()
  const records = useMemo(() => employeesForOffice(group.employees)
    .flatMap((employee) => employee.drawers.map((item) => ({ employee, item })))
    .sort((a, b) => b.item.at - a.item.at), [group.employees])

  return (
    <section
      role="dialog"
      aria-modal="true"
      aria-label={`${t('office.cabinet')} · ${roomName}`}
      data-testid="office-cabinet-window"
      data-empty={records.length === 0 || undefined}
      data-record-count={records.length}
      className="oa-office-window oa-office-cabinet-window"
      onKeyDown={(event) => {
        if (event.key === 'Escape') onClose()
      }}
    >
      <header className="oa-office-window__header">
        <div>
          <img src={OFFICE_HUD_ASSETS.drawerRecord} alt="" aria-hidden style={officePixelImg} />
          <span>{roomName} · {t('office.cabinet')}</span>
        </div>
        <button type="button" autoFocus aria-label={t('common.close')} onClick={onClose}>
          <img src={OFFICE_HUD_ASSETS.windowClose} alt="" aria-hidden style={officePixelImg} />
        </button>
      </header>

      <div className="oa-office-cabinet-window__body">
        <div className="oa-office-cabinet-window__summary">
          <span>{t('office.cabinetRecords', { count: records.length })}</span>
          <small>{t('office.cabinetInspectHint')}</small>
        </div>

        {records.length > 0 ? (
          <ul className="oa-office-cabinet-window__records">
            {records.map(({ employee, item }: CabinetRecord) => (
              <li key={`${employee.resumeId}:${item.id}`}>
                <button
                  type="button"
                  aria-label={t('office.drawerOpenRecord', { record: item.label })}
                  onClick={() => onOpenRecord(employee, item)}
                >
                  <img src={OFFICE_HUD_ASSETS.drawerRecord} alt="" aria-hidden style={officePixelImg} />
                  <span>
                    <strong>{item.label}</strong>
                    <small>{t('office.cabinetRecordOwner', { name: officeCoworkerLabel(employee) })}</small>
                  </span>
                  <span className="oa-office-cabinet-window__destination" aria-hidden>
                    <img src={OFFICE_HUD_ASSETS.sessionPortal} alt="" style={officePixelImg} />
                    <small>{t('office.drawerRecordAction')}</small>
                  </span>
                </button>
              </li>
            ))}
          </ul>
        ) : (
          <div className="oa-office-cabinet-window__empty">
            <img src={OFFICE_FURNITURE.generated.emptyCabinet} alt="" aria-hidden style={officePixelImg} />
            <p>{t('office.cabinetEmpty')}</p>
          </div>
        )}

        <button
          type="button"
          className="oa-office-cabinet-window__open"
          onClick={onOpenWorkspaceFiles}
        >
          <span>{t('office.openWorkspaceFiles')}</span>
          <img src={OFFICE_HUD_ASSETS.sessionPortal} alt="" aria-hidden style={officePixelImg} />
        </button>
      </div>
    </section>
  )
}
