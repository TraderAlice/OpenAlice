import { describe, expect, it, vi } from 'vitest'

import {
  planProdPorts,
  readProdPortsFile,
  resolveProdPortConfig,
} from './prod-ports.mjs'

describe('built Guardian port planning', () => {
  it('retains env, file, and default provenance', () => {
    expect(resolveProdPortConfig(
      { OPENALICE_WEB_PORT: '49123' },
      { mcp: 49200 },
    )).toEqual({
      web: { value: 49123, source: 'env' },
      mcp: { value: 49200, source: 'file' },
      uta: { value: 47333, source: 'default' },
      connector: { value: 47334, source: 'default' },
    })
  })

  it('probes unconfigured internal ports above an explicit Web port', async () => {
    const probe = vi.fn(async (
      start: number,
      max?: number,
    ) => max === undefined ? start + 1 : start)
    const config = resolveProdPortConfig(
      { OPENALICE_WEB_PORT: '49123' },
      {},
    )

    await expect(planProdPorts(config, {
      probe,
      skipUta: true,
    })).resolves.toEqual({
      web: 49123,
      mcp: 49125,
      uta: 47333,
      connector: 47335,
    })
    expect(probe).toHaveBeenNthCalledWith(1, 49123, 49123)
    expect(probe).toHaveBeenNthCalledWith(2, 49124)
    expect(probe).toHaveBeenNthCalledWith(3, 47334)
  })

  it('fails loudly when an explicit internal port is occupied', async () => {
    const config = resolveProdPortConfig({}, { mcp: 49200 })
    const probe = vi.fn(async (start: number, max?: number) => {
      if (start === 49200 && max === 49200) throw new Error('occupied')
      return start
    })

    await expect(planProdPorts(config, { probe })).rejects.toThrow(
      'port 49200 (mcp, from data/config/ports.json) is already in use',
    )
  })

  it('does not stall port planning when a client connects to the temporary probe', async () => {
    const acceptedSockets: Array<{ destroy: ReturnType<typeof vi.fn> }> = []
    const createServerImpl = vi.fn((onConnection: (
      socket: { destroy: ReturnType<typeof vi.fn> },
    ) => void) => {
      const socket = { destroy: vi.fn() }
      acceptedSockets.push(socket)
      return {
        unref: vi.fn(),
        once: vi.fn(),
        listen: vi.fn((
          _port: number,
          _host: string,
          onListening: () => void,
        ) => onListening()),
        close: vi.fn((onClose: () => void) => {
          onConnection(socket)
          if (socket.destroy.mock.calls.length > 0) onClose()
        }),
      }
    })
    const config = resolveProdPortConfig({
      OPENALICE_WEB_PORT: '49123',
      OPENALICE_MCP_PORT: '49124',
    }, {})
    let timeout: ReturnType<typeof setTimeout> | undefined
    const stalled = new Promise<'stalled'>((resolveResult) => {
      timeout = setTimeout(() => resolveResult('stalled'), 50)
    })

    const result = await Promise.race([
      planProdPorts(config, {
        createServerImpl,
        skipUta: true,
        skipConnector: true,
      }),
      stalled,
    ])
    if (timeout !== undefined) clearTimeout(timeout)

    expect(result).toEqual({
      web: 49123,
      mcp: 49124,
      uta: 47333,
      connector: 47334,
    })
    expect(acceptedSockets).toHaveLength(2)
    expect(acceptedSockets.every((socket) => (
      socket.destroy.mock.calls.length === 1
    ))).toBe(true)
  })

  it('reads and validates the persisted port file', async () => {
    await expect(readProdPortsFile('/test-home', {
      readFileImpl: async () => '{"web":49123,"connector":49126}',
    })).resolves.toEqual({
      web: 49123,
      connector: 49126,
    })
    await expect(readProdPortsFile('/test-home', {
      readFileImpl: async () => '{"web":"bad"}',
    })).rejects.toThrow('expected an integer in 1..65535')
  })
})
