import { describe, it, expect } from 'vitest'
import { makeWorkspaceResolver } from './workspace-tool-center.js'

type Meta = { id: string; dir: string; tag: string }

function svc(map: Record<string, Meta>) {
  return { registry: { get: (id: string): Meta | undefined => map[id] } }
}

describe('makeWorkspaceResolver', () => {
  it('resolves a known id to {id, dir, tag}', () => {
    const resolve = makeWorkspaceResolver(() =>
      svc({ ws2: { id: 'ws2', dir: '/wsroot/ws2', tag: 'Quant Lab' } }),
    )
    expect(resolve('ws2')).toEqual({ id: 'ws2', dir: '/wsroot/ws2', tag: 'Quant Lab' })
  })

  it('returns null for an unknown id', () => {
    const resolve = makeWorkspaceResolver(() => svc({}))
    expect(resolve('ghost')).toBeNull()
  })

  it('returns null when the service is not up yet', () => {
    const resolve = makeWorkspaceResolver(() => null)
    expect(resolve('ws2')).toBeNull()
  })

  it('is lazy — a peer registered AFTER the resolver is built still resolves', () => {
    const map: Record<string, Meta> = {}
    const resolve = makeWorkspaceResolver(() => svc(map))
    expect(resolve('ws9')).toBeNull()
    map['ws9'] = { id: 'ws9', dir: '/wsroot/ws9', tag: 'Late' }
    expect(resolve('ws9')).toEqual({ id: 'ws9', dir: '/wsroot/ws9', tag: 'Late' })
  })
})
