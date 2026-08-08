import { Provider } from '../../core/provider/abstract/provider.js'
import { MarketDataOptionsChainsFetcher } from './models/options-chains.js'

export const marketDataProvider = new Provider({
  name: 'marketdata',
  website: 'https://www.marketdata.app',
  description: 'MarketData.app provides filtered current and historical US equity-option chains.',
  credentials: ['api_key'],
  fetcherDict: { OptionsChains: MarketDataOptionsChainsFetcher },
  reprName: 'MarketData.app',
  instructions: 'Create a MarketData.app token and add it in OpenAlice Settings → Market Data.',
})
