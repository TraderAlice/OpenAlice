// @vitest-environment jsdom
import { useState } from 'react'
import { cleanup, render, screen } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { afterEach, describe, expect, it } from 'vitest'
import { i18n } from '../i18n'
import { PrimaryNavigationToggle, useNavigationToggleFocus } from './PrimaryNavigationToggle'
import { PrimaryNavigationContext } from '../contexts/PrimaryNavigationContext'
import { PageContentLayout, PageTopBar } from './PageTopBar'

afterEach(cleanup)

describe('primary navigation toggle', () => {
  it('moves between the brand and the portal toolbar, retaining keyboard focus with one visible control', async () => {
    await i18n.changeLanguage('en')
    const user = userEvent.setup()
    function View() {
      const [collapsed, setCollapsed] = useState(false)
      const focus = useNavigationToggleFocus()
      const toggle = <PrimaryNavigationToggle ref={focus.ref} collapsed={collapsed} onToggle={() => {
        focus.requestFocus()
        setCollapsed(!collapsed)
      }} />
      return <>
        <aside data-testid="brand">OpenAlice{!collapsed && toggle}</aside>
        <PrimaryNavigationContext.Provider value={collapsed ? toggle : null}>
          <PageContentLayout title="Chat"><PageTopBar title="New chat" /></PageContentLayout>
        </PrimaryNavigationContext.Provider>
      </>
    }
    render(<View />)
    const collapse = screen.getByRole('button', { name: 'Collapse activity bar' })
    expect(screen.getByTestId('brand').contains(collapse)).toBe(true)
    collapse.focus()
    await user.keyboard('{Enter}')
    const expand = screen.getByRole('button', { name: 'Expand activity bar' })
    expect(screen.getAllByRole('button')).toHaveLength(1)
    expect(expand.closest('[data-slot="page-topbar"]')).toBeTruthy()
    expect(document.activeElement).toBe(expand)
    await user.keyboard(' ')
    const restored = screen.getByRole('button', { name: 'Collapse activity bar' })
    expect(screen.getByTestId('brand').contains(restored)).toBe(true)
    expect(screen.getAllByRole('button')).toHaveLength(1)
    expect(document.activeElement).toBe(restored)
  })
  it('keeps focus on the same control when keyboard toggling its expanded state', async () => {
    await i18n.changeLanguage('en')
    const user = userEvent.setup()
    function View() {
      const [collapsed, setCollapsed] = useState(true)
      return <PrimaryNavigationToggle collapsed={collapsed} onToggle={() => setCollapsed(!collapsed)} />
    }
    render(<View />)
    const button = screen.getByRole('button', { name: 'Expand activity bar' })
    button.focus()
    await user.keyboard('{Enter}')
    expect(screen.getByRole('button', { name: 'Collapse activity bar' })).toBe(button)
    expect(button.getAttribute('aria-expanded')).toBe('true')
    expect(document.activeElement).toBe(button)
    await user.keyboard(' ')
    expect(button.getAttribute('aria-expanded')).toBe('false')
    expect(document.activeElement).toBe(button)
  })
})
