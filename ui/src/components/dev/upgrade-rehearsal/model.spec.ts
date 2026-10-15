import { describe, expect, it } from 'vitest'
import { initial, reduce, plan, runtimePlans, runtimeTargetVersion, releaseSnapshot, type State } from './model'
async function approved(s: State) {
  s = await reduce(s, { type: 'publish', value: 'stable' })
  const id = s.publication.records.at(-1)!.id
  for (let i = 0; i < 3; i++) s = await reduce(s, { type: 'advance', value: id })
  s = await reduce(s, { type: 'discover' })
  return await reduce(await reduce(s, { type: 'review' }), { type: 'approve' })
}
async function until(s: State, phase: State['phase']) {
  for (let i = 0; i < 30 && s.phase !== phase; i++)
    s = await reduce(s, { type: s.phase === 'suspended' ? 'resume' : 'next' })
  return s
}
describe('upgrade rehearsal guards and recovery', () => {
  it('blocks backend-ahead plans and freezes approved choices', async () => {
    expect((await approved(initial('blocked'))).phase).toBe('review')
    const s = await approved(initial())
    expect(await reduce(s, { type: 'channel', value: 'beta' })).toEqual(s)
  })
  it('keeps installed separate from active until restart and resumes the same target', async () => {
    let s = await approved(initial())
    s = await reduce(await reduce(s, { type: 'next' }), { type: 'next' })
    expect([s.clientInstalled, s.client]).toEqual(['0.94.2', '0.94.1'])
    s = await reduce(s, { type: 'next' })
    expect(s.phase).toBe('suspended')
    expect((await until(s, 'done')).server).toBe('0.94.2')
  })
  it('retries reconnect without replaying the backend installation', async () => {
    const failed = await until(await approved(initial('reconnect')), 'failed')
    expect(failed.server).toBe('0.94.2')
    expect(failed.connected).toBe(false)
    const done = await until(await reduce(failed, { type: 'retry' }), 'done')
    expect(done.connected).toBe(true)
    expect(
      done.log.filter((l) => l === 'backend-install completed'),
    ).toHaveLength(1)
  })
  it('waits for idle before modifying workspace content', async () => {
    const blocked = await until(await approved(initial('busy')), 'blocked')
    expect(blocked.workspace).toBe('R1')
    expect((await until(await reduce(blocked, { type: 'release' }), 'done')).workspace).toBe(
      'R2',
    )
  })
  it('retains the complete captured release inventory', async () => {
    expect(releaseSnapshot.assets).toHaveLength(73)
    expect(new Set(releaseSnapshot.assets.map((a) => a.name)).size).toBe(73)
  })
})

it('upgrades only the older side of a frontend/backend mismatch', async () => {
  for (const scenario of ['client-ahead', 'server-ahead'] as const) {
    let s = initial(scenario)
    s = await reduce(await reduce(s, { type: 'review' }), { type: 'approve' })
    expect(
      s.steps.some((step) =>
        step.startsWith(scenario === 'client-ahead' ? 'client-' : 'backend-'),
      ),
    ).toBe(false)
    const done = await until(s, 'done')
    expect(done.phase).toBe('done')
    expect([done.client, done.server]).toEqual(['0.94.2', '0.94.2'])
  }
})
it('reconnects the upgraded backend before updating its managed Chat template', async () => {
  let s = initial('chat-follow')
  s = await reduce(await reduce(s, { type: 'review' }), { type: 'approve' })
  expect(s.steps.indexOf('backend-reconnect')).toBeLessThan(
    s.steps.indexOf('content-apply'),
  )
  const done = await until(s, 'done')
  expect(done.workspace).toBe('Chat template 2')
  expect(done.client).toBe('0.94.2')
})
it('updates an outdated Chat template without reinstalling current app/backend', async () => {
  let s = initial('chat-stale')
  s = await reduce(await reduce(s, { type: 'review' }), { type: 'approve' })
  expect(s.steps).toEqual(['content-check', 'content-apply', 'content-verify'])
  expect((await until(s, 'done')).workspace).toBe('Chat template 2')
})
it('keeps the backend upgrade while busy Chat waits, then applies only its template', async () => {
  let s = initial('chat-busy')
  s = await reduce(await reduce(s, { type: 'review' }), { type: 'approve' })
  s = await until(s, 'blocked')
  expect([s.server, s.workspace]).toEqual(['0.94.2', 'Chat template 1'])
  expect(s.connected).toBe(true)
  const done = await until(await reduce(s, { type: 'release' }), 'done')
  expect(done.workspace).toBe('Chat template 2')
  expect(
    done.log.filter((line) => line === 'backend-install completed'),
  ).toHaveLength(1)
})
it('does not downgrade a newer backend when the selected channel has no matching frontend', async () => {
  let s = initial('server-ahead')
  s = await reduce(s, { type: 'channel', value: 'beta' })
  s = await reduce(await reduce(s, { type: 'review' }), { type: 'approve' })
  expect(s.phase).toBe('done')
  expect(s.steps).toEqual([])
  expect(s.server).toBe('0.94.2')
})

