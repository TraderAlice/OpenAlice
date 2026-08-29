import { useMemo, useRef, useState } from 'react'
import { useTranslation } from 'react-i18next'

import type { OfficeDrawerItem, OfficeFloorEmployee, OfficeRoomSnapshot } from '../api/office'
import { employeesForOffice } from './desk-slots'
import { OFFICE_FURNITURE, officePixelImg } from './furniture'
import { nextOfficeGridIndex } from './grid-navigation'
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
  const recordKey = ({ employee, item }: CabinetRecord) => `${employee.resumeId}:${item.id}`
  const initialFocusKey = records[0] ? recordKey(records[0]) : null
  const [focusedRecordKey, setFocusedRecordKey] = useState(initialFocusKey)
  const closeButtonRef = useRef<HTMLButtonElement>(null)
  const recordListRef = useRef<HTMLUListElement>(null)
  const workspaceFilesRef = useRef<HTMLButtonElement>(null)
  const focusedRecordButton = () => Array.from(
    recordListRef.current?.querySelectorAll<HTMLButtonElement>('button[data-record-key]') ?? [],
  ).find((button) => button.dataset.recordKey === focusedRecordKey)

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
        <div className="oa-office-window__title">
          <img src={OFFICE_HUD_ASSETS.drawerRecord} alt="" aria-hidden style={officePixelImg} />
          <span className="oa-office-window__title-copy">
            <span className="oa-office-window__title-room">{roomName}</span>
            <span className="oa-office-window__title-separator" aria-hidden>·</span>
            <span className="oa-office-window__title-kind">{t('office.cabinet')}</span>
          </span>
        </div>
        <button
          type="button"
          ref={closeButtonRef}
          aria-label={t('common.close')}
          onClick={onClose}
          onKeyDown={(event) => {
            if (event.key !== 'Tab') return
            event.preventDefault()
            if (event.shiftKey) workspaceFilesRef.current?.focus()
            else if (records.length > 0) focusedRecordButton()?.focus()
            else workspaceFilesRef.current?.focus()
          }}
        >
          <img src={OFFICE_HUD_ASSETS.windowClose} alt="" aria-hidden style={officePixelImg} />
        </button>
      </header>

      <div className="oa-office-cabinet-window__body">
        <div className="oa-office-cabinet-window__summary">
          <span>{t('office.cabinetRecords', { count: records.length })}</span>
          <small>{t('office.cabinetInspectHint')}</small>
        </div>

        {records.length > 0 ? (
          <ul
            ref={recordListRef}
            className="oa-office-cabinet-window__records"
            aria-label={t('office.cabinet')}
            onKeyDown={(event) => {
              if (event.key === 'Tab') {
                event.preventDefault()
                if (event.shiftKey) closeButtonRef.current?.focus()
                else workspaceFilesRef.current?.focus()
                return
              }
              const direction = ({
                ArrowLeft: 'left',
                ArrowRight: 'right',
                ArrowUp: 'up',
                ArrowDown: 'down',
              } as const)[event.key]
              const buttons = Array.from(
                event.currentTarget.querySelectorAll<HTMLButtonElement>('button[data-record-key]'),
              )
              const currentIndex = buttons.indexOf(document.activeElement as HTMLButtonElement)
              if (currentIndex < 0) return
              let nextIndex = currentIndex
              if (direction) {
                nextIndex = nextOfficeGridIndex(
                  buttons.map((button) => button.getBoundingClientRect()),
                  currentIndex,
                  direction,
                )
              } else if (event.key === 'Home') {
                nextIndex = 0
              } else if (event.key === 'End') {
                nextIndex = buttons.length - 1
              } else {
                return
              }
              event.preventDefault()
              buttons[nextIndex]?.focus()
            }}
          >
            {records.map((record: CabinetRecord) => {
              const { employee, item } = record
              const key = recordKey(record)
              return (
                <li key={key}>
                  <button
                    type="button"
                    autoFocus={key === initialFocusKey}
                    data-record-key={key}
                    tabIndex={key === focusedRecordKey ? 0 : -1}
                    aria-label={t('office.drawerOpenRecord', { record: item.label })}
                    onFocus={() => setFocusedRecordKey(key)}
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
              )
            })}
          </ul>
        ) : (
          <div className="oa-office-cabinet-window__empty">
            <img src={OFFICE_FURNITURE.generated.emptyCabinet} alt="" aria-hidden style={officePixelImg} />
            <p>{t('office.cabinetEmpty')}</p>
          </div>
        )}

        <button
          type="button"
          ref={workspaceFilesRef}
          autoFocus={records.length === 0}
          className="oa-office-cabinet-window__open"
          onClick={onOpenWorkspaceFiles}
          onKeyDown={(event) => {
            if (event.key !== 'Tab') return
            event.preventDefault()
            if (event.shiftKey && records.length > 0) focusedRecordButton()?.focus()
            else closeButtonRef.current?.focus()
          }}
        >
          <span>{t('office.openWorkspaceFiles')}</span>
          <img src={OFFICE_HUD_ASSETS.sessionPortal} alt="" aria-hidden style={officePixelImg} />
        </button>
      </div>
    </section>
  )
}
