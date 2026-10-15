import { describe, expect, it } from 'vitest'

import { bootstrapBackendConnection } from './backendConnection'

describe('backend connection bootstrap', () => {
  it('derives the browser endpoint from its own origin', () => {
    expect(bootstrapBackendConnection({
      href: 'http://127.0.0.1:40123/chat?view=recent',
      electron: false,
    })).toEqual({ kind: 'local', endpoint: '127.0.0.1:40123' })
  })

  it('keeps Electron integrated mode distinct from the browser relay', () => {
    expect(bootstrapBackendConnection({
      href: 'app://openalice/chat',
      electron: true,
    })).toEqual({ kind: 'electron' })
  })
})
