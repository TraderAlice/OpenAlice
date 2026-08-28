// @vitest-environment jsdom

import { cleanup, render, screen } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'

import { i18n } from '../i18n'
import { OfficePage } from './OfficePage'

const { officeFloorMock, openOrFocusMock } = vi.hoisted(() => ({
  officeFloorMock: vi.fn(),
  openOrFocusMock: vi.fn(),
}))

vi.mock('./OfficeRuntimeSection', () => ({
  OfficeRuntimeSection: () => <div>Office occupancy</div>,
}))

vi.mock('../contexts/workspaces-context', () => ({
  useWorkspaces: () => ({
    workspaces: [{ id: 'chat-1', tag: 'chat' }],
    hasLoaded: true,
  }),
}))

vi.mock('../hooks/useOfficeFloor', () => ({
  useOfficeFloor: officeFloorMock,
}))

const defaultOfficeFloor = () => ({
  building: {
    config: {
      workspaceSleepAfterMs: 3 * 24 * 60 * 60 * 1000,
      harnessMinimumVisibleGroups: { chat: 1, 'auto-quant': 1, prediction: 1, other: 0 },
    },
    lastSeq: 1,
    firstSeq: 1,
    offices: [{
      workspace: { id: 'chat-1', tag: 'chat', harness: 'chat' },
      lastInteractionAt: Date.now(),
      sleeping: false,
      employees: [],
    }],
  },
  loading: false,
  error: null,
  refresh: async () => undefined,
})

vi.mock('../tabs/store', () => ({
  useWorkspace: (select: (state: { openOrFocus: () => void }) => unknown) =>
    select({ openOrFocus: openOrFocusMock }),
}))

beforeEach(async () => {
  await i18n.changeLanguage('zh')
  officeFloorMock.mockReturnValue(defaultOfficeFloor())
  openOrFocusMock.mockClear()
  vi.stubGlobal('matchMedia', vi.fn(() => ({
    matches: true,
    addEventListener: vi.fn(),
    removeEventListener: vi.fn(),
  })))
})

afterEach(cleanup)

describe('OfficePage localization', () => {
  it('renders an empty Office as a game floor instead of page copy', () => {
    officeFloorMock.mockReturnValue({
      ...defaultOfficeFloor(),
      building: {
        ...defaultOfficeFloor().building,
        lastSeq: 0,
        firstSeq: 0,
        offices: [],
      },
    })

    render(<OfficePage />)

    expect(screen.getByLabelText('Office 地图。拖动查看地图，使用方向键或 WASD 移动 Alice，靠近对象后按回车或空格互动。')).toBeTruthy()
    expect(screen.getByRole('img', { name: 'Office 地图上的 Alice' })).toBeTruthy()
    expect(screen.getByText('还没有 Workspace')).toBeTruthy()
    expect(screen.queryByRole('button', { name: '所有小组' })).toBeNull()
  })

  it('localizes the Office HUD and opens logs on request', async () => {
    const { container } = render(<OfficePage />)

    expect(screen.getByRole('heading', { name: '办公室' })).toBeTruthy()
    expect(screen.getByText('多个 Harness 办公室共处一个平层。Workspace 是小组，每个 Session 都有自己的工位。')).toBeTruthy()
    expect(screen.queryByText('Office occupancy')).toBeNull()
    const menuTrigger = screen.getByRole('button', { name: '菜单' })
    menuTrigger.focus()
    await userEvent.keyboard('{ArrowDown}')
    await userEvent.click(screen.getByRole('menuitem', { name: '占用日志' }))
    expect(screen.getByText('Office occupancy')).toBeTruthy()
    expect(screen.getByRole('dialog', { name: '占用日志' }).querySelector<HTMLImageElement>('header img')?.src)
      .toContain('/office/hud/occupancy-log-v1.png')
    expect(container.querySelector<HTMLElement>('.oa-office-scene')?.hasAttribute('inert')).toBe(true)
    await userEvent.keyboard('{Escape}')
    expect(screen.queryByText('Office occupancy')).toBeNull()
    await vi.waitFor(() => {
      expect(document.activeElement).toBe(menuTrigger)
    })

    const operations = screen.getByRole('button', { name: '行动看板' })
    await userEvent.click(operations)
    expect(screen.getByText('Office occupancy')).toBeTruthy()
    await userEvent.keyboard('{Escape}')
    await vi.waitFor(() => {
      expect(document.activeElement).toBe(operations)
    })
  })

  it('inspects a filing cabinet in Office before explicitly entering Workspace files', async () => {
    const { container } = render(<OfficePage />)

    const sign = screen.getByRole('button', { name: '查看 chat 文件' })
    await userEvent.click(sign)

    expect(screen.getByRole('dialog', { name: '档案柜 · chat' })).toBeTruthy()
    expect(screen.getByText('这里还没有归档任何工位记录。')).toBeTruthy()
    expect(openOrFocusMock).not.toHaveBeenCalled()
    expect(container.querySelector<HTMLElement>('.oa-office-scene')?.hasAttribute('inert')).toBe(true)

    await userEvent.keyboard('{Escape}')
    expect(screen.queryByRole('dialog', { name: '档案柜 · chat' })).toBeNull()
    await vi.waitFor(() => {
      expect(document.activeElement).toBe(sign)
    })

    await userEvent.click(screen.getByRole('button', { name: '档案柜 · chat' }))
    await userEvent.click(screen.getByRole('button', { name: '进入 Workspace 文件' }))
    expect(openOrFocusMock).toHaveBeenCalledWith({
      kind: 'workspace',
      params: { wsId: 'chat-1', source: 'chat' },
    })
  })
})
