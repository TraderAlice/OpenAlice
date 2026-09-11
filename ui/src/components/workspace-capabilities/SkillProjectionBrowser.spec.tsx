// @vitest-environment jsdom
import { cleanup, fireEvent, render, screen } from '@testing-library/react'
import { afterEach, beforeEach, expect, it, vi } from 'vitest'
import { i18n } from '../../i18n'
import type { ProjectInjection, SkillProjection } from '../../hooks/useProjectInjection'
import { SkillProjectionBrowser, skillProjectionStatus } from './SkillProjectionBrowser'
const review = vi.hoisted(() => vi.fn())
vi.mock('../workspace/WorkspaceTemplateUpgradePanel', () => ({ WorkspaceTemplateUpgradePanel: (props: unknown) => { review(props); return <p>Scoped preview</p> } }))
const projection: SkillProjection = { name: 'alice', enabled: false, installed: false, canonicalPresent: false, customized: false, sourceChanged: true, mirrorDiverged: false, files: [] }
const data: ProjectInjection = { version: 'source', commands: {}, skills: [{ name: 'alice', files: [{ path: 'SKILL.md', content: '# Project prototype' }] }], workspaces: [{ id: 'ws-1', name: 'Research', template: 'chat', projections: [projection] }] }
beforeEach(async () => { await i18n.changeLanguage('en'); review.mockClear() })
afterEach(cleanup)
it('keeps an excluded prototype visible and opens a scoped install review', () => {
  render(<SkillProjectionBrowser data={data} disabled={false} onChange={() => {}} />)
  expect(screen.getByText('Not installed')).toBeTruthy()
  fireEvent.click(screen.getByRole('button', { name: 'Install' }))
  expect(review).toHaveBeenCalledWith(expect.objectContaining({ wsId: 'ws-1', layer: 'alice-harness', projection: { skill: 'alice', action: 'install' } }))
})
it('offers restore for customization without pretending there is a newer Project version', async () => {
  const customized = { ...projection, installed: true, canonicalPresent: true, customized: true, sourceChanged: false, files: [{ path: '.agents/skills/alice/SKILL.md', differs: true, truncated: false, unverified: false }] }
  render(<SkillProjectionBrowser data={{ ...data, workspaces: [{ ...data.workspaces[0]!, projections: [customized] }] }} disabled={false} onChange={() => {}} />)
  expect(screen.queryByRole('button', { name: /^Update$/ })).toBeNull()
  fireEvent.click(screen.getByRole('button', { name: 'More actions for alice' }))
  fireEvent.click(await screen.findByRole('menuitem', { name: 'Restore prototype' }))
  expect(review).toHaveBeenCalledWith(expect.objectContaining({ projection: { skill: 'alice', action: 'restore' } }))
})
it('searches prototypes and retains source browsing without a Workspace installation', () => {
  render(<SkillProjectionBrowser mode="project" data={data} disabled={false} onChange={() => {}} />)
  fireEvent.click(screen.getByRole('button', { name: 'alice' }))
  expect(screen.getByText('# Project prototype')).toBeTruthy()
  fireEvent.change(screen.getByRole('textbox', { name: 'Search Skills' }), { target: { value: 'missing' } })
  expect(screen.getByText('No matching Skills')).toBeTruthy()
})
it('distinguishes missing, mismatched and unverified copies', () => {
  expect(skillProjectionStatus({ ...projection, installed: true })).toBe('missingPrimary')
  expect(skillProjectionStatus({ ...projection, files: [{ path: 'link', unverified: true, differs: true, truncated: false }] })).toBe('unverified')
})

it('allows re-enabling an excluded Skill even when customized files were kept', () => {
  render(<SkillProjectionBrowser data={{ ...data, workspaces: [{ ...data.workspaces[0]!, projections: [{ ...projection, installed: true, canonicalPresent: true, customized: true }] }] }} disabled={false} onChange={() => {}} />)
  expect(screen.getByRole('button', { name: 'Install' })).toBeTruthy()
})

it('shows recorded injection versions and the complete revision on hover', () => {
  render(<SkillProjectionBrowser data={{ ...data, version: '1.1.0+newrevision', workspaces: [{ ...data.workspaces[0]!, projections: [{ ...projection, installed: true, enabled: true, canonicalPresent: true, injectedVersion: '1.0.0+oldrevision', injectedAt: '2026-09-08T00:00:00Z' }] }] }} disabled={false} onChange={() => {}} />)
  expect(screen.getByTitle('1.0.0+oldrevision · 2026-09-08T00:00:00Z')).toBeTruthy()
  expect(screen.getByText('oldrevi')).toBeTruthy()
  expect(screen.getByText('1.1.0')).toBeTruthy()
})
