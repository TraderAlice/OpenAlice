/**
 * FXMacroData Provider Module.
 * Central-bank and official-statistics macro data keyed by currency.
 */

import { Provider } from '../../core/provider/abstract/provider.js'
import { FXMDAvailableIndicatorsFetcher } from './models/available-indicators.js'
import { FXMDEconomicIndicatorsFetcher } from './models/economic-indicators.js'
import { FXMDEconomicCalendarFetcher } from './models/economic-calendar.js'
import { FXMDCountryInterestRatesFetcher } from './models/country-interest-rates.js'
import { FXMDCurrencyHistoricalFetcher } from './models/currency-historical.js'

export const fxmacrodataProvider = new Provider({
  name: 'fxmacrodata',
  website: 'https://fxmacrodata.com',
  description: 'Macro indicators, release calendars, policy rates and FX reference rates from official sources, keyed by currency.',
  credentials: ['api_key'],
  instructions: 'USD indicators and calendars work without a key (15-minute delay, last 90 days). Other currencies and FX rates need a key.',
  fetcherDict: {
    AvailableIndicators: FXMDAvailableIndicatorsFetcher,
    EconomicIndicators: FXMDEconomicIndicatorsFetcher,
    EconomicCalendar: FXMDEconomicCalendarFetcher,
    CountryInterestRates: FXMDCountryInterestRatesFetcher,
    CurrencyHistorical: FXMDCurrencyHistoricalFetcher,
  },
})
