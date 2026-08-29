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
      awake: true,
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
      awake: false,
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
    const recordText = screen.getAllByRole('listitem').map((item) => item.textContent ?? '')
    expect(recordText[0]).toContain('Review queueIssue')
    expect(recordText[0]).toContain('Filed by c1Open')
    expect(recordText[1]).toContain('Thesis memoReport')
    expect(recordText[1]).toContain('Filed by x1Open')
    expect(container.querySelector<HTMLImageElement>('header img')?.src)
      .toContain('/office/hud/drawer-record-v2.png')
    expect(container.querySelector('.oa-office-window__title-room')?.textContent).toBe('Semis')
    expect(container.querySelector('.oa-office-window__title-kind')?.textContent).toBe('Filing cabinet')
    expect(container.querySelector('.oa-office-window__title-separator')?.textContent).toBe('·')

    const recordButtons = screen.getAllByRole('button', { name: /Open .*, (Issue|Report), .* in Workspace/ })
    expect(document.activeElement).toBe(recordButtons[0])
    vi.spyOn(recordButtons[0]!, 'getBoundingClientRect').mockReturnValue({
      left: 0, right: 100, top: 0, bottom: 60,
    } as DOMRect)
    vi.spyOn(recordButtons[1]!, 'getBoundingClientRect').mockReturnValue({
      left: 120, right: 220, top: 0, bottom: 60,
    } as DOMRect)
    await userEvent.keyboard('{ArrowRight}')
    expect(document.activeElement).toBe(recordButtons[1])
    await userEvent.keyboard('{Home}')
    expect(document.activeElement).toBe(recordButtons[0])
    await userEvent.keyboard('{End}')
    expect(document.activeElement).toBe(recordButtons[1])

    const workspaceFiles = screen.getByRole('button', { name: 'Enter Workspace files' })
    const close = screen.getByRole('button', { name: 'Close' })
    await userEvent.keyboard('{Tab}')
    expect(document.activeElement).toBe(workspaceFiles)
    await userEvent.keyboard('{Tab}')
    expect(document.activeElement).toBe(close)
    await userEvent.keyboard('{Tab}')
    expect(document.activeElement).toBe(recordButtons[1])

    const recordExit = screen.getByRole('button', { name: /Open Review queue, Issue, .* in Workspace/ })
    expect(recordExit.querySelector<HTMLImageElement>('.oa-office-cabinet-window__destination img')?.src)
      .toContain('/office/hud/session-portal-v2.png')
    await userEvent.click(recordExit)
    expect(onOpenRecord).toHaveBeenCalledWith(group.employees[1], group.employees[1].drawers[0])
    expect(onOpenWorkspaceFiles).not.toHaveBeenCalled()

    await userEvent.click(workspaceFiles)
    expect(onOpenWorkspaceFiles).toHaveBeenCalledTimes(1)

    await userEvent.keyboard('{Escape}')
    expect(onClose).toHaveBeenCalledTimes(1)
  })

  it('presents Inbox artifacts as deliveries instead of raw record ids', () => {
    const inboxId = 'a74b15cc-c443-4137-960e-fca08fe0c0a4'
    const inboxGroup: OfficeRoomSnapshot = {
      ...group,
      employees: [{
        ...group.employees[0],
        drawers: [{
          id: 'inbox-record',
          kind: 'inbox',
          action: 'sent',
          at: Date.now(),
          label: inboxId,
          inboxEntryId: inboxId,
        }],
      }],
    }
    render(
      <OfficeCabinetWindow
        group={inboxGroup}
        roomName="Semis"
        onOpenWorkspaceFiles={vi.fn()}
        onOpenRecord={vi.fn()}
        onClose={vi.fn()}
      />,
    )

    expect(screen.getByText('Inbox delivery')).toBeTruthy()
    expect(screen.queryByText(inboxId)).toBeNull()
    expect(screen.getByRole('button', { name: /Open Inbox delivery, Inbox, .* in Workspace/ })).toBeTruthy()
  })

  it('uses the generated open drawer and focuses the empty cabinet exit', async () => {
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
    const workspaceFiles = screen.getByRole('button', { name: 'Enter Workspace files' })
    const close = screen.getByRole('button', { name: 'Close' })
    expect(document.activeElement).toBe(workspaceFiles)
    await userEvent.keyboard('{Tab}')
    expect(document.activeElement).toBe(close)
    await userEvent.keyboard('{Tab}')
    expect(document.activeElement).toBe(workspaceFiles)
  })
})
