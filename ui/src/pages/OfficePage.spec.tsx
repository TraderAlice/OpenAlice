// @vitest-environment jsdom

import { cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'

import { i18n } from '../i18n'
import { clearOfficePlayerState } from '../office/office-excursion'
import { OfficePage } from './OfficePage'

const {
  acknowledgeMock,
  navigateMock,
  officeFloorMock,
  openOrFocusMock,
  productActivityMock,
} = vi.hoisted(() => ({
  acknowledgeMock: vi.fn(),
  navigateMock: vi.fn(),
  officeFloorMock: vi.fn(),
  openOrFocusMock: vi.fn(),
  productActivityMock: vi.fn(),
}))

vi.mock('react-router-dom', async (importOriginal) => ({
  ...await importOriginal<typeof import('react-router-dom')>(),
  useNavigate: () => navigateMock,
}))

vi.mock('./OfficeRuntimeSection', () => ({
  OfficeRuntimeSection: ({
    initialChannel,
    initialSelectedSeq,
    onReplay,
  }: {
    initialChannel?: string
    initialSelectedSeq?: number | null
    onReplay?: (focus: {
      seq: number
      targetIds: readonly string[]
      label: string
      channel: 'news'
    }) => void
  }) => (
    <div
      data-testid="office-runtime-section"
      data-channel={initialChannel}
      data-selected-seq={initialSelectedSeq ?? undefined}
    >
      Office occupancy
      <button
        type="button"
        onClick={() => onReplay?.({
          seq: 12,
          targetIds: ['news-service'],
          label: 'Wire',
          channel: 'news',
        })}
      >
        Mock find news on floor
      </button>
    </div>
  ),
}))

vi.mock('../contexts/workspaces-context', () => ({
  useWorkspaces: () => ({
    workspaces: [
      { id: 'chat-1', tag: 'chat' },
      { id: 'prediction-1', tag: 'prediction' },
    ],
    hasLoaded: true,
  }),
}))

vi.mock('../hooks/useOfficeFloor', () => ({
  useOfficeFloor: officeFloorMock,
}))

vi.mock('../office/useOfficeProductActivity', () => ({
  useOfficeProductActivity: productActivityMock,
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
  navigateMock.mockClear()
  openOrFocusMock.mockClear()
  acknowledgeMock.mockClear()
  productActivityMock.mockReturnValue({
    agent: null,
    inbox: null,
    news: null,
    attention: { agent: false, inbox: false, news: false },
    freshKind: null,
    acknowledge: acknowledgeMock,
  })
  clearOfficePlayerState()
  vi.stubGlobal('matchMedia', vi.fn(() => ({
    matches: true,
    addEventListener: vi.fn(),
    removeEventListener: vi.fn(),
  })))
})

afterEach(() => {
  cleanup()
  vi.restoreAllMocks()
})

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

  it('restores Alice after the Office view unmounts for an excursion', async () => {
    const firstVisit = render(<OfficePage />)
    const firstAlice = screen.getByRole('img', { name: 'Office 地图上的 Alice' })
    const spawnTop = firstAlice.style.top

    fireEvent.keyDown(document.body, { key: 's' })
    await waitFor(() => expect(firstAlice.style.top).not.toBe(spawnTop))
    const rememberedTop = firstAlice.style.top
    firstVisit.unmount()

    render(<OfficePage />)
    const returnedAlice = screen.getByRole('img', { name: 'Office 地图上的 Alice' })
    expect(returnedAlice.style.top).toBe(rememberedTop)
    expect(returnedAlice.dataset.direction).toBe('down')
  })

  it('localizes the Office HUD and opens logs on request', async () => {
    const { container } = render(<OfficePage />)

    expect(screen.getByRole('heading', { name: '办公室' })).toBeTruthy()
    expect(screen.getByText('多个 Harness 办公室共处一个平层。Workspace 是小组，每个 Session 都有自己的工位。')).toBeTruthy()
    expect(screen.queryByText('Office occupancy')).toBeNull()
    const menuTrigger = screen.getByRole('button', { name: '菜单' })
    menuTrigger.focus()
    await userEvent.keyboard('{ArrowDown}')
    await userEvent.click(screen.getByRole('menuitem', { name: '活动日志' }))
    expect(screen.getByText('Office occupancy')).toBeTruthy()
    expect(screen.getByRole('dialog', { name: '活动日志' }).querySelector<HTMLImageElement>('header img')?.src)
      .toContain('/office/hud/occupancy-log-v2.png')
    expect(screen.getByRole('button', { name: '关闭' }).querySelector('.oa-office-window__close-mark'))
      .toBeTruthy()
    expect(container.querySelector<HTMLImageElement>('.oa-office-replay-panel summary img')?.src)
      .toContain('/office/hud/replay-latch-v1.png')
    expect(container.querySelector<HTMLElement>('.oa-office-scene')?.hasAttribute('inert')).toBe(true)
    expect(container.querySelectorAll('.oa-office-window-scrim')).toHaveLength(1)
    await userEvent.keyboard('{Escape}')
    expect(screen.queryByText('Office occupancy')).toBeNull()
    expect(container.querySelector('.oa-office-window-scrim')).toBeNull()
    await vi.waitFor(() => {
      expect(document.activeElement).toBe(menuTrigger)
    })

    const operations = screen.getByRole('button', { name: '行动看板' })
    await userEvent.click(operations)
    await vi.waitFor(() => expect(screen.getByText('Office occupancy')).toBeTruthy())
    await userEvent.keyboard('{Escape}')
    await vi.waitFor(() => {
      expect(document.activeElement).toBe(operations)
    })

    const floorTerminal = screen.getByRole('button', { name: '楼层终端' })
    await userEvent.click(floorTerminal)
    await userEvent.click(await screen.findByRole('menuitem', { name: '活动日志' }))
    expect(screen.getByText('Office occupancy')).toBeTruthy()
    await userEvent.keyboard('{Escape}')
    await vi.waitFor(() => {
      expect(document.activeElement).toBe(floorTerminal)
    })
  })

  it('keeps Inbox and News station visits inside the Office journal', async () => {
    productActivityMock.mockReturnValue({
      agent: null,
      inbox: { seq: 11, occurredAt: 1_100, inboxEntryId: 'inbox-11' },
      news: { seq: 12, occurredAt: 1_200 },
      attention: { agent: false, inbox: true, news: true },
      freshKind: null,
      acknowledge: acknowledgeMock,
    })
    const { container } = render(<OfficePage />)

    const inbox = screen.getByRole('button', { name: 'Inbox 收件台 · 有新动态' })
    await userEvent.click(inbox)
    const runtime = await screen.findByTestId('office-runtime-section', {}, { timeout: 10_000 })
    expect(runtime.dataset.channel).toBe('inbox')
    expect(runtime.dataset.selectedSeq).toBe('11')
    expect(acknowledgeMock).toHaveBeenCalledWith('inbox')
    expect(openOrFocusMock).not.toHaveBeenCalled()
    expect(navigateMock).not.toHaveBeenCalled()
    expect(container.querySelector<HTMLElement>('.oa-office-scene')?.hasAttribute('inert')).toBe(true)

    await userEvent.keyboard('{Escape}')
    await vi.waitFor(() => expect(document.activeElement).toBe(inbox))

    const news = screen.getByRole('button', { name: '新闻终端 · 有新动态' })
    await userEvent.click(news)
    const newsRuntime = await screen.findByTestId('office-runtime-section', {}, { timeout: 10_000 })
    expect(newsRuntime.dataset.channel).toBe('news')
    expect(newsRuntime.dataset.selectedSeq).toBe('12')
    expect(acknowledgeMock).toHaveBeenCalledWith('news')
    expect(openOrFocusMock).not.toHaveBeenCalled()
    expect(navigateMock).not.toHaveBeenCalled()
  })

  it('reopens the exact replayed event and channel from the Operations board', async () => {
    const { container } = render(<OfficePage />)

    const menuTrigger = screen.getByRole('button', { name: '菜单' })
    menuTrigger.focus()
    await userEvent.keyboard('{ArrowDown}')
    await userEvent.click(await screen.findByRole('menuitem', { name: '活动日志' }))
    await userEvent.click(screen.getByRole('button', { name: 'Mock find news on floor' }))

    expect(container.querySelector<HTMLElement>('[data-replay="true"]')).toBeTruthy()
    await userEvent.click(screen.getByRole('button', { name: '行动看板' }))

    const runtime = await screen.findByTestId('office-runtime-section')
    expect(runtime.dataset.channel).toBe('news')
    expect(runtime.dataset.selectedSeq).toBe('12')
  })

  it('enters from the Workspace sign while keeping filed records on the cabinet', async () => {
    const { container } = render(<OfficePage />)

    const sign = screen.getByRole('button', { name: /进入 chat Workspace/ })
    await userEvent.click(sign)
    await vi.waitFor(() => expect(openOrFocusMock).toHaveBeenCalledWith({
      kind: 'workspace',
      params: { wsId: 'chat-1', source: 'chat' },
    }))
    expect(navigateMock).toHaveBeenCalledTimes(1)
    expect(navigateMock).toHaveBeenLastCalledWith('/office/return', {
      state: { officeExcursion: true },
    })
    expect(screen.queryByRole('dialog')).toBeNull()
    expect(container.querySelector<HTMLElement>('.oa-office-scene')?.hasAttribute('inert')).toBe(false)

    openOrFocusMock.mockClear()
    const cabinet = screen.getByRole('button', { name: '档案柜 · chat' })
    await userEvent.click(cabinet)
    await vi.waitFor(() => {
      expect(screen.getByRole('dialog', { name: '档案柜 · chat' })).toBeTruthy()
    }, { timeout: 10_000 })
    expect(screen.getByText('这里还没有归档任何工位记录。')).toBeTruthy()
    expect(openOrFocusMock).not.toHaveBeenCalled()
    expect(container.querySelector<HTMLElement>('.oa-office-scene')?.hasAttribute('inert')).toBe(true)
    expect(container.querySelectorAll('.oa-office-window-scrim')).toHaveLength(1)

    await userEvent.keyboard('{Escape}')
    expect(screen.queryByRole('dialog', { name: '档案柜 · chat' })).toBeNull()
    expect(container.querySelector('.oa-office-window-scrim')).toBeNull()
    await vi.waitFor(() => {
      expect(document.activeElement).toBe(cabinet)
    })

    await userEvent.click(cabinet)
    await userEvent.click(await screen.findByRole('button', { name: '进入 Workspace 文件' }))
    expect(openOrFocusMock).toHaveBeenCalledWith({
      kind: 'workspace',
      params: { wsId: 'chat-1', source: 'chat' },
    })
    expect(navigateMock).toHaveBeenCalledTimes(2)
  })

  it('enters Prediction through its own Workspace source', async () => {
    officeFloorMock.mockReturnValue({
      ...defaultOfficeFloor(),
      building: {
        ...defaultOfficeFloor().building,
        offices: [{
          workspace: { id: 'prediction-1', tag: 'prediction', harness: 'prediction' },
          lastInteractionAt: Date.now(),
          sleeping: false,
          employees: [],
        }],
      },
    })

    render(<OfficePage />)
    await userEvent.click(screen.getByRole('button', { name: /进入 prediction Workspace/ }))

    await vi.waitFor(() => expect(openOrFocusMock).toHaveBeenCalledWith({
      kind: 'workspace',
      params: { wsId: 'prediction-1', source: 'prediction' },
    }))
  })

  it('returns from an Agent file to the originating roster member', async () => {
    const employees = Array.from({ length: 6 }, (_, index) => ({
      resumeId: `resume-${index}`,
      agent: index % 2 === 0 ? 'codex' : 'claude',
      name: `x${index + 1}`,
      title: `研究同事 ${index + 1}`,
      mood: index < 2 ? 'working' as const : 'idle' as const,
      bubble: null,
      lastSeq: 1,
      lastInteractionAt: 1,
      drawers: [],
    }))
    officeFloorMock.mockReturnValue({
      ...defaultOfficeFloor(),
      building: {
        ...defaultOfficeFloor().building,
        offices: [{
          ...defaultOfficeFloor().building.offices[0],
          employees,
        }],
      },
    })

    const { container } = render(<OfficePage />)

    const rosterBoard = screen.getByRole('button', { name: '小组名册 · chat · 还有 2 位同事' })
    await userEvent.click(rosterBoard)
    expect(screen.getByRole('dialog', { name: '小组名册 · chat' })).toBeTruthy()
    expect(container.querySelectorAll('.oa-office-window-scrim')).toHaveLength(1)

    const member = screen.getByRole('button', { name: /Claude.*x2.*研究同事 2/i })
    await userEvent.click(member)
    expect(screen.getByRole('dialog', { name: 'Claude' })).toBeTruthy()
    expect(screen.getByText('当前委托')).toBeTruthy()
    expect(screen.getByText('研究同事 2')).toBeTruthy()
    expect(container.querySelectorAll('.oa-office-window-scrim')).toHaveLength(1)
    const back = screen.getByRole('button', { name: '返回小组名册' })
    expect(back.querySelector('img')?.getAttribute('src')).toBe('/office/hud/window-back-v2.png')

    await userEvent.keyboard('{Escape}')
    expect(screen.getByRole('dialog', { name: '小组名册 · chat' })).toBeTruthy()
    const restoredMember = screen.getByRole('button', { name: /Claude.*x2.*研究同事 2/i })
    expect(document.activeElement).toBe(restoredMember)

    await userEvent.keyboard('{Escape}')
    expect(screen.queryByRole('dialog')).toBeNull()
    expect(container.querySelector('.oa-office-window-scrim')).toBeNull()
    await vi.waitFor(() => {
      expect(document.activeElement).toBe(rosterBoard)
    })
  })
})
