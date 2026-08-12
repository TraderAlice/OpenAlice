// @vitest-environment jsdom

import { act, renderHook, waitFor } from '@testing-library/react'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'

import { useAliceProject } from './useAliceProject'

const mocks = vi.hoisted(() => ({ get: vi.fn() }))

vi.mock('../api', () => ({
  api: { aliceProject: { get: mocks.get } },
}))

const project = {
  id: 'alice-project-0123456789abcdef',
  key: 'research',
  displayName: 'Research AliceProject',
  home: '/tmp/research',
  appRoot: '/tmp/source',
}

beforeEach(() => {
  mocks.get.mockResolvedValue({ project })
  Reflect.deleteProperty(window, 'openAlice')
})

afterEach(() => {
  vi.clearAllMocks()
  Reflect.deleteProperty(window, 'openAlice')
})

describe('useAliceProject', () => {
  it('selects the browser-backed project with loading semantics', async () => {
    const { result } = renderHook(() => useAliceProject())
    expect(result.current.loading).toBe(true)
    await waitFor(() => expect(result.current.loading).toBe(false))
    expect(result.current.project).toEqual(project)
    expect(result.current.error).toBeNull()
  })

  it('prefers the Electron runtime identity over HTTP', async () => {
    Object.defineProperty(window, 'openAlice', {
      configurable: true,
      value: { runtime: { info: vi.fn(async () => ({ aliceProject: project })) } },
    })
    const { result } = renderHook(() => useAliceProject())
    await waitFor(() => expect(result.current.project).toEqual(project))
    expect(mocks.get).not.toHaveBeenCalled()
  })

  it('reports errors and retries through the same domain boundary', async () => {
    mocks.get.mockRejectedValueOnce(new Error('backend offline'))
    const { result } = renderHook(() => useAliceProject())
    await waitFor(() => expect(result.current.error).toBe('backend offline'))

    await act(async () => { await result.current.refresh() })
    expect(result.current.project).toEqual(project)
    expect(result.current.error).toBeNull()
  })
})
