import type { OhlcvBar } from '@/domain/market-data/bars/index.js'
import type { OrderFlowDeltaBar } from './context.js'
import type { SummaryUnavailableReason } from './summary.js'

export interface OrderFlowCandidateContext {
  targetBars: OhlcvBar[]
  deltaBars: OrderFlowDeltaBar[]
  targetIndexOffset: number
  unavailableReason?: SummaryUnavailableReason
  degraded?: boolean
}
