import { describe, expect, it } from 'vitest'
import {
  clearWebSessionCache,
  readWebSessionCache,
  writeWebSessionCache,
} from './web-session-cache'
import type { WebSessionSnapshot } from './api'

const snap = (revision: number): WebSessionSnapshot => ({
  revision,
  phase: 'idle',
  messages: [],
  requests: [],
  error: null,
}) as unknown as WebSessionSnapshot

describe('web-session-cache', () => {
  it('stores and returns the latest snapshot per session', () => {
    clearWebSessionCache()
    writeWebSessionCache('ws', 'a', snap(1))
    writeWebSessionCache('ws', 'a', snap(2))
    expect(readWebSessionCache('ws', 'a')?.revision).toBe(2)
    expect(readWebSessionCache('ws', 'missing')).toBeNull()
  })

  it('evicts the oldest entry beyond the retention cap', () => {
    clearWebSessionCache()
    writeWebSessionCache('ws', 'a', snap(1))
    writeWebSessionCache('ws', 'b', snap(2))
    writeWebSessionCache('ws', 'c', snap(3))
    writeWebSessionCache('ws', 'd', snap(4))
    expect(readWebSessionCache('ws', 'a')).toBeNull()
    expect(readWebSessionCache('ws', 'b')?.revision).toBe(2)
    expect(readWebSessionCache('ws', 'd')?.revision).toBe(4)
  })
})
