/**
 * LeverupBroker — IBroker adapter for LeverUp perp DEX on Monad.
 *
 * Flow: sign EIP-712 with 1CT key → POST to OCT relayer → poll status.
 * Funds stay in user's main wallet; relayer pays gas & Pyth oracle fee.
 *
 * Quarantined under brokers/others/ to signal lower-tier ecosystem support
 * (vs first-class brokers/{ccxt,alpaca,ibkr}/). See plan file for context.
 */

import { z } from 'zod'
import Decimal from 'decimal.js'
import {
  Contract,
  ContractDescription,
  ContractDetails,
  Order,
  OrderState,
  UNSET_DECIMAL,
} from '@traderalice/ibkr'
import {
  BrokerError,
  type IBroker,
  type AccountCapabilities,
  type AccountInfo,
  type Position,
  type PlaceOrderResult,
  type OpenOrder,
  type Quote,
  type MarketClock,
  type TpSlParams,
} from '../../types.js'
import '../../../contract-ext.js'
import { buildContract, buildPosition } from '../../contract-builder.js'

import {
  type LeverupBrokerConfig,
  type LeverupNetwork,
  NETWORK_CONSTANTS,
} from './types.js'
import { findPairBySymbol, getPairs, type LeverupPair } from './pairs.js'
import {
  qtyToWei,
  weiToQty,
  priceToWei,
  weiToPrice,
  amountInToWei,
  weiToAmountIn,
  USDC_DECIMALS,
} from './decimals.js'
import {
  accountFromPrivateKey,
  generateOpenSalt,
  signOpenPosition,
  signClosePosition,
  type SchemaVariant,
} from './eip712.js'
import { fetchPythUpdateData, fetchPythPrice } from './pyth.js'
import {
  RelayerClient,
  type OpenPositionRequest,
  type ClosePositionRequest,
} from './relayer-client.js'
import { ReaderClient, type RestPositionRecord } from './reader-client.js'
import type { PrivateKeyAccount } from 'viem/accounts'

const NETWORK_REGEX_PRIVATE_KEY = /^0x[a-fA-F0-9]{64}$/

interface OrderTrackingRecord {
  inputHash: `0x${string}`
  pair: LeverupPair
  side: 'BUY' | 'SELL'
  qty: Decimal
  /** Most-recent known status from relayer. */
  status: 'Submitted' | 'Filled' | 'Cancelled' | 'Inactive'
  txnHash?: `0x${string}`
  reason?: string
}

export class LeverupBroker implements IBroker {
  // ---- Self-registration ----

  static configSchema = z.object({
    network: z.enum(['live', 'testnet']),
    privateKey: z.string().regex(NETWORK_REGEX_PRIVATE_KEY),
  })

  static fromConfig(config: { id: string; label?: string; brokerConfig: Record<string, unknown> }): LeverupBroker {
    const bc = LeverupBroker.configSchema.parse(config.brokerConfig)
    return new LeverupBroker({
      id: config.id,
      label: config.label,
      network: bc.network,
      privateKey: bc.privateKey as `0x${string}`,
    })
  }

  // ---- Instance ----

  readonly id: string
  readonly label: string
  readonly meta = { engine: 'leverup' as const }

  private readonly config: LeverupBrokerConfig
  private readonly net = NETWORK_CONSTANTS
  private account!: PrivateKeyAccount
  private relayer!: RelayerClient
  private reader!: ReaderClient
  private initialized = false
  /** EIP-712 schema variant in active use; flipped if relayer rejects nested. */
  private schemaVariant: SchemaVariant = 'nested'
  /** Tracks orders by orderId (= inputHash) for getOrder lookups. */
  private readonly orderTracking = new Map<string, OrderTrackingRecord>()

  constructor(config: LeverupBrokerConfig) {
    this.config = config
    this.id = config.id ?? `leverup-${config.network}`
    this.label = config.label ?? `LeverUp ${config.network === 'testnet' ? 'Testnet' : 'Mainnet'}`
  }

  private get network(): LeverupNetwork {
    return this.config.network
  }

  private get networkConst() {
    return this.net[this.network]
  }

  // ---- Lifecycle ----

  async init(): Promise<void> {
    try {
      this.account = accountFromPrivateKey(this.config.privateKey)
    } catch (err) {
      throw new BrokerError('AUTH', `Invalid private key: ${err instanceof Error ? err.message : String(err)}`)
    }
    this.relayer = new RelayerClient(this.networkConst.relayerBase)
    this.reader = new ReaderClient(this.networkConst)

    // Sanity-probe the public RPC so misconfigured testnet RPC fails loud at init.
    try {
      await this.reader.publicClient.getChainId()
    } catch (err) {
      throw new BrokerError('NETWORK', `Cannot reach Monad RPC ${this.networkConst.rpcUrl}: ${err instanceof Error ? err.message : String(err)}`)
    }

    this.initialized = true
    console.log(`LeverupBroker[${this.id}]: connected (${this.network}, wallet=${this.account.address})`)
  }

