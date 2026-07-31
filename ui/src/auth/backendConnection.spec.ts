import { describe, expect, it, vi } from 'vitest'

import { bootstrapBackendConnection } from './backendConnection'

describe('backend connection bootstrap', () => {
  it('consumes valid SSH identity from a client-only fragment', () => {
    const writeStored = vi.fn()
    const replaceUrl = vi.fn()

    expect(bootstrapBackendConnection({
      href: 'http://127.0.0.1:40123/chat?view=recent#openalice-remote=1&target=alice%40example.com&ssh-port=2222&runtime-port=48000',
      electron: false,
      readStored: () => null,
      writeStored,
      replaceUrl,
    })).toEqual({
      kind: 'remote',
      target: 'alice@example.com',
      sshPort: 2222,
      runtimePort: 48000,
      localEndpoint: '127.0.0.1:40123',
    })
    expect(writeStored).toHaveBeenCalledWith(JSON.stringify({
      version: 1,
      target: 'alice@example.com',
      sshPort: 2222,
      runtimePort: 48000,
    }))
    expect(replaceUrl).toHaveBeenCalledWith('/chat?view=recent')
  })

  it('restores remote identity for reloads in the same browser tab', () => {
    expect(bootstrapBackendConnection({
      href: 'http://127.0.0.1:40123/issues',
      electron: false,
      readStored: () => JSON.stringify({
        version: 1,
        target: 'research-box',
        sshPort: 22,
        runtimePort: 47331,
      }),
      writeStored: vi.fn(),
      replaceUrl: vi.fn(),
    })).toEqual({
      kind: 'remote',
      target: 'research-box',
      sshPort: 22,
      runtimePort: 47331,
      localEndpoint: '127.0.0.1:40123',
    })
  })

  it('rejects malformed remote metadata and derives the actual surface', () => {
    const replaceUrl = vi.fn()
    expect(bootstrapBackendConnection({
      href: 'http://localhost:5173/chat#openalice-remote=1&target=host%20name&ssh-port=22&runtime-port=oops',
      electron: false,
      readStored: () => '{"version":1,"target":"old-host","sshPort":22,"runtimePort":47331}',
      writeStored: vi.fn(),
      replaceUrl,
    })).toEqual({ kind: 'local', endpoint: 'localhost:5173' })
    expect(replaceUrl).toHaveBeenCalledWith('/chat')

    expect(bootstrapBackendConnection({
      href: 'app://openalice/chat',
      electron: true,
      readStored: () => null,
      writeStored: vi.fn(),
      replaceUrl: vi.fn(),
    })).toEqual({ kind: 'electron' })
  })
})
