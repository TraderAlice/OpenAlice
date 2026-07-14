/**
 * TradingView anonymous chart-data provider.
 *
 * TradingView's free/anonymous data is exchange-dependent. Bare US equities may
 * resolve to free Cboe partial-market realtime data, while exchange-qualified
 * US symbols and many non-US exchanges are commonly delayed without paid
 * exchange entitlements. This provider is intentionally keyless and opt-in so
 * agents can use it as a free global intrabar fallback without mistaking
 * freshness or partial-market volume for broker/SIP quality.
 */

import { Provider } from '../../core/provider/abstract/provider.js'
import { TradingViewCryptoHistoricalFetcher } from './models/crypto-historical.js'
import { TradingViewCryptoSearchFetcher } from './models/crypto-search.js'
import { TradingViewCurrencyHistoricalFetcher } from './models/currency-historical.js'
import { TradingViewCurrencySearchFetcher } from './models/currency-search.js'
import { TradingViewEquityHistoricalFetcher } from './models/equity-historical.js'
import { TradingViewEquitySearchFetcher } from './models/equity-search.js'
import {
  TRADINGVIEW_BAR_CAPABILITY,
  TRADINGVIEW_HISTORICAL_INTERVALS,
  TRADINGVIEW_PROVIDER_ID,
} from './domain.js'

export const tradingviewProvider = new Provider({
  name: TRADINGVIEW_PROVIDER_ID,
  reprName: 'TradingView Free',
  description: 'TradingView anonymous chart feed — free global OHLCV for equities, crypto, and FX with exchange-dependent freshness.',
  website: 'https://www.tradingview.com/',
  vendorMeta: {
    coverage: 'Global TradingView anonymous free feed for equities, crypto, and FX. US bare equity symbols may resolve to Cboe One/BATS partial-market realtime data (not SIP consolidated), while exchange-qualified US symbols and many non-US exchanges are delayed without paid exchange entitlements. CN A-shares (SZSE/SSE), Hong Kong (HKEX), Taiwan (TWSE), crypto venues (BINANCE/COINBASE/etc.), FX, and other international markets are supported. Timestamps are returned in UTC (consistent with yfinance and broker sources).',
    howToUse:
      'Enable as a free global 1m/3m/5m intrabar fallback for analysis (order flow, volume profile), treating freshness as exchange-dependent and conservatively delayed unless verified. ' +
      'Symbols may be bare (AAPL, SPY) or TradingView-qualified (NASDAQ:AAPL, SZSE:300820, HKEX:0700, BINANCE:BTCUSDT, FX:EURUSD). ' +
      'For US equities that resolve to Cboe, volume is partial-market Cboe One/BATS volume, not SIP consolidated. ' +
      'All timestamps are in UTC for consistency across providers.',
  },
  barMeta: {
    capability: TRADINGVIEW_BAR_CAPABILITY,
    supportedIntervals: TRADINGVIEW_HISTORICAL_INTERVALS,
    supportsCount: true,
  },
  fetcherDict: {
    EquitySearch: TradingViewEquitySearchFetcher,
    EquityHistorical: TradingViewEquityHistoricalFetcher,
    CryptoSearch: TradingViewCryptoSearchFetcher,
    CryptoHistorical: TradingViewCryptoHistoricalFetcher,
    CurrencyPairs: TradingViewCurrencySearchFetcher,
    CurrencyHistorical: TradingViewCurrencyHistoricalFetcher,
  },
})
