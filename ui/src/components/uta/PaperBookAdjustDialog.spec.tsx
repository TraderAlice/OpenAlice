// @vitest-environment jsdom

import { cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'

const { paperBook, paperSetSnapshot } = vi.hoisted(() => ({
  paperBook: vi.fn(),
  paperSetSnapshot: vi.fn(),
}))

vi.mock('../../api', () => ({
  api: {
    trading: {
      paperBook,
      paperSetSnapshot,
      paperAdjustCash: vi.fn(),
      paperAdjustPosition: vi.fn(),
      paperSetSellable: vi.fn(),
    },
  },
}))

import {
  formatSnapRows,
  parseSnapRows,
  PaperBookAdjustDialog,
  summarizeSnapshotDiff,
  type BookView,
} from './PaperBookAdjustDialog'

const book: BookView = {
  cash: '874493.2',
  buyingPower: '874493.2',
  positions: [
    { nativeKey: '600519', quantity: '100', avgCost: '1231.67', locked: '100', sellable: '0' },
    { nativeKey: '513100', quantity: '1000', avgCost: '2.304', locked: '1000', sellable: '0' },
  ],
}

afterEach(() => {
  cleanup()
  vi.clearAllMocks()
})

beforeEach(() => {
  paperBook.mockResolvedValue({ book })
  paperSetSnapshot.mockResolvedValue({ hash: 'abc' })
})

describe('formatSnapRows / parseSnapRows / summarizeSnapshotDiff', () => {
  it('round-trips current book positions into textarea lines', () => {
    const rows = formatSnapRows(book.positions)
    expect(rows).toBe('600519,100,1231.67,0\n513100,1000,2.304,0')
    expect(parseSnapRows(rows)).toEqual([
      { nativeKey: '600519', quantity: '100', avgCost: '1231.67', sellable: '0' },
      { nativeKey: '513100', quantity: '1000', avgCost: '2.304', sellable: '0' },
    ])
  })

  it('flags deleted symbols when a row is omitted from the draft', () => {
    const diff = summarizeSnapshotDiff(book, book.cash, '600519,100,1231.67,100')
    expect(diff).toContain('删除 513100（qty=1000）')
    expect(diff).toContain('600519: 可卖 0→100')
  })

  it('reports cash changes and additions', () => {
    const diff = summarizeSnapshotDiff(
      book,
      '900000',
      '600519,100,1231.67,0\n513100,1000,2.304,0\n000001,200,10,200',
    )
    expect(diff[0]).toBe('现金 874493.2 → 900000')
    expect(diff.some((l) => l.startsWith('新增 000001'))).toBe(true)
  })
})

describe('PaperBookAdjustDialog snapshot tab', () => {
  it('prefills the whole-book textarea from the current book', async () => {
    render(
      <PaperBookAdjustDialog utaId="uta-1" onDone={vi.fn()} onClose={vi.fn()} />,
    )

    fireEvent.click(screen.getByRole('button', { name: '整账' }))

    await waitFor(() => {
      expect((screen.getByLabelText('整账持仓') as HTMLTextAreaElement).value).toBe(
        '600519,100,1231.67,0\n513100,1000,2.304,0',
      )
    })
    expect((screen.getByLabelText('整账现金') as HTMLInputElement).value).toBe('874493.2')
  })

  it('shows a live delete preview when a listed position is removed', async () => {
    render(
      <PaperBookAdjustDialog utaId="uta-1" onDone={vi.fn()} onClose={vi.fn()} />,
    )

    fireEvent.click(screen.getByRole('button', { name: '整账' }))

    await waitFor(() => {
      expect((screen.getByLabelText('整账持仓') as HTMLTextAreaElement).value).toBe(
        '600519,100,1231.67,0\n513100,1000,2.304,0',
      )
    })

    fireEvent.change(screen.getByLabelText('整账持仓'), {
      target: { value: '600519,100,1231.67,100' },
    })

    expect(screen.getByLabelText('整账变更预览').textContent).toContain('删除 513100')
    expect(screen.getByLabelText('整账变更预览').textContent).toContain('可卖 0→100')
  })
})
