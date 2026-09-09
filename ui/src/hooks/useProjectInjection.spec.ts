// @vitest-environment jsdom
import { act, cleanup, renderHook, waitFor } from '@testing-library/react'
import { afterEach, expect, it, vi } from 'vitest'
import { fetchJson } from '../api/client'
import { applyTemplateUpgrade, type TemplateUpgradePlan } from '../components/workspace/api'
import { useProjectInjection, useSkillProjection, injectionStatus, type InjectionWorkspace } from './useProjectInjection'
vi.mock('../api/client', () => ({ fetchJson: vi.fn() }))
vi.mock('../components/workspace/api', () => ({ applyTemplateUpgrade: vi.fn() }))
afterEach(() => { cleanup(); vi.resetAllMocks() })
const row = (id: string, extra = {}): InjectionWorkspace => ({ id, name: id, template: 'chat', plan: { planDigest: `digest-${id}`, fromVersion: 'old', toVersion: 'new', blocked: false, summary: { ready: 1, conflicts: 0, preserved: 0, unchanged: 0 }, ...extra } as TemplateUpgradePlan })
it('uses reviewed digests, skips unsafe rows and continues after one failure', async () => {
  vi.mocked(fetchJson).mockResolvedValue({ version: 'new', skills: [], commands: {}, workspaces: [row('a'), row('b'), row('conflict', { summary: { conflicts: 1 } }), row('busy', { blocked: true }), row('current', { fromVersion: 'new', summary: { ready: 0 } })] })
  vi.mocked(applyTemplateUpgrade).mockRejectedValueOnce(new Error('stale preview')).mockResolvedValueOnce({} as never)
  const { result } = renderHook(useProjectInjection)
  await waitFor(() => expect(result.current.data).not.toBeNull())
  await act(async () => { await result.current.updateReady() })
  expect(applyTemplateUpgrade).toHaveBeenCalledTimes(2)
  expect(applyTemplateUpgrade).toHaveBeenCalledWith('a', 'digest-a', {}, 'alice-harness')
  expect(result.current.results).toEqual({ a: 'stale preview', b: 'ok' })
})
it('distinguishes matching unrecorded files from updates and local customization', () => {
  expect(injectionStatus(row('one', { summary: { ready: 0, conflicts: 0 } }))).toBe('record')
  expect(injectionStatus(row('one', { fromVersion: 'new', summary: { ready: 0, conflicts: 0, preserved: 1 } }))).toBe('customized')
})
it('does not apply a retained catalog after a refresh failure', async () => {
  vi.mocked(fetchJson).mockResolvedValueOnce({ version: 'new', workspaces: [row('a')], skills: [], commands: {} }).mockRejectedValueOnce(new Error('offline'))
  const { result } = renderHook(useProjectInjection)
  await waitFor(() => expect(result.current.data).not.toBeNull())
  act(() => result.current.refresh())
  await waitFor(() => expect(result.current.error).toBe('offline'))
  await act(async () => { await result.current.updateReady() })
  expect(applyTemplateUpgrade).not.toHaveBeenCalled()
})

it('loads file comparisons only on demand and clears old content on selection or error', async () => {
  vi.mocked(fetchJson).mockResolvedValueOnce({ name: 'alice', files: [] }).mockRejectedValueOnce(new Error('cannot read copy'))
  const { result, rerender } = renderHook(({ enabled, skill }) => useSkillProjection('ws-1', skill, enabled), { initialProps: { enabled: false, skill: 'alice' } })
  expect(fetchJson).not.toHaveBeenCalled()
  rerender({ enabled: true, skill: 'alice' })
  await waitFor(() => expect(result.current.data?.name).toBe('alice'))
  rerender({ enabled: true, skill: 'traderhub' })
  await waitFor(() => expect(result.current.error).toBe('cannot read copy'))
  expect(result.current.data).toBeNull()
  expect(fetchJson).toHaveBeenLastCalledWith('/api/workspaces/ws-1/alice-harness/skills/traderhub', expect.objectContaining({ signal: expect.any(AbortSignal) }))
})
