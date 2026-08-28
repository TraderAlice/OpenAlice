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

    expect(screen.getByRole('dialog', { name: 'Filing cabinet · Semis' })).toBeTruthy()
    expect(screen.getByText('2 filed records')).toBeTruthy()
    expect(screen.getAllByRole('listitem').map((item) => item.textContent)).toEqual([
      'Review queueFiled by c1▶',
      'Thesis memoFiled by x1▶',
    ])
    expect(container.querySelector<HTMLImageElement>('header img')?.src)
      .toContain('/office/hud/drawer-record-v1.png')

    await userEvent.click(screen.getByRole('button', { name: /Review queue/ }))
    expect(onOpenRecord).toHaveBeenCalledWith(group.employees[1], group.employees[1].drawers[0])
    expect(onOpenWorkspaceFiles).not.toHaveBeenCalled()

    await userEvent.click(screen.getByRole('button', { name: 'Enter Workspace files' }))
    expect(onOpenWorkspaceFiles).toHaveBeenCalledTimes(1)

    await userEvent.keyboard('{Escape}')
    expect(onClose).toHaveBeenCalledTimes(1)
  })
})