it('does not complete activation when a different release starts after handoff', async () => {
  let s = await until(await approved(initial('client')), 'suspended')
  s = await reduce({ ...s, client: '0.94.3' }, { type: 'resume' })
  const failed = await reduce(s, { type: 'next' })
  expect(failed.phase).toBe('failed')
  expect(failed.clientInstalled).toBe('0.94.2')
  expect(failed.cursor).toBe(s.cursor)
})

it('rehearses an installed stable release with an old beta process through the shared plan', async () => {
  let s = initial('pending-activation')
  expect(runtimePlans(s).backend.stages).toEqual(['activate', 'verify', 'reconnect'])
  expect(plan(s)).toEqual(['backend-activate', 'backend-verify', 'backend-reconnect'])
  s = await reduce(await reduce(s, { type: 'review' }), { type: 'approve' })
  const done = await until(s, 'done')
  expect(done.server).toBe('0.94.1')
  expect(done.operations.backend?.completed).toEqual(['activate', 'verify', 'reconnect'])
  expect(done.log.some(line => line.includes('backend-install'))).toBe(false)
})
it('retains stable when the client requests the same-base older beta', async () => {
  const s = initial('stable-over-beta')
  expect(runtimePlans(s).backend.target?.version).toBe('0.94.1')
  expect(plan(s)).toEqual([])
})
it('activates the retained installed target when an older client reconnects to a pending upgrade', async () => {
  let s = { ...initial('stable-over-beta'), server: '0.94.1-beta.2' }
  expect(runtimeTargetVersion(s, 'backend')).toBe('0.94.1')
  s = await reduce(await reduce(s, { type: 'review' }), { type: 'approve' })
  const done = await until(s, 'done')
  expect(done.server).toBe('0.94.1')
  expect(done.phase).toBe('done')
  expect(done.operations.backend?.completed).toEqual(['activate', 'verify', 'reconnect'])
})

it('uses identical production coordinator event traces for the same activation-only evidence', async () => {
  const { UpdateCoordinator } = await import('@traderalice/update-lifecycle')
  let simulation = await reduce(await reduce(initial('pending-activation'), { type: 'review' }), { type: 'approve' })
  let journal = structuredClone(simulation.coordinated!)
  let clock = 0
  const production = new UpdateCoordinator({ read: async () => journal, write: async next => { journal = next } }, {
    reconcile: async () => ({ status: 'ready' }),
    execute: async step => ({ status: 'complete', receipt: `simulated:${step.id}` }),
  }, () => `step-${clock}`)
  while (simulation.phase === 'running') {
    simulation = await reduce(simulation, { type: 'next' })
    await production.run(1)
    expect(simulation.coordinated).toEqual(journal)
    clock++
  }
  expect(journal.phase).toBe('succeeded')
})
