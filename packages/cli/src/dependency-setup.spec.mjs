import { expect, it, vi } from 'vitest'
import { runDependencySetup } from './dependency-setup.mjs'

it.each([['--check'], ['--json']])('setup %s is read-only even in a terminal', async flag => {
  const execute = vi.fn()
  const confirm = vi.fn()
  const output = []
  const code = await runDependencySetup([flag], {
    inspect: async () => [{ id: 'git', status: 'missing' }],
    plan: async () => [{ command: '/bin/manager', args: ['install', 'git'] }],
    write: text => output.push(text), interactive: true, execute, confirm,
  })
  expect(code).toBe(1)
  expect(execute).not.toHaveBeenCalled()
  expect(confirm).not.toHaveBeenCalled()
  if (flag === '--json') expect(JSON.parse(output.join('')).status).toBe('needs-consent')
})

it('setup help does not inspect the machine', async () => {
  const inspect = vi.fn()
  expect(await runDependencySetup(['--help'], { inspect, write: () => {} })).toBe(0)
  expect(inspect).not.toHaveBeenCalled()
})

it('rejects unknown arguments rather than silently starting installation', async () => {
  await expect(runDependencySetup(['--yes'])).rejects.toThrow('Unknown setup option')
})

it('does not prepend successful setup output to a startup JSON response', async () => {
  const write = vi.fn()
  expect(await runDependencySetup(['--json'], { quietReady: true, inspect: async () => [{ id: 'git', status: 'available' }], write })).toBe(0)
  expect(write).not.toHaveBeenCalled()
})

it('explains a failed installer launch and how to resume', async () => {
  const output = []
  const code = await runDependencySetup([], {
    inspect: async () => [{ id: 'git', status: 'missing' }],
    plan: async () => [{ command: '/missing/manager', args: ['install', 'git'] }],
    interactive: true, confirm: async () => true,
    execute: async () => { throw new Error('spawn ENOENT') },
    write: text => output.push(text),
  })
  expect(code).toBe(1)
  expect(output.join('')).toContain('spawn ENOENT')
  expect(output.join('')).toContain('Run openalice setup to retry')
})
