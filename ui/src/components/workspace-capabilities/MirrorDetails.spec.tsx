// @vitest-environment jsdom
import { cleanup, fireEvent, render, screen } from '@testing-library/react'
import { afterEach, beforeEach, expect, it, vi } from 'vitest'
import { i18n } from '../../i18n'
import { MirrorDetails } from './MirrorDetails'
vi.mock('../../hooks/useWorkspaceMirrors', () => ({
  useWorkspaceMirror: () => ({
    differences: [
      {
        path: 'scripts/run.py',
        status: 'changed',
        source: { kind: 'text', content: 'primary code' },
        mirror: { kind: 'text', content: 'runtime edit' },
      },
    ],
  }),
}))
beforeEach(async () => {
  await i18n.changeLanguage('en')
})
afterEach(cleanup)
it('shows a divergent mirror under the source and opens both file contents', () => {
  render(
    <MirrorDetails
      wsId="one"
      instructions={false}
      skill={{
        name: 'test',
        path: '.agents/skills/test/SKILL.md',
        content: { kind: 'ok', content: 'same' },
        locations: [],
        source: 'canonical',
        mirrors: [
          { path: '.claude/skills/test', label: 'Claude', present: true },
        ],
      }}
    />,
  )
  expect(
    screen.getByText('Differences found', { selector: 'span' }),
  ).toBeTruthy()
  fireEvent.click(screen.getByText(/Claude/).closest('summary')!)
  fireEvent.click(screen.getByRole('button', { name: /scripts\/run.py/ }))
  expect(screen.getByText('primary code')).toBeTruthy()
  expect(screen.getByText('runtime edit')).toBeTruthy()
  expect(screen.queryByRole('button', { name: /sync|overwrite/i })).toBeNull()
})
