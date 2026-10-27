import { describe, expect, it, vi } from 'vitest'
import { createReferenceBoardTools } from './reference-board.js'
import type { ReferenceDataService } from '@/domain/market-data/reference/types.js'

describe('native economic calendar board', () => {
  it('reads the same first-party calendar contract without invoking trading', async () => {
    const board = { events: [], window: { start: '2026-10-25', end: '2026-11-08' }, meta: { provider: 'fixture', asOf: '2026-10-25T00:00:00Z' } }
    const economicCalendar = vi.fn(async () => board)
    const tools = createReferenceBoardTools({ economicCalendar } as unknown as ReferenceDataService)
    expect(await tools.marketGetBoard.execute!({ board: 'economic-calendar' }, { toolCallId: 'fixture', messages: [] })).toEqual(board)
    expect(economicCalendar).toHaveBeenCalledOnce()
  })
})
