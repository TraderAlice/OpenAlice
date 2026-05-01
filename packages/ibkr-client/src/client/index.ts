/**
 * EClient — assembled from base + method mixins.
 *
 * Usage:
 *   import { EClient } from '@traderalice/ibkr'
 *   const client = new EClient(myWrapper)
 *   await client.connect('127.0.0.1', 7497, 0)
 */

import { EClient } from './base.js'
import { applyMarketData } from './market-data.js'
import { applyAccount } from './account.js'
import { applyOrders } from './orders.js'
import { applyHistorical } from './historical.js'

// Force d.ts to reference mixin files so declare module augmentations are loaded
import './market-data.js'
import './account.js'
import './orders.js'
import './historical.js'

// Apply all method groups to EClient.prototype
applyMarketData(EClient)
applyAccount(EClient)
applyOrders(EClient)
applyHistorical(EClient)

export { EClient }