  /** Trader address — derived from privateKey at init(). */
  private get traderAddress(): `0x${string}` {
    return this.account.address
  }

  async close(): Promise<void> {
    // viem clients have no explicit close
  }

  private ensureInit(): void {
    if (!this.initialized) {
      throw new BrokerError('CONFIG', `LeverupBroker[${this.id}] not initialized. Call init() first.`)
    }
  }

  // ---- Contract search ----

  async searchContracts(pattern: string): Promise<ContractDescription[]> {
    if (!pattern) return []
    const upper = pattern.toUpperCase()
    const matches = getPairs(this.network).filter(p =>
      p.base.toUpperCase().includes(upper) ||
      p.symbol.toUpperCase().includes(upper),
    )
    return matches.map(p => {
      const desc = new ContractDescription()
      desc.contract = this.pairToContract(p)
      return desc
    })
  }

  async getContractDetails(query: Contract): Promise<ContractDetails | null> {
    const pair = this.resolvePair(query)
    if (!pair) return null
    const details = new ContractDetails()
    details.contract = this.pairToContract(pair)
    details.longName = `LeverUp ${pair.symbol} (${pair.category})`
    return details
  }

  private pairToContract(pair: LeverupPair): Contract {
    return buildContract({
      symbol: pair.base,
      // LeverUp synthesizes forex / stocks as crypto-perps; the canonical
      // taxonomy doesn't have a "synthetic perp" — closest fit is CRYPTO_PERP.
      secType: 'CRYPTO_PERP',
      exchange: 'LEVERUP',
      currency: pair.quote,
      localSymbol: pair.symbol,
      description: `${pair.symbol} (LeverUp ${pair.category}${pair.highLeverage ? ', 500x' : ''})`,
    })
  }

  private resolvePair(contract: Contract): LeverupPair | undefined {
    const key = contract.localSymbol || contract.symbol
    if (!key) return undefined
    return findPairBySymbol(this.network, key)
  }

  // ---- Trading operations ----

  async placeOrder(contract: Contract, order: Order, tpsl?: TpSlParams): Promise<PlaceOrderResult> {
    this.ensureInit()

    if (order.orderType !== 'MKT') {
      return { success: false, error: `LeverUp OCT only supports market orders (got ${order.orderType}). Limit orders are not exposed via the OCT relayer.` }
    }

    const pair = this.resolvePair(contract)
    if (!pair) {
      return { success: false, error: `Unknown LeverUp pair: ${contract.localSymbol ?? contract.symbol}` }
    }

    if (order.totalQuantity.equals(UNSET_DECIMAL)) {
      return { success: false, error: 'totalQuantity is required for LeverUp orders' }
    }

    try {
      // 1. Pull Pyth update data + current price
      const pyth = await fetchPythPrice(pair.pythFeedId)

      // 2. Build OpenDataInput
      const isLong = order.action === 'BUY'
      const collateralToken = this.networkConst.usdc  // USDC default; future: pick by user pref
      const lvToken = this.networkConst.lvusd

      // Notional value at current price; we use market mode → set price = current oracle price
      // amountIn = required margin (collateral). For MVP, leverage=1: amountIn = qty * price (USDC).
      const qtyD = order.totalQuantity
      const priceD = new Decimal(pyth.price)
      const notionalUsd = qtyD.mul(priceD)  // assumes pair.quote === 'USD'
      const amountInUsd = notionalUsd  // 1x leverage MVP

      const openData = {
        pairBase: pair.pairBase,
        isLong,
        tokenIn: collateralToken,
        lvToken,
        amountIn: amountInToWei(amountInUsd, USDC_DECIMALS),
        qty: qtyToWei(qtyD),
        price: priceToWei(priceD),
        stopLoss: tpsl?.stopLoss ? priceToWei(new Decimal(tpsl.stopLoss.price)) : 0n,
        takeProfit: tpsl?.takeProfit ? priceToWei(new Decimal(tpsl.takeProfit.price)) : 0n,
        broker: 0,
      }

      // 3. Sign EIP-712
      const salt = generateOpenSalt()
      const deadline = BigInt(Math.floor(Date.now() / 1000) + 300)  // 5min
      const message = {
        openData,
        trader: this.traderAddress,
        salt,
        deadline,
      }

      const signature = await signOpenPosition({
        account: this.account,
        chainId: this.networkConst.chainId,
        oneClickAgent: this.networkConst.oneClickAgent,
        message,
        variant: this.schemaVariant,
      })

      // 4. POST to relayer
      const req: OpenPositionRequest = {
        openData: {
          pairBase: openData.pairBase,
          isLong: openData.isLong,
          tokenIn: openData.tokenIn,
          lvToken: openData.lvToken,
          amountIn: openData.amountIn.toString(),
          qty: openData.qty.toString(),
          price: openData.price.toString(),
          stopLoss: openData.stopLoss.toString(),
          takeProfit: openData.takeProfit.toString(),
          broker: openData.broker.toString(),
        },
        trader: this.traderAddress,
        salt,
        deadline: Number(deadline),
        signature,
        pythUpdateData: pyth.updateData,
      }
      const submit = await this.relayer.sendOpenPosition(req)

      // 5. Track + return immediately (sync polling would block UTA)
      this.orderTracking.set(submit.inputHash, {
        inputHash: submit.inputHash,
        pair,
        side: order.action as 'BUY' | 'SELL',
        qty: qtyD,
        status: 'Submitted',
      })

      const orderState = new OrderState()
      orderState.status = 'Submitted'
      return {
        success: true,
        orderId: submit.inputHash,
        orderState,
      }
    } catch (err) {
      return { success: false, error: err instanceof Error ? err.message : String(err) }
    }
  }

