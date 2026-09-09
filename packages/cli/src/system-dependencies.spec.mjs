import { describe, expect, it, vi } from 'vitest'
import { dependencyCandidates, inspectSystemDependencies } from './system-dependencies.mjs'

describe('system dependency discovery', () => {
  it('ignores empty and relative PATH entries and preserves explicit precedence', () => {
    expect(dependencyCandidates('git', { platform: 'linux', env: { PATH: ':/custom/bin:relative:/usr/bin:/custom/bin' } }))
      .toEqual(['/custom/bin/git', '/usr/bin/git'])
  })
  it('handles Windows Path casing and finds Git Bash beside custom Git', () => {
    const candidates = dependencyCandidates('bash', { platform: 'win32', env: { Path: 'C:\\Windows\\System32;"D:\\Tools"', ProgramFiles: 'C:\\Program Files' }, gitExecutable: 'E:\\Git\\cmd\\git.exe' })
    expect(candidates).toEqual(['D:\\Tools\\bash.exe', 'E:\\Git\\bin\\bash.exe', 'C:\\Program Files\\Git\\bin\\bash.exe'])
  })
  it('finds per-user Windows installs', () => {
    expect(dependencyCandidates('git', { platform: 'win32', env: { LOCALAPPDATA: 'C:\\Users\\A\\AppData\\Local' } }))
      .toEqual(['C:\\Users\\A\\AppData\\Local\\Programs\\Git\\cmd\\git.exe'])
  })
  it('does not run probes for missing dependencies', async () => {
    const probe = vi.fn()
    expect(await inspectSystemDependencies({ platform: 'linux', env: { PATH: '/bin' } }, { exists: async () => false, probe }))
      .toEqual([{ id: 'git', status: 'missing' }, { id: 'bash', status: 'missing' }])
    expect(probe).not.toHaveBeenCalled()
  })
  it('probes real capability rather than trusting filenames', async () => {
    const checks = await inspectSystemDependencies({ platform: 'linux', env: { PATH: '/bin' } }, {
      exists: async () => true, probe: async path => path.endsWith('git') ? 'git version 2.50.0' : '5.2.0(1)-release',
    })
    expect(checks.map(check => check.status)).toEqual(['available', 'available'])
  })
  it('retains a broken higher-priority executable for manual repair', async () => {
    const probe = vi.fn().mockRejectedValue(new Error('permission denied'))
    const checks = await inspectSystemDependencies({ required: ['git'], platform: 'linux', env: { PATH: '/custom:/usr/bin' } }, { exists: async () => true, probe })
    expect(checks).toEqual([{ id: 'git', executable: '/custom/git', status: 'invalid', detail: 'permission denied' }])
    expect(probe).toHaveBeenCalledTimes(1)
  })
  it('rejects unrelated executable output', async () => {
    const checks = await inspectSystemDependencies({ required: ['bash'], platform: 'linux', env: { PATH: '/bin' } }, { exists: async () => true, probe: async () => 'not bash' })
    expect(checks[0].status).toBe('invalid')
  })
  it('discovers custom Windows Git Bash using the verified Git path', async () => {
    const checks = await inspectSystemDependencies({ platform: 'win32', env: { Path: 'D:\\Git\\cmd' } }, {
      exists: async path => ['D:\\Git\\cmd\\git.exe', 'D:\\Git\\bin\\bash.exe'].includes(path),
      probe: async path => path.endsWith('git.exe') ? 'git version 2.50.0.windows.1' : '5.2.37',
    })
    expect(checks[1]).toMatchObject({ executable: 'D:\\Git\\bin\\bash.exe', status: 'available' })
  })
})
