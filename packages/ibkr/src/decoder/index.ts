/**
 * Decoder module — assembles base + all handler groups.
 *
 * Usage:
 *   import { Decoder, applyAllHandlers } from './decoder'
 *   const decoder = new Decoder(wrapper, serverVersion)
 *   applyAllHandlers(decoder)
 */

import { Decoder } from './base.js'
import { applyMarketDataHandlers } from './market-data.js'
import { applyOrderHandlers } from './orders.js'
import { applyAccountHandlers } from './account.js'
import { applyContractHandlers } from './contract.js'
import { applyExecutionHandlers } from './execution.js'
import { applyHistoricalHandlers } from './historical.js'
import { applyMiscHandlers } from './misc.js'

export function applyAllHandlers(decoder: Decoder): void {
  applyMarketDataHandlers(decoder)
  applyOrderHandlers(decoder)
  applyAccountHandlers(decoder)
  applyContractHandlers(decoder)
  applyExecutionHandlers(decoder)
  applyHistoricalHandlers(decoder)
  applyMiscHandlers(decoder)
}

export { Decoder }
