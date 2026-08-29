// @vitest-environment jsdom

import { cleanup, render, screen } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'

import type { OfficeRoomSnapshot } from '../api/office'
import { i18n } from '../i18n'
import { OfficeCabinetWindow } from './OfficeCabinetWindow'

const group: OfficeRoomSnapshot = {
  workspace: { id: 'chat-1', tag: 'chat', harness: 'chat' },
  lastInteractionAt: 20,
  sleeping: false,
  employees: [
    {
      resumeId: 'codex-1',
      agent: 'codex',
      name: 'x1',
      mood: 'working',
      bubble: null,
      lastSeq: 2,
      lastInteractionAt: 20,
      drawers: [{
        id: 'older-report',
        kind: 'report',
        action: 'open_report',
        at: 10,
        label: 'Thesis memo',
        path: 'reports/thesis.md',
      }],
    },
    {
      resumeId: 'claude-1',
      agent: 'claude',
      name: 'c1',
      mood: 'idle',
      bubble: null,
      lastSeq: 1,
      lastInteractionAt: 10,
      drawers: [{
        id: 'newer-issue',
        kind: 'issue',
        action: 'open_issue',
        at: 20,
        label: 'Review queue',
        issueId: 'issue-1',
      }],
    },
  ],
}

beforeEach(async () => {
  await i18n.changeLanguage('en')
})

afterEach(cleanup)

describe('OfficeCabinetWindow', () => {
  it('keeps filed desk records inside Office until the player chooses an exit', async () => {
    const onOpenWorkspaceFiles = vi.fn()
    const onOpenRecord = vi.fn()
    const onClose = vi.fn()
    const { container } = render(
      <OfficeCabinetWindow
        group={group}
        roomName="Semis"
        onOpenWorkspaceFiles={onOpenWorkspaceFiles}
        onOpenRecord={onOpenRecord}
        onClose={onClose}
      />,
    )

    const dialog = screen.getByRole('dialog', { name: 'Filing cabinet · Semis' })
    expect(dialog.getAttribute('data-record-count')).toBe('2')
    expect(dialog.hasAttribute('data-empty')).toBe(false)
    expect(screen.getByText('2 filed records')).toBeTruthy()
    expect(screen.getAllByRole('listitem').map((item) => item.textContent)).toEqual([
      'Review queueFiled by c1Open',
      'Thesis memoFiled by x1Open',
    ])
    expect(container.querySelector<HTMLImageElement>('header img')?.src)
      .toContain('/office/hud/drawer-record-v2.png')

    const recordExit = screen.getByRole('button', { name: 'Open Review queue in Workspace' })
    expect(recordExit.querySelector<HTMLImageElement>('.oa-office-cabinet-window__destination img')?.src)
      .toContain('/office/hud/session-portal-v2.png')
    await userEvent.click(recordExit)
    expect(onOpenRecord).toHaveBeenCalledWith(group.employees[1], group.employees[1].drawers[0])
    expect(onOpenWorkspaceFiles).not.toHaveBeenCalled()

    await userEvent.click(screen.getByRole('button', { name: 'Enter Workspace files' }))
    expect(onOpenWorkspaceFiles).toHaveBeenCalledTimes(1)

    await userEvent.keyboard('{Escape}')
    expect(onClose).toHaveBeenCalledTimes(1)
  })

  it('uses the generated open drawer for a compact empty cabinet', () => {
    const emptyGroup: OfficeRoomSnapshot = {
      ...group,
      employees: group.employees.map((employee) => ({ ...employee, drawers: [] })),
    }
    const { container } = render(
      <OfficeCabinetWindow
        group={emptyGroup}
        roomName="Auto Quant"
        onOpenWorkspaceFiles={vi.fn()}
        onOpenRecord={vi.fn()}
        onClose={vi.fn()}
      />,
    )

    const dialog = screen.getByRole('dialog', { name: 'Filing cabinet · Auto Quant' })
    expect(dialog.getAttribute('data-empty')).toBe('true')
    expect(dialog.getAttribute('data-record-count')).toBe('0')
    expect(screen.getByText('No desk records have been filed here yet.')).toBeTruthy()
    expect(container.querySelector<HTMLImageElement>('.oa-office-cabinet-window__empty img')?.src)
      .toContain('/office/furniture/empty-cabinet-v1.png')
  })
})
