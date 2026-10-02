// @vitest-environment jsdom
import { act, cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react'
import { BrowserRouter, useLocation, useNavigate } from 'react-router-dom'
import { afterEach, beforeEach, expect, it, vi } from 'vitest'
import { en } from '../../../ui/src/i18n/locales/en'
import { SettingsCategoryList } from '../../../ui/src/components/SettingsCategoryList'
import { UrlAdopter } from '../../../ui/src/tabs/UrlAdopter'
import { useWorkspace } from '../../../ui/src/tabs/store'
import { getFocusedTab, type ViewSpec } from '../../../ui/src/tabs/types'

vi.mock('react-i18next', () => ({ useTranslation: () => ({ t: (key: string) => key.split('.').reduce((value: any, part) => value?.[part], en) ?? key }) }))
vi.mock('../../../ui/src/hooks/useAliceProject', () => ({ useAliceProject: () => ({ project: { product: 'trader' } }) }))
vi.mock('../../../ui/src/hooks/useUpdateLifecycle', () => ({ useUpdateLifecycle: () => ({ guidance: {} }) }))
vi.mock('../../../ui/src/tabs/registry', () => ({ getView: () => ({ toUrl: (spec: ViewSpec) => spec.kind === 'settings'
  ? spec.params.category === 'general' ? '/settings' : `/settings/${spec.params.category}`
  : spec.kind === 'dev' ? `/settings/developer/${spec.params.tab}` : '/' }) }))

function Surface() {
  const focused = useWorkspace(state => getFocusedTab(state)?.spec)
  const location = useLocation()
  const navigate = useNavigate()
  return <>
    <SettingsCategoryList />
    <p data-testid="content">{focused?.kind === 'settings' ? focused.params.category : focused?.kind === 'dev' ? focused.params.tab : ''}</p>
    <p data-testid="route">{location.pathname}</p>
    <button onClick={() => navigate(-1)}>Browser back</button>
    <button onClick={() => navigate(1)}>Browser forward</button>
  </>
}

beforeEach(() => {
  localStorage.clear(); sessionStorage.clear()
  useWorkspace.setState({ tabs: {}, tree: { kind: 'leaf', group: { id: 'g1', tabIds: [], activeTabId: null } }, focusedGroupId: 'g1', selectedSidebar: null })
  history.replaceState({}, '', '/settings/machines')
})
afterEach(cleanup)
async function expectView(content: string, route: string) {
  await waitFor(() => {
    expect(screen.getByTestId('content').textContent).toBe(content)
    expect(screen.getByTestId('route').textContent).toBe(route)
    expect(window.location.pathname).toBe(route)
  })
}

it('keeps actual Router, tab content and history synchronized across Machines and Developer', async () => {
  render(<BrowserRouter><UrlAdopter /><Surface /></BrowserRouter>)
  await expectView('machines', '/settings/machines')
  fireEvent.click(screen.getByRole('button', { name: 'Developer' }))
  fireEvent.click(screen.getByRole('button', { name: 'Logs' }))
  await expectView('logs', '/settings/developer/logs')
  fireEvent.click(screen.getByRole('button', { name: 'Machines' }))
  await expectView('machines', '/settings/machines')
  fireEvent.click(screen.getByRole('button', { name: 'Overview' }))
  await expectView('general', '/settings')
  fireEvent.click(screen.getByText('Browser back'))
  await expectView('machines', '/settings/machines')
  fireEvent.click(screen.getByText('Browser back'))
  await expectView('logs', '/settings/developer/logs')
  fireEvent.click(screen.getByText('Browser forward'))
  await expectView('machines', '/settings/machines')
})

it('readopts a same-path navigation after an external tab switch only projected the native URL', async () => {
  render(<BrowserRouter><UrlAdopter /><Surface /></BrowserRouter>)
  await expectView('machines', '/settings/machines')
  act(() => useWorkspace.getState().openOrFocus({ kind: 'dev', params: { tab: 'logs' } }))
  await waitFor(() => expect(screen.getByTestId('content').textContent).toBe('logs'))
  expect(screen.getByTestId('route').textContent).toBe('/settings/machines')
  expect(window.location.pathname).toBe('/settings/developer/logs')
  fireEvent.click(screen.getByRole('button', { name: 'Machines' }))
  await expectView('machines', '/settings/machines')
})
