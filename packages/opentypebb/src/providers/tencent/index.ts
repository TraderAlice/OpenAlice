/**
 * Tencent Finance (腾讯财经) Provider.
 *
 * Source: http://qt.gtimg.cn/ — free, no API key. CN A-share Level-1 snapshots
 * (including bid/ask one) suitable for ordinary realtime watching at ~3s poll.
 */

import { Provider } from '../../core/provider/abstract/provider.js'
import { TencentEquityQuoteFetcher } from './models/equity-quote.js'

export const tencentProvider = new Provider({
  name: 'tencent',
  reprName: 'Tencent 腾讯财经',
  description:
    'Tencent Finance — free CN A-share Level-1 quote snapshots (qt.gtimg.cn).',
  website: 'https://gu.qq.com',
  vendorMeta: {
    coverage:
      'CN A-shares (SSE/SZSE) Level-1 realtime snapshots — last, OHLC, volume, bid/ask one, change %.',
    howToUse:
      'EquityQuote only. Symbols: sh600519 / sz000001, Yahoo 600519.SS / 000001.SZ, ' +
      'Eastmoney secid 1.600519 / 0.000001, or bare 6-digit codes. Batch with commas. ' +
      'Poll every 3–5s for ordinary watching (exchange L1 itself refreshes ~3s). ' +
      'Send Referer https://gu.qq.com; prefer batch over per-symbol requests.',
  },
  fetcherDict: {
    EquityQuote: TencentEquityQuoteFetcher,
  },
})
