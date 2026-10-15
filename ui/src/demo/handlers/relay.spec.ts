// @vitest-environment jsdom
import { afterAll, beforeAll, expect, it } from 'vitest'
import { setupServer } from 'msw/node'
import { relayHandlers } from './relay'

const server = setupServer(...relayHandlers)
beforeAll(() => server.listen({ onUnhandledRequest: 'error' }))
afterAll(() => server.close())
const request = (path: string, body?: unknown) => fetch(`${window.location.origin}/relay/v1/${path}`, body === undefined ? undefined : {
  method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify(body),
})

it('simulates read-only add review, single-use approval and a new fleet row without changing the connection', async () => {
  const before = await (await request('status')).json()
  const plan = await (await request('machines/plan', { mode: 'add', label: 'Demo Linux', sshTarget: 'alice@demo.example.com' })).json()
  expect(plan.actions).toEqual([])
  expect((await (await request('fleet')).json()).machines.some((row: { displayName: string }) => row.displayName === 'Demo Linux')).toBe(false)
  const applied = await (await request('machines/apply', { id: plan.id })).json()
  const fleet = await (await request('fleet')).json()
  expect(fleet.machines.find((row: { key: string }) => row.key === applied.machineKey)).toMatchObject({ displayName: 'Demo Linux', sshTarget: 'alice@demo.example.com', connection: 'online' })
  expect(await (await request('status')).json()).toEqual(before)
  expect((await request('machines/apply', { id: plan.id })).status).toBe(409)
}, 10000)
