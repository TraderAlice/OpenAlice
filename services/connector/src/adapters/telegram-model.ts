import { randomBytes } from 'node:crypto'
import type { Context } from 'grammy'
import type { ConnectorModelPanel, ConnectorModelRequest } from '@traderalice/connector-protocol'

type Field = 'credential' | 'model' | 'effort'
type State = { panel: ConnectorModelPanel; expires: number; nonce: string; field?: Field; page: number; busy: boolean }
const PAGE_SIZE = 6
const TTL = 10 * 60_000
const nonce = () => randomBytes(6).toString('hex')
const key = (ctx: Context) => `${ctx.chat?.id}:${ctx.callbackQuery?.message?.message_id}`
const label = (value: string) => value.length > 60 ? `${value.slice(0, 57)}…` : value

/** Telegram owns transient UI state only. Alice owns options, validation and persistence. */
export class TelegramModelControls {
  private readonly states = new Map<string, State>()
  constructor(private readonly now: () => number = Date.now) {}

  async open(ctx: Context, call: (request: ConnectorModelRequest) => Promise<ConnectorModelPanel>, customModel?: string): Promise<void> {
    for (const [id, state] of this.states) if (state.expires < this.now()) this.states.delete(id)
    if (this.states.size >= 50) this.states.delete(this.states.keys().next().value!)
    try {
      let panel = await call({})
      if (customModel) panel = await call({ resumeId: panel.resumeId, revision: panel.revision, selection: { ...panel.selection, model: customModel, effort: null } })
      const state: State = { panel, expires: this.now() + TTL, nonce: nonce(), page: 0, busy: false }
      const message = await ctx.reply(this.text(state), { reply_markup: this.keyboard(state) })
      this.states.set(`${ctx.chat?.id}:${message.message_id}`, state)
    } catch (error) { await ctx.reply(this.error(error)) }
  }

  async handle(ctx: Context, call: (request: ConnectorModelRequest) => Promise<ConnectorModelPanel>): Promise<void> {
    const [, token, action, argument] = (ctx.callbackQuery?.data ?? '').split(':')
    const state = this.states.get(key(ctx))
    if (!state || state.expires < this.now() || state.nonce !== token) {
      await ctx.answerCallbackQuery({ text: 'This panel expired. Open /model again.' }); return
    }
    if (state.busy) { await ctx.answerCallbackQuery({ text: 'Saving your selection…' }); return }
    state.busy = true
    await ctx.answerCallbackQuery().catch(() => undefined)
    try {
      if (action === 'close') {
        await ctx.editMessageText('Model settings closed. No further changes saved.', { reply_markup: { inline_keyboard: [] } })
        this.states.delete(key(ctx)); return
      }
      if (action === 'field' && ['credential', 'model', 'effort'].includes(argument)) {
        state.field = argument as Field; state.page = 0
      } else if (action === 'page' && /^\d+$/.test(argument)) {
        state.page = Math.min(Number(argument), Math.max(0, Math.ceil(this.options(state).length / PAGE_SIZE) - 1))
      } else if (action === 'back') { state.field = undefined }
      else if (action === 'pick' && state.field && /^\d+$/.test(argument)) {
        const option = this.options(state)[Number(argument)]
        if (!option) throw new Error('This option is no longer available. Open /model again.')
        const selection = { ...state.panel.selection, [state.field]: option.id }
        if (state.field === 'credential') { selection.model = null; selection.effort = null }
        if (state.field === 'model') selection.effort = null
        state.panel = await call({ resumeId: state.panel.resumeId, revision: state.panel.revision, selection })
        state.field = undefined
      } else if (action === 'save') {
        state.panel = await call({ resumeId: state.panel.resumeId, revision: state.panel.revision, selection: state.panel.selection, apply: true })
        state.field = undefined
      } else { throw new Error('Unknown control. Open /model again.') }
      state.nonce = nonce()
      await ctx.editMessageText(this.text(state), { reply_markup: this.keyboard(state) })
    } catch (error) {
      // Keep draft state available for retry; a rejected save never claims success.
      await ctx.reply(this.error(error))
    } finally { state.busy = false }
  }

  private options(state: State): Array<{ id: string | null; label: string }> {
    return state.field === 'credential' ? state.panel.credentials
      : state.field === 'model' ? [{ id: null, label: state.panel.selection.credential === 'native' ? 'Runtime default' : 'Credential default' }, ...state.panel.models]
      : [{ id: null, label: 'Runtime default' }, ...state.panel.efforts.map(id => ({ id, label: id }))]
  }

  private text(state: State): string {
    const { panel } = state
    const credential = panel.credentials.find(c => c.id === panel.selection.credential)?.label ?? 'Unavailable'
    return [panel.saved ? 'Saved · applies to the next turn' : 'Session model settings · preview',
      `Runtime: ${panel.runtime} (fixed)`, `Credential: ${credential}`, `Model: ${panel.selection.model ?? (panel.selection.credential === 'native' ? 'Runtime default' : 'Credential default')}`,
      `Effort: ${panel.selection.effort ?? 'Runtime default'}`, '',
      panel.running ? 'The current run keeps its original settings.' : 'Changes affect this Session only.',
      'Choose options, then Save. Workspace defaults stay unchanged.',
      'For a custom model: /model <model-id>',
      ...(state.field ? ['', `Choose ${state.field} · page ${state.page + 1}/${Math.max(1, Math.ceil(this.options(state).length / PAGE_SIZE))}`] : []),
    ].join('\n')
  }

  private keyboard(state: State) {
    const button = (text: string, action: string) => ({ text: label(text), callback_data: `mdl:${state.nonce}:${action}` })
    const inline_keyboard = state.field
      ? this.options(state).slice(state.page * PAGE_SIZE, (state.page + 1) * PAGE_SIZE).map((option, index) => [button(`${state.panel.selection[state.field!] === option.id ? '✓ ' : ''}${option.label}`, `pick:${state.page * PAGE_SIZE + index}`)])
      : [[button('Credential', 'field:credential'), button('Model', 'field:model'), button('Effort', 'field:effort')], [button('Save', 'save'), button('Close', 'close')]]
    if (state.field) {
      const pages = []
      if (state.page > 0) pages.push(button('‹ Previous', `page:${state.page - 1}`))
      if ((state.page + 1) * PAGE_SIZE < this.options(state).length) pages.push(button('Next ›', `page:${state.page + 1}`))
      if (pages.length) inline_keyboard.push(pages)
      inline_keyboard.push([button('Back', 'back')])
    }
    return { inline_keyboard }
  }
  private error(error: unknown): string { return `Could not change model settings: ${error instanceof Error ? error.message : 'Open /model and try again.'}` }
}
