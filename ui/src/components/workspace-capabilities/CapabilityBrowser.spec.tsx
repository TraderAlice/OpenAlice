// @vitest-environment jsdom
import { cleanup, fireEvent, render, screen } from '@testing-library/react'
import { afterEach, beforeEach, expect, it, vi } from 'vitest'
import { i18n } from '../../i18n'
import { CapabilityBrowser, CliBrowser } from './CapabilityBrowser'
vi.mock('./AliceHarnessPanel', () => ({ AliceHarnessPanel: () => null }))
vi.mock('../../hooks/useWorkspaceCapabilities', async (importOriginal) => ({
  ...(await importOriginal<
    typeof import('../../hooks/useWorkspaceCapabilities')
  >()),
  useWorkspaceCapabilities: () => ({
    data: {
      errors: [],
      roots: ['.agents/skills'],
      instructions: [],
      skills: [
        {
          name: 'alpha',
          owner: 'alice-harness',
          path: '.agents/skills/alpha/SKILL.md',
          locations: ['.agents/skills/alpha/SKILL.md'],
          content: {
            kind: 'ok',
            content: '# Alpha method\n\nUnique research text.',
          },
        },
        {
          name: 'beta',
          owner: 'workspace',
          path: '.agents/skills/beta/SKILL.md',
          locations: ['.agents/skills/beta/SKILL.md'],
          content: { kind: 'ok', content: '# Beta method' },
        },
      ],
    },
  }),
  useWorkspaceCli: () => ({
    data: {
      groupDescriptions: { test: 'Testing' },
      groups: {
        test: {
          inspect: {
            description: 'Inspect evidence',
            schema: {
              properties: {
                symbol: { type: 'string', description: 'Asset symbol' },
              },
              required: ['symbol'],
            },
          },
        },
      },
    },
  }),
}))
vi.mock('../workspace/api', async (importOriginal) => ({
  ...(await importOriginal<typeof import('../workspace/api')>()),
  listFiles: vi.fn(async () => ({ entries: [] })),
}))
beforeEach(async () => {
  await i18n.changeLanguage('en')
})
afterEach(cleanup)
it('searches actual skill content and keeps reading and source views available', () => {
  render(<CapabilityBrowser wsId="one" view="skills" resolvePath={(p) => p} />)
  fireEvent.change(screen.getByRole('searchbox'), {
    target: { value: 'Unique research' },
  })
  expect(screen.getByRole('button', { name: /alpha/ })).toBeTruthy()
  expect(screen.queryByRole('button', { name: /beta/ })).toBeNull()
  fireEvent.click(screen.getByRole('tab', { name: 'Source' }))
  expect(screen.getByText(/# Alpha method/)).toBeTruthy()
})
it('shows required flags and raw schema without offering execution', () => {
  render(<CliBrowser wsId="one" />)
  expect(screen.getByText('alice test inspect --symbol <symbol>')).toBeTruthy()
  expect(screen.getByText('Required')).toBeTruthy()
  expect(screen.getByText('Asset symbol')).toBeTruthy()
  expect(
    screen.queryByRole('button', { name: /execute|run command/i }),
  ).toBeNull()
})

it('collapses command groups without losing the reader and reveals search matches', () => {
  render(<CliBrowser wsId="one" />)
  const group = screen.getByRole('button', { name: 'test' })
  fireEvent.click(group)
  expect(group.getAttribute('aria-expanded')).toBe('false')
  expect(screen.getByText('alice test inspect --symbol <symbol>')).toBeTruthy()
  expect(screen.queryByRole('button', { name: 'inspect' })).toBeNull()
  fireEvent.change(screen.getByRole('searchbox'), { target: { value: 'inspect' } })
  expect(screen.getByRole('button', { name: 'inspect' })).toBeTruthy()
  fireEvent.change(screen.getByRole('searchbox'), { target: { value: '' } })
  expect(group.getAttribute('aria-expanded')).toBe('false')
  fireEvent.click(group)
  expect(screen.getByRole('button', { name: 'inspect' })).toBeTruthy()
})

it('separates ownership groups while keeping source/mirror identity independent', () => {
  render(<CapabilityBrowser wsId="one" view="skills" resolvePath={(p) => p} />)
  expect(screen.getByRole('heading', { name: 'Alice Harness injected 1' })).toBeTruthy()
  expect(screen.getByRole('heading', { name: 'Workspace supplied 1' })).toBeTruthy()
  fireEvent.click(screen.getByRole('button', { name: /beta/ }))
  expect(screen.getByText(/Supplied by the Workspace template or added locally/)).toBeTruthy()
  fireEvent.change(screen.getByRole('searchbox'), { target: { value: 'beta' } })
  expect(screen.queryByRole('heading', { name: /Alice Harness injected 1/ })).toBeNull()
})

it('keeps one mirror and attachment section when switching Skills repeatedly', () => {
  const { container } = render(<CapabilityBrowser wsId="one" view="skills" resolvePath={(p) => p} />)
  for (const name of ['beta', 'alpha', 'beta', 'alpha']) {
    fireEvent.click(screen.getByRole('button', { name: new RegExp(name) }))
    expect(container.querySelectorAll('.cap-mirrors')).toHaveLength(1)
    expect(screen.getAllByText(i18n.t('capabilities.files'))).toHaveLength(1)
  }
})
