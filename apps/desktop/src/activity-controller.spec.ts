import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { ActivityController, type ActivityDisplay } from './activity-controller.js'
import { DEFAULT_ACTIVITY_PREFERENCES as defaults } from './activity-policy.js'
import type { AgentRuntimeEvent } from './activity-journal-types.js'
function event(seq: number, type = 'dev.sonner_test', payload: Record<string, unknown> = { testState: 'success', message: 'PRIVATE' }): AgentRuntimeEvent {
  return { seq, ts: Date.now(), type: type as AgentRuntimeEvent['type'], payload }
}
function setup() {
  let identity: string | null = 'project-a:1', foreground = true, petVisible = true
  const read = vi.fn().mockResolvedValue({ entries: [], lastSeq: 0 })
  const sent: Array<{ surface: string; event: ActivityDisplay }> = []
  const open = vi.fn()
  const controller = new ActivityController({ identity: () => identity, read }, {
    foreground: () => foreground, petVisible: () => petVisible, open,
    send: (surface, event) => sent.push({ surface, event }),
  }, structuredClone(defaults))
  return { controller, read, sent, open,
    setIdentity: (value: string | null) => { identity = value },
    background: () => { foreground = false; controller.transition() },
    hidePet: () => { petVisible = false; controller.transition() },
    page: async (entries: AgentRuntimeEvent[], lastSeq = Math.max(0, ...entries.map(e => e.seq))) => {
      read.mockResolvedValueOnce({ entries, lastSeq }); await controller.poll()
    },
  }
}
beforeEach(() => { vi.useFakeTimers(); vi.setSystemTime(new Date('2026-09-30T12:00:00Z')) })
afterEach(() => { vi.useRealTimers() })
describe('desktop Journal arbitration', () => {
  it('stops without querying a destroyed surface or restarting after late work', async () => {
    let destroyed = false
    let identity = 'project-a'
    const foreground = vi.fn(() => {
      if (destroyed) throw new Error('Object has been destroyed')
      return true
    })
    const read = vi.fn().mockResolvedValue({ entries: [], lastSeq: 0 })
    const send = vi.fn()
    const controller = new ActivityController({ identity: () => identity, read }, {
      foreground, petVisible: () => false, send, open: vi.fn(),
    }, structuredClone(defaults))
    await controller.poll()
    read.mockResolvedValueOnce({ entries: [event(1)], lastSeq: 1 })
    await controller.poll()
    let resolve!: (value: unknown) => void
    read.mockImplementationOnce((_query, signal) => {
      expect(signal).toBeInstanceOf(AbortSignal)
      return new Promise(r => { resolve = r })
    })
    const pending = controller.poll()
    const calls = foreground.mock.calls.length
    destroyed = true
    expect(() => controller.stop()).not.toThrow()
    expect(() => controller.stop()).not.toThrow()
    controller.transition()
    controller.setPreferences(structuredClone(defaults))
    identity = 'project-b'
    await controller.poll()
    resolve({ entries: [event(2)], lastSeq: 2 })
    await pending
    await vi.advanceTimersByTimeAsync(60_000)
    expect(foreground).toHaveBeenCalledTimes(calls)
    expect(read).toHaveBeenCalledTimes(3)
    expect(send.mock.calls.filter(([, message]) => message.type === 'show')).toHaveLength(1)
    expect(controller.snapshot()).toEqual([])
    expect(vi.getTimerCount()).toBe(0)
  })
  it('silences historical baseline, announces one new revision and keeps replay silent', async () => {
    const s = setup(); await s.page([event(1)]); expect(s.sent).toEqual([])
    await s.page([event(2)]); expect(s.sent.filter(e => e.event.type === 'show')).toHaveLength(1)
    await s.page([event(2)]); expect(s.sent.filter(e => e.event.type === 'show')).toHaveLength(1); s.controller.stop()
  })
  it('chooses foreground vs already visible pet, keeps privacy and never replays on transition', async () => {
    const s = setup(); await s.page([]); await s.page([event(1)])
    const first = s.sent[0]; expect(first.surface).toBe('main')
    s.background(); await s.page([event(1)]); expect(s.sent.filter(e => e.event.type === 'show')).toHaveLength(1)
    await s.page([event(2)]); const pet = s.sent.at(-1)!; expect(pet.surface).toBe('pet')
    expect(JSON.stringify(pet)).not.toContain('PRIVATE'); expect(pet.event).toMatchObject({ input: { title: 'Work completed' } })
    s.hidePet(); await s.page([event(3)]); expect(s.sent.filter(e => e.event.type === 'show')).toHaveLength(2); s.controller.stop()
  })
  it('rejects stale/invalid actions and routes only active matching surface tokens', async () => {
    const s = setup(); await s.page([]); s.background(); await s.page([event(1,'news.ingested',{newsItemId: 3,source:'Private source',title:'Private headline'})])
    const displayId = s.sent[0].event.displayId
    expect(s.controller.open({url:'https://evil'}, 'pet')).toBe(false)
    expect(s.controller.open(displayId, 'main')).toBe(false)
    expect(s.controller.open(displayId,'pet')).toBe(true); expect(s.open).toHaveBeenCalledWith('news')
    expect(s.controller.open(displayId,'pet')).toBe(false)
    await s.page([event(2)]); const stale = s.sent.at(-1)!.event.displayId; s.setIdentity('project-b:2')
    expect(s.controller.open(stale,'pet')).toBe(false); s.controller.stop()
  })
  it('discards old-source in-flight responses and baselines the new project', async () => {
    const s = setup(); await s.page([])
    let resolve!: (value: unknown) => void
    s.read.mockReturnValueOnce(new Promise(r => { resolve = r }))
    const request = s.controller.poll(); s.setIdentity('project-b:2'); s.read.mockResolvedValueOnce({entries:[event(5)],lastSeq:5}); await s.controller.poll()
    resolve({ entries: [event(1)], lastSeq: 1 }); await request
    await s.page([event(5)]); expect(s.sent).toEqual([])
    await s.page([event(6)]); expect(s.sent[0].event.type).toBe('show'); s.controller.stop()
  })
  it('bounds reconnect backlog, rejects invalid schema, serializes polling and resets restarted journals', async () => {
    const s = setup(); await s.page([])
    s.read.mockRejectedValueOnce(new Error('offline')); await s.controller.poll()
    await s.page([event(1)],1000); expect(s.sent).toEqual([])
    await s.page([event(1001)]); expect(s.sent.filter(e => e.event.type === 'show')).toHaveLength(1)
    s.read.mockResolvedValueOnce({entries:'invalid', lastSeq:1002}); await s.controller.poll()
    await s.page([event(1)]); expect(s.sent.filter(e => e.event.type === 'show')).toHaveLength(1)
    await s.page([event(2)]); expect(s.sent.filter(e => e.event.type === 'show')).toHaveLength(2); s.controller.stop()
  })
  it('coalesces news, preempts with errors, expires/dismisses without task mutation', async () => {
    const s = setup(); await s.page([]); s.background()
    await s.page([event(1,'news.ingested',{newsItemId:1,source:'feed',title:'a'}),event(2,'news.ingested',{newsItemId:2,source:'feed',title:'b'})])
    expect(s.sent.at(-1)?.event).toMatchObject({ input: { count:2, title:'News updated' } })
    await s.page([event(3,'dev.sonner_test',{testState:'error',message:'error'})]); expect(s.sent.at(-1)?.event).toMatchObject({input:{status:'error'}})
    const id=s.sent.at(-1)!.event.displayId; expect(s.controller.dismiss(id,'pet')).toBe(true); expect(s.open).not.toHaveBeenCalled()
    await vi.advanceTimersByTimeAsync(10_000); s.controller.stop()
  })
  it('shares preference filtering, pause and lifecycle updates', async () => {
    const s = setup(); await s.page([])
    await s.page([event(1,'dev.sonner_test',{testState:'running'})]); expect(s.sent).toEqual([])
    s.controller.setPreferences({...defaults, events:{...defaults.events,progress:true}})
    await s.page([event(2,'runtime.started',{workspaceId:'w',resumeId:'r',taskId:'t',agent:'a',cause:{kind:'conversation',from:{kind:'session'}}})])
    const id=s.sent.at(-1)!.event.displayId
    await s.page([event(3,'runtime.stopped',{workspaceId:'w',resumeId:'r',taskId:'t',status:'done'})])
    expect(s.sent.at(-1)?.event).toMatchObject({ displayId:id, input:{status:'success'} })
    s.controller.setPreferences({...defaults, pausedUntil:Date.now()+3600000})
    await s.page([event(4)]); const count=s.sent.filter(e=>e.event.type==='show').length
    await vi.advanceTimersByTimeAsync(3600001); await s.page([event(5)]); expect(s.sent.filter(e=>e.event.type==='show')).toHaveLength(count+1);s.controller.stop()
  })
})
