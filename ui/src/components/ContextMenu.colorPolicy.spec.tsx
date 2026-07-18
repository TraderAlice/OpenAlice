// @vitest-environment jsdom
import { cleanup, render, screen } from '@testing-library/react'
import { afterEach, describe, expect, it, vi } from 'vitest'
import { ContextMenu } from './ContextMenu'

afterEach(cleanup)

describe('ContextMenu destructive color policy', () => {
  it('binds danger actions to the invariant destructive channel', () => {
    render(<ContextMenu anchor={{ x: 0, y: 0 }} items={[{ kind: 'item', label: 'Delete', danger: true, onClick: vi.fn() }]} onClose={vi.fn()} />)
    expect(screen.getByRole('menuitem', { name: 'Delete' }).className).toContain('var(--oa-risk-destructive)')
  })
})
