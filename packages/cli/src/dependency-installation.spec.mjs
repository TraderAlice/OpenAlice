import { describe, expect, it, vi } from 'vitest'
import { coordinateDependencies } from './dependency-installation.mjs'

const missing = [{ id: 'git', status: 'missing' }]
const available = [{ id: 'git', status: 'available', executable: '/user/git' }]
function fixture(overrides = {}) {
  return {
    inspect: vi.fn().mockResolvedValue(missing),
    plan: vi.fn().mockResolvedValue([{ command: '/manager', args: ['install', 'git'] }]),
    confirm: vi.fn().mockResolvedValue(true),
    execute: vi.fn().mockResolvedValue({ code: 0 }),
    refresh: vi.fn(),
    interactive: true,
    ...overrides,
  }
}
describe('installation dependency coordination', () => {
  it('reuses working dependencies without planning upgrades or asking consent', async () => {
    const f = fixture({ inspect: vi.fn().mockResolvedValue(available) })
    expect((await coordinateDependencies(f)).status).toBe('ready')
    expect(f.plan).not.toHaveBeenCalled()
    expect(f.confirm).not.toHaveBeenCalled()
    expect(f.execute).not.toHaveBeenCalled()
  })
  it.each(['invalid', 'unsupported'])('does not overwrite an existing %s installation', async status => {
    const f = fixture({ inspect: vi.fn().mockResolvedValue([{ id: 'git', status }]) })
    expect((await coordinateDependencies(f)).status).toBe('repair-required')
    expect(f.execute).not.toHaveBeenCalled()
  })
  it('never prompts or executes in noninteractive mode', async () => {
    const f = fixture({ interactive: false })
    expect((await coordinateDependencies(f)).status).toBe('needs-consent')
    expect(f.confirm).not.toHaveBeenCalled()
    expect(f.execute).not.toHaveBeenCalled()
  })
  it('respects declined consent', async () => {
    const f = fixture({ confirm: vi.fn().mockResolvedValue(false) })
    expect((await coordinateDependencies(f)).status).toBe('declined')
    expect(f.execute).not.toHaveBeenCalled()
  })
  it('reports unsupported installation without attempting a fallback', async () => {
    const f = fixture({ plan: vi.fn().mockResolvedValue([]) })
    expect((await coordinateDependencies(f)).status).toBe('manual-install')
    expect(f.execute).not.toHaveBeenCalled()
  })
  it('stops on installation failure', async () => {
    const f = fixture({ execute: vi.fn().mockResolvedValue({ code: 7 }) })
    expect(await coordinateDependencies(f)).toMatchObject({ status: 'install-failed', code: 7 })
    expect(f.refresh).not.toHaveBeenCalled()
  })
  it('reports spawn failures', async () => {
    const f = fixture({ execute: vi.fn().mockRejectedValue(new Error('ENOENT')) })
    expect(await coordinateDependencies(f)).toMatchObject({ status: 'install-failed', error: 'Error: ENOENT' })
  })
  it('requires a successful probe after installation', async () => {
    const f = fixture()
    expect((await coordinateDependencies(f)).status).toBe('verification-failed')
    expect(f.inspect).toHaveBeenCalledTimes(2)
  })
  it('refreshes discovery before validating installation and is repeatable', async () => {
    let installed = false
    const f = fixture({ inspect: vi.fn(async () => installed ? available : missing), refresh: vi.fn(async () => { installed = true }) })
    expect((await coordinateDependencies(f)).status).toBe('ready')
    expect((await coordinateDependencies(f)).status).toBe('ready')
    expect(f.execute).toHaveBeenCalledTimes(1)
  })
})
