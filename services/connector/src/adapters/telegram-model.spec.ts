import { expect, it, vi } from 'vitest'
import type { Context } from 'grammy'
import type { ConnectorModelPanel, ConnectorModelRequest } from '@traderalice/connector-protocol'
import { TelegramModelControls } from './telegram-model.js'
const panel: ConnectorModelPanel = { resumeId: 'session', revision: 'v1', runtime: 'codex', selection: { credential: 'native', model: null, effort: null }, credentials: [{ id: 'native', label: 'Runtime login' }, { id: 'vault:a', label: 'Account' }], models: Array.from({ length: 15 }, (_, i) => ({ id: `model-${i}`, label: `Model ${i}` })), efforts: ['low', 'medium'], running: true, saved: false }
function fixture() {
  let markup: any; let now = 0
  const ctx = { chat: { id: 1 }, callbackQuery: { message: { message_id: 2 }, data: '' },
    reply: vi.fn(async (_text, options) => { if (options) markup = options.reply_markup; return { message_id: 2 } }),
    editMessageText: vi.fn(async (_text, options) => { markup = options.reply_markup }), answerCallbackQuery: vi.fn(async (_options?: unknown) => {}) }
  const call = vi.fn(async (r: ConnectorModelRequest) => ({ ...panel, selection: r.selection ?? panel.selection, saved: r.apply ?? false }))
  const controls = new TelegramModelControls(() => now)
  const click = async (text: string) => { ctx.callbackQuery.data = markup.inline_keyboard.flat().find((b: any) => b.text.includes(text)).callback_data; await controls.handle(ctx as never, call) }
  return { ctx, call, controls, click, expire: () => { now = 700_000 }, markup: () => markup, context: ctx as unknown as Context }
}
it('paginates, previews then explicitly saves; callback data contains only opaque UI coordinates', async () => {
  const f = fixture(); await f.controls.open(f.context, f.call)
  await f.click('Model'); await f.click('Next'); await f.click('Model 6')
  expect(f.call.mock.lastCall?.[0]).toMatchObject({ selection: { model: 'model-6', effort: null } })
  expect(f.call.mock.calls.every(([r]) => !r.apply)).toBe(true)
  await f.click('Save'); expect(f.call.mock.lastCall?.[0].apply).toBe(true)
  expect(f.ctx.editMessageText.mock.lastCall?.[0]).toContain('Saved')
  for (const b of f.markup().inline_keyboard.flat()) { expect(Buffer.byteLength(b.callback_data)).toBeLessThanOrEqual(64); expect(b.callback_data).not.toContain('vault:') }
})
it('clears dependent options on credential change and leaves Close without a save', async () => {
  const f = fixture(); await f.controls.open(f.context, f.call)
  await f.click('Credential'); await f.click('Account')
  expect(f.call.mock.lastCall?.[0].selection).toEqual({ credential: 'vault:a', model: null, effort: null })
  await f.click('Close'); expect(f.call.mock.calls.some(([r]) => r.apply)).toBe(false)
})
it('rejects expired and cross-message callbacks and reports failed saves', async () => {
  const f = fixture(); await f.controls.open(f.context, f.call)
  f.call.mockRejectedValueOnce(new Error('Session changed'))
  await f.click('Save'); expect(f.ctx.reply.mock.lastCall?.[0]).toContain('Session changed')
  f.expire(); await f.click('Save'); expect(f.ctx.answerCallbackQuery.mock.lastCall?.[0]).toMatchObject({ text: expect.stringContaining('expired') })
  expect(f.call).toHaveBeenCalledTimes(2)
})
