import { type BarMeta, type BarService, type BarSourceRef, type GetBarsOpts, type OhlcvBar } from '@/domain/market-data/bars/index.js'
import { chooseIntrabarPlan, type IntrabarPlan } from './intrabar-plan.js'

export type IntrabarWindowStatus = 'available' | 'no_target_bars' | 'no_intrabars'

export interface IntrabarWindowResult {
  status: IntrabarWindowStatus
  plan: IntrabarPlan
  targetBars: OhlcvBar[]
  intrabars: OhlcvBar[]
  targetMeta?: BarMeta
  targetIndexOffset: number
}

export async function loadIntrabarWindow(params: {
  barService: BarService
  ref: BarSourceRef
  barId: string
  targetInterval: string
  requestedCount: number
  start?: string
  end?: string
  targetBars?: OhlcvBar[]
  targetMeta?: BarMeta
}): Promise<IntrabarWindowResult> {
  const plan = chooseIntrabarPlan(params.targetInterval, params.requestedCount, params.barId)
  const loaded = await loadTargetBars(params, plan)

  if (loaded.bars.length === 0) {
    return {
      status: 'no_target_bars',
      plan,
      targetBars: [],
      intrabars: [],
      targetMeta: loaded.meta,
      targetIndexOffset: loaded.indexOffset,
    }
  }

  const firstBar = loaded.bars[0]!
  const lastBar = loaded.bars[loaded.bars.length - 1]!
  const intrabarResult = await params.barService.getBars(params.ref, {
    interval: plan.intrabarInterval,
    start: firstBar.date.slice(0, 10),
    end: lastBar.date.slice(0, 10),
  })

  return {
    status: intrabarResult.bars.length === 0 ? 'no_intrabars' : 'available',
    plan,
    targetBars: loaded.bars,
    intrabars: intrabarResult.bars,
    targetMeta: loaded.meta,
    targetIndexOffset: loaded.indexOffset,
  }
}

async function loadTargetBars(
  params: {
    barService: BarService
    ref: BarSourceRef
    targetInterval: string
    start?: string
    end?: string
    targetBars?: OhlcvBar[]
    targetMeta?: BarMeta
  },
  plan: IntrabarPlan,
): Promise<{ bars: OhlcvBar[]; meta?: BarMeta; indexOffset: number }> {
  if (params.targetBars) {
    const bars = params.targetBars.slice(-plan.actualCount)
    return {
      bars,
      meta: params.targetMeta,
      indexOffset: params.targetBars.length - bars.length,
    }
  }

  const opts: GetBarsOpts = {
    interval: params.targetInterval,
    count: plan.actualCount,
    start: params.start,
    end: params.end,
  }
  const targetResult = await params.barService.getBars(params.ref, opts)
  return {
    bars: targetResult.bars,
    meta: targetResult.meta,
    indexOffset: 0,
  }
}
