import { createHash } from 'node:crypto'
import { Writable } from 'node:stream'
import { make, encodePNGToStream } from 'pureimage'
import { parse, type Font } from 'opentype.js'
import { z } from 'zod'
import { connectorAttachmentSchema, parseMarketReference, MARKET_REFERENCE_COUNT, type ConnectorAttachment } from '@traderalice/connector-protocol'
import fontBase64 from './chart-assets/sans.json' with { type: 'json' }
import { fetchAliceJson } from './workspace-files.js'

const barSchema = z.object({ date: z.string().min(1), open: z.number().finite(), high: z.number().finite(),
  low: z.number().finite(), close: z.number().finite(), volume: z.number().nonnegative().nullable() })
const chartSchema = z.object({ bars: z.array(barSchema).min(1).max(MARKET_REFERENCE_COUNT), meta: z.object({
  barId: z.string(), sourceId: z.string(), barCapability: z.string().optional(),
  freshness: z.object({ fetchedAt: z.string(), latestRecordAt: z.string().nullable(),
    delay: z.object({ status: z.string() }) }).optional(),
}) })
export type MarketChartData = z.infer<typeof chartSchema>

let chartFont: Font | undefined
/** Portable CPU renderer. No browser, native ABI, system font or Workspace write. */
export async function renderMarketChart(reference: string, input: unknown): Promise<ConnectorAttachment> {
  const market = parseMarketReference(reference)
  if (!market) throw new Error('Invalid market reference')
  const { bars, meta } = chartSchema.parse(input)
  if (meta.barId !== market.barId) throw new Error('Market source mismatch')
  if (bars.some(b => b.low > Math.min(b.open, b.close) || b.high < Math.max(b.open, b.close) || b.low > b.high)) throw new Error('Invalid OHLC data')
  if (!chartFont) {
    const bytes = Buffer.from(fontBase64, 'base64')
    chartFont = parse(bytes.buffer.slice(bytes.byteOffset, bytes.byteOffset + bytes.byteLength))
  }
  const font = chartFont
  const image = make(2400, 1600)
  const ctx = image.getContext('2d')
  ctx.scale(2, 2)
  ctx.fillStyle = '#10151f'; ctx.fillRect(0, 0, 1200, 800)
  const text = (value: string, x: number, y: number, size = 18, color = '#9caabd', max = 1100) => {
    ctx.fillStyle = color
    // Native keys can be long and non-Latin. Identity is also sent in the filename;
    // bounded labels keep the plot readable without assuming installed CJK fonts.
    let label = value.replace(/[^\x20-\x7e]/g, '?')
    while (label.length > 3 && font.getAdvanceWidth(label, size) > max) label = label.slice(0, -4) + '...'
    // Fill all contours together. PureImage.fillText fills each closed contour
    // separately, losing glyph holes (0, B, etc.) with TrueType fonts.
    ctx.beginPath()
    for (const command of font.getPath(label, x, y, size).commands) {
      switch (command.type) {
        case 'M': ctx.moveTo(command.x, command.y); break
        case 'L': ctx.lineTo(command.x, command.y); break
        case 'Q': ctx.quadraticCurveTo(command.x1, command.y1, command.x, command.y); break
        case 'C': ctx.bezierCurveTo(command.x1, command.y1, command.x2, command.y2, command.x, command.y); break
        case 'Z': ctx.closePath(); break
      }
    }
    ctx.fill()
  }
  text(market.barId, 40, 48, 26, '#f2f5fa')
  text(`${market.interval}  /  ${bars.length} bars  /  ${meta.barCapability ?? 'unspecified capability'}`, 40, 83)
  const first = bars[0]!, last = bars.at(-1)!
  text(`Last ${last.close.toLocaleString('en-US', { maximumSignificantDigits: 8 })}`, 40, 121, 24, '#f2f5fa')
  const left = 40, right = 1060, top = 155, bottom = 570, volTop = 595, volBottom = 670
  const lo = Math.min(...bars.map(b => b.low)), hi = Math.max(...bars.map(b => b.high))
  const pad = Math.max((hi - lo) * 0.07, Math.abs(hi) * 0.001, 0.000001)
  const min = lo - pad, max = hi + pad
  const y = (price: number) => bottom - (price - min) / (max - min) * (bottom - top)
  for (let i = 0; i <= 4; i++) {
    const value = min + (max - min) * i / 4, py = y(value)
    ctx.fillStyle = '#263142'; ctx.fillRect(left, py, right - left, 1)
    text(value.toLocaleString('en-US', { maximumSignificantDigits: 6 }), right + 12, py + 6, 16, '#9caabd', 115)
  }
  const step = (right - left) / bars.length
  const volumeMax = Math.max(1, ...bars.map(b => b.volume ?? 0))
  for (const [i, bar] of bars.entries()) {
    const x = left + (i + 0.5) * step
    ctx.fillStyle = bar.close >= bar.open ? '#50c9a6' : '#ed7691'
    ctx.fillRect(x - 0.6, y(bar.high), 1.2, Math.max(1, y(bar.low) - y(bar.high)))
    ctx.fillRect(x - step * 0.32, Math.min(y(bar.open), y(bar.close)), Math.max(1, step * 0.64), Math.max(1, Math.abs(y(bar.open) - y(bar.close))))
    const vh = (bar.volume ?? 0) / volumeMax * (volBottom - volTop)
    if (vh > 0) ctx.fillRect(x - step * 0.32, volBottom - vh, Math.max(1, step * 0.64), vh)
  }
  text(first.date, left, 696, 16, '#9caabd', 470)
  text(last.date, 640, 696, 16, '#9caabd', 470)
  text(`Last bar: ${meta.freshness?.latestRecordAt ?? last.date}`, 40, 731, 17)
  text(`Snapshot: ${meta.freshness?.fetchedAt ?? new Date().toISOString()}`, 630, 731, 17, '#9caabd', 530)
  text(`${meta.freshness?.delay.status === 'possible' ? 'Possible delay' : 'Delay unknown'}. Bar age is not feed latency.`, 40, 768, 17)
  const chunks: Buffer[] = []
  await encodePNGToStream(image, new Writable({ write(chunk: Buffer, _encoding, callback) { chunks.push(chunk); callback() } }))
  const bytes = Buffer.concat(chunks)
  return connectorAttachmentSchema.parse({ filename: `market-${market.barId.replace(/[^a-z0-9.-]/gi, '_').slice(0, 80)}-${market.interval}.png`,
    contentBase64: bytes.toString('base64'), sizeBytes: bytes.length, mediaType: 'image/png',
    contentSha256: createHash('sha256').update(bytes).digest('hex') })
}

export async function fetchMarketChart(reference: string): Promise<ConnectorAttachment> {
  const response = JSON.parse(await fetchAliceJson(`/cli/market-reference?${new URLSearchParams({ reference })}`)) as {
    content?: Array<{ type: string; text?: string }>; isError?: boolean
  }
  if (response.isError) throw new Error('Market data unavailable')
  const body = response.content?.find(block => block.type === 'text')?.text
  if (!body) throw new Error('Market data missing')
  return renderMarketChart(reference, JSON.parse(body))
}