  async modifyOrder(_orderId: string, _changes: Partial<Order>): Promise<PlaceOrderResult> {
    return { success: false, error: 'LeverUp does not support modifyOrder. Cancel and re-place instead.' }
  }

  async cancelOrder(_orderId: string): Promise<PlaceOrderResult> {
    return { success: false, error: 'LeverUp OCT does not expose cancel for market orders (they execute immediately). Limit-order cancel is not implemented.' }
  }

  async closePosition(contract: Contract, _quantity?: Decimal): Promise<PlaceOrderResult> {
    this.ensureInit()

    const pair = this.resolvePair(contract)
    if (!pair) {
      return { success: false, error: `Unknown LeverUp pair: ${contract.localSymbol ?? contract.symbol}` }
    }

    try {
      // Find the open position for this pair
      const positions = await this.reader.fetchOpenPositions(this.traderAddress)
      const position = positions.find(p => p.pairBase.toLowerCase() === pair.pairBase.toLowerCase())
      if (!position) {
        return { success: false, error: `No open position for ${pair.symbol}` }
      }

      // Sign close
      const deadline = BigInt(Math.floor(Date.now() / 1000) + 300)
      const message = {
        positionHash: position.positionHash,
        deadline,
      }
      const signature = await signClosePosition({
        account: this.account,
        chainId: this.networkConst.chainId,
        oneClickAgent: this.networkConst.oneClickAgent,
        message,
        variant: this.schemaVariant,
      })

      const req: ClosePositionRequest = {
        positionHash: position.positionHash,
        deadline: Number(deadline),
        signature,
      }
      const submit = await this.relayer.sendClosePosition(req)

      const orderState = new OrderState()
      orderState.status = 'Submitted'
      return {
        success: true,
        orderId: submit.inputHash,
        orderState,
      }
    } catch (err) {
      return { success: false, error: err instanceof Error ? err.message : String(err) }
    }
  }

  // ---- Queries ----

  async getAccount(): Promise<AccountInfo> {
    this.ensureInit()
    try {
      const [usdcWei, positions] = await Promise.all([
        this.reader.getUsdcBalance(this.traderAddress),
        this.reader.fetchOpenPositions(this.traderAddress),
      ])

      const usdcCash = weiToAmountIn(usdcWei, USDC_DECIMALS)

      let positionMargin = new Decimal(0)
      let unrealizedPnL = new Decimal(0)
      // LeverUp's REST returns margin and fees as raw integers; conservatively
      // sum them as-is (in USDC base units) for an approximate netLiq figure.
      // Refine when REST schema's exact decimals are confirmed via real responses.
      for (const p of positions) {
        positionMargin = positionMargin.plus(weiToAmountIn(BigInt(p.margin || '0'), USDC_DECIMALS))
        // funding+holding fees reduce equity; openFee/executionFee are sunk
        unrealizedPnL = unrealizedPnL
          .minus(new Decimal(p.fundingFee || '0'))
          .minus(new Decimal(p.holdingFee || '0'))
      }

      const netLiquidation = usdcCash.plus(positionMargin).plus(unrealizedPnL)

      return {
        baseCurrency: 'USD',
        netLiquidation: netLiquidation.toString(),
        totalCashValue: usdcCash.toString(),
        unrealizedPnL: unrealizedPnL.toString(),
        realizedPnL: '0',
        initMarginReq: positionMargin.toString(),
      }
    } catch (err) {
      throw BrokerError.from(err)
    }
  }

