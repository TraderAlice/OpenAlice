import { describe, expect, it } from 'vitest'
import { projectLifecycleEnvironment, validateProjectControl } from './project-control.ts'

describe('client project controls', () => {
  it('rejects arbitrary destinations and occupied/default creation selectors', () => {
    for (const input of [
      { machine: 'host;rm', project: 'main', action: 'start' },
      { machine: 'local', project: '../main', action: 'start' },
      { machine: 'cloud', project: 'default', action: 'create', home: '/srv/main' },
      { machine: 'cloud', project: 'main', action: 'create', home: '~/main' },
      { machine: 'cloud', project: 'main', action: 'create', home: '/srv/main\nother' },
    ]) expect(() => validateProjectControl(input)).toThrow()
    expect(validateProjectControl({ machine: 'cloud', project: 'main', action: 'create', home: '/srv/my project' }).home).toBe('/srv/my project')
  })
  it('isolates the selected project from inherited relay runtime state', () => {
    const base = { OPENALICE_HOME: '/old', AQ_LAUNCHER_ROOT: '/old/workspaces', OPENALICE_PROJECT_ID: 'old-id', OPENALICE_PORT: '47331', OPENALICE_SUPERVISOR_HOME: '/client', OPENALICE_GLOBAL_DIR: '/global' }
    const env = projectLifecycleEnvironment('/new', base)
    expect(env).toMatchObject({ OPENALICE_HOME: '/new', AQ_LAUNCHER_ROOT: '/new/workspaces', OPENALICE_SUPERVISOR_HOME: '/client', OPENALICE_GLOBAL_DIR: '/global' })
    expect(env).not.toHaveProperty('OPENALICE_PROJECT_ID')
    expect(env).not.toHaveProperty('OPENALICE_PORT')
    expect(base.OPENALICE_HOME).toBe('/old')
  })
})
