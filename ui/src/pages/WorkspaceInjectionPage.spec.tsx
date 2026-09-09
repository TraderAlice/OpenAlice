// @vitest-environment jsdom
import { cleanup, fireEvent, render, screen } from '@testing-library/react'
import { afterEach, beforeEach, expect, it, vi } from 'vitest'
import { i18n } from '../i18n'
import { WorkspaceInjectionPage } from './WorkspaceInjectionPage'
const mock = vi.hoisted(() => ({ update: vi.fn() }))
vi.mock('../hooks/useProjectInjection', async (original) => ({ ...await original<typeof import('../hooks/useProjectInjection')>(), useProjectInjection: () => ({ data: { version: '1.0.0', skills: [{ name: 'alice', files: [{ path: 'SKILL.md', content: '# Project source' }] }], commands: { alice: { rss: ['read'] } }, workspaces: [{ id: 'one', name: 'Research desk', template: 'chat', plan: { fromVersion: 'old', toVersion: 'new', summary: { ready: 1, conflicts: 0 }, blocked: false } }] }, error: null, busy: false, results: {}, refresh: vi.fn(), updateReady: mock.update }) }))
vi.mock('../components/workspace-capabilities/AliceHarnessPanel', () => ({ AliceHarnessPanel: () => null }))
vi.mock('../components/workspace/WorkspaceTemplateUpgradePanel', () => ({ WorkspaceTemplateUpgradePanel: () => <div>Skill file review</div> }))
beforeEach(async () => { await i18n.changeLanguage('en') })
afterEach(cleanup)
it('offers Project-level updates and a separate source browser', () => {
  render(<WorkspaceInjectionPage />)
  expect(screen.getByRole('button', { name: 'Choose Workspace' })).toBeTruthy()
  fireEvent.click(screen.getByText('Full injection updates'))
  fireEvent.click(screen.getByRole('button', { name: 'Update eligible (1)' }))
  expect(mock.update).toHaveBeenCalledOnce()
  fireEvent.click(screen.getByRole('tab', { name: 'Project prototype' }))
  fireEvent.click(screen.getByRole('button', { name: 'alice' }))
  expect(screen.getByText('# Project source')).toBeTruthy()
})
