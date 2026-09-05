import { describe, expect, it } from 'vitest'
import { planDependencyInstallation } from './dependency-provider.mjs'
const missing = [{ id: 'git', status: 'missing' }, { id: 'bash', status: 'missing' }]
const find = names => async name => names.includes(name) ? `/tools/${name}` : null
describe('system dependency installation plans', () => {
  it('installs Git for Windows once without silently accepting agreements or upgrading', async () => {
    expect(await planDependencyInstallation(missing, { platform: 'win32' }, { find: find(['winget']) })).toEqual([
      { command: '/tools/winget', args: ['install', '--id', 'Git.Git', '--exact', '--source', 'winget', '--no-upgrade'], packages: ['Git.Git'] },
    ])
  })
  it('uses Homebrew without sudo on macOS', async () => {
    const [action] = await planDependencyInstallation(missing, { platform: 'darwin', uid: 501 }, { find: find(['brew']) })
    expect(action).toMatchObject({ command: '/tools/brew', args: ['install', 'git', 'bash'], requiresElevation: false })
  })
  it.each([['apt-get', ['install', 'git', 'bash']], ['dnf', ['install', 'git', 'bash']], ['pacman', ['-S', '--needed', 'git', 'bash']], ['apk', ['add', 'git', 'bash']]])('plans %s explicitly', async (manager, args) => {
    const actions = await planDependencyInstallation(missing, { platform: 'linux', uid: 1000 }, { find: find([manager, 'sudo']) })
    const action = actions.at(-1)
    if (manager === 'apt-get') expect(actions[0].args).toEqual(['/tools/apt-get', 'update'])
    expect(action).toMatchObject({ command: '/tools/sudo', args: [`/tools/${manager}`, ...args], requiresElevation: true })
  })
  it('requires manual installation when privilege escalation is unavailable', async () => {
    expect(await planDependencyInstallation(missing, { platform: 'linux', uid: 1000 }, { find: find(['apt-get']) })).toEqual([])
  })
  it('does not bootstrap another package manager', async () => {
    expect(await planDependencyInstallation(missing, { platform: 'darwin' }, { find: find([]) })).toEqual([])
  })
  it('requests only missing packages', async () => {
    const action = (await planDependencyInstallation([missing[1]], { platform: 'linux', uid: 0 }, { find: find(['apt-get']) })).at(-1)
    expect(action.args).toEqual(['install', 'bash'])
  })
})
