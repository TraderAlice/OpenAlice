// @vitest-environment jsdom
import { act, renderHook, waitFor } from '@testing-library/react'
import { beforeEach, expect, it } from 'vitest'
import { useUpgradeRehearsal } from './useUpgradeRehearsal'
beforeEach(() => sessionStorage.clear())
it('restores an approved checkpoint through guarded command replay', async () => {
  const first = renderHook(useUpgradeRehearsal)
  await act(async () => first.result.current.dispatch({ type: 'publish', value: 'stable' }))
  const id = first.result.current.state.publication.records.at(-1)!.id
  for (let i = 0; i < 3; i++)
    await act(async () => first.result.current.dispatch({ type: 'advance', value: id }))
  await act(async () => first.result.current.dispatch({ type: 'discover' }))
  for (const type of ['review', 'approve', 'next', 'next', 'next'] as const)
    await act(async () => first.result.current.dispatch({ type }))
  expect(first.result.current.state.phase).toBe('suspended')
  first.unmount()
  const restored = renderHook(useUpgradeRehearsal)
  await waitFor(() => expect(restored.result.current.state.phase).toBe('suspended'))
  expect(restored.result.current.state.client).toBe('0.94.2')
  await act(async () => restored.result.current.dispatch({ type: 'channel', value: 'beta' }))
  expect(restored.result.current.state.target).toBe('0.94.2')
})
it('rejects malformed stored commands without breaking the page', () => {
  sessionStorage.setItem(
    'openalice.dev.upgrade-rehearsal.v3',
    '[{"type":"scenario","value":"__proto__"}]',
  )
  expect(renderHook(useUpgradeRehearsal).result.current.state.scenario).toBe(
    'together',
  )
})