  async getPositions(): Promise<Position[]> {
    this.ensureInit()
    try {
      const records = await this.reader.fetchOpenPositions(this.traderAddress)
      const out: Position[] = []
      for (const r of records) {
        const pair = getPairs(this.network).find(p => p.pairBase.toLowerCase() === r.pairBase.toLowerCase())
        if (!pair) continue  // unknown pair — skip silently
        const qty = weiToQty(BigInt(r.qty || '0'))
        const entryPrice = weiToPrice(BigInt(r.entryPrice || '0'))
        const margin = weiToAmountIn(BigInt(r.margin || '0'), USDC_DECIMALS)
        out.push(buildPosition({
          contract: this.pairToContract(pair),
          currency: 'USD',
          side: r.isLong ? 'long' : 'short',
          quantity: qty,
          avgCost: entryPrice.toString(),
          marketPrice: entryPrice.toString(),  // refined by getQuote callers if needed
          // LeverUp uses margin (not full notional) for marketValue — preserved
          // pre-buildPosition. Same for unrealizedPnL = '0' (REST doesn't expose
          // it). Both are pass-through; the broker's known limitation, filed in
          // the original LeverupBroker.ts comment.
          marketValue: margin.toString(),
          unrealizedPnL: '0',
          realizedPnL: '0',
          multiplier: '1',
        }))
      }
      return out
    } catch (err) {
      throw BrokerError.from(err)
    }
  }

  async getOrders(orderIds: string[]): Promise<OpenOrder[]> {
    this.ensureInit()
    const out: OpenOrder[] = []
    for (const id of orderIds) {
      const o = await this.getOrder(id)
      if (o) out.push(o)
    }
    return out
  }

  async getOrder(orderId: string): Promise<OpenOrder | null> {
    this.ensureInit()
    const tracked = this.orderTracking.get(orderId)
    if (!tracked) return null

    // Refresh from relayer status if still submitted
    if (tracked.status === 'Submitted') {
      try {
        const status = await this.relayer.getStatus(tracked.inputHash)
        if (status.executed) {
          tracked.status = status.success ? 'Filled' : 'Inactive'
          tracked.txnHash = status.txnHash ?? undefined
          tracked.reason = status.reason ?? undefined
        }
      } catch {
        // Network blip — keep prior status
      }
    }

    const order = new Order()
    order.action = tracked.side
    order.orderType = 'MKT'
    order.totalQuantity = tracked.qty

    const orderState = new OrderState()
    orderState.status = tracked.status

    return {
      contract: this.pairToContract(tracked.pair),
      order,
      orderState,
    }
  }

  async getQuote(contract: Contract): Promise<Quote> {
    this.ensureInit()
    const pair = this.resolvePair(contract)
    if (!pair) {
      throw new BrokerError('EXCHANGE', `Unknown LeverUp pair: ${contract.localSymbol ?? contract.symbol}`)
    }
    try {
      const pyth = await fetchPythPrice(pair.pythFeedId)
      const last = pyth.price.toString()
      return {
        contract: this.pairToContract(pair),
        last,
        bid: last,  // Pyth gives mid; no bid/ask split
        ask: last,
        volume: '0',
        timestamp: pyth.publishTime,
      }
    } catch (err) {
      throw BrokerError.from(err)
    }
  }

  async getMarketClock(): Promise<MarketClock> {
    return { isOpen: true, timestamp: new Date() }
  }

  // ---- Capabilities ----

  getCapabilities(): AccountCapabilities {
    return {
      supportedSecTypes: ['CRYPTO_PERP'],
      supportedOrderTypes: ['MKT'],
    }
  }

  // ---- Contract identity ----

  getNativeKey(contract: Contract): string {
    return contract.localSymbol || contract.symbol
  }

  resolveNativeKey(nativeKey: string): Contract {
    const pair = findPairBySymbol(this.network, nativeKey)
    if (pair) return this.pairToContract(pair)
    // Fallback: synthesize a minimal contract so aliceId stays valid even
    // if the pair list is stale. Caller should still see "unknown pair"
    // errors at trade time.
    const c = new Contract()
    c.localSymbol = nativeKey
    c.symbol = nativeKey.split('/')[0] ?? nativeKey
    c.secType = 'CRYPTO_PERP'
    c.exchange = 'LEVERUP'
    return c
  }

  // ---- Provider-specific (exposed for Pyth fetch from broker tools, future) ----

  /** @internal — for tests + e2e harness use */
  _account(): PrivateKeyAccount {
    this.ensureInit()
    return this.account
  }

  /** @internal — for tests to flip schema variant. */
  _setSchemaVariant(v: SchemaVariant): void {
    this.schemaVariant = v
  }

  /** @internal — REST positions raw, exposed for tests + future debug tools. */
  async _fetchOpenPositionsRaw(): Promise<RestPositionRecord[]> {
    this.ensureInit()
    return this.reader.fetchOpenPositions(this.traderAddress)
  }
}
