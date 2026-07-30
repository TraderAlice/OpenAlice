// @vitest-environment jsdom

import { cleanup, fireEvent, render, screen } from '@testing-library/react'
import { afterEach, describe, expect, it, vi } from 'vitest'

import type { BrokerHealthInfo, BrokerPreset, UTAConfig } from '../../api/types'
import { EditUTADialog } from './EditUTADialog'

const uta: UTAConfig = {
  id: 'alpaca-paper',
  label: 'Alpaca paper account with a deliberately long name',
  presetId: 'alpaca',
  enabled: true,
  guards: [],
  presetConfig: {},
  readOnly: true,
  asVendor: true,
}

const preset: BrokerPreset = {
  id: 'alpaca',
  label: 'Alpaca',
  description: 'Alpaca paper trading',
  category: 'recommended',
  defaultName: 'Alpaca',
  badge: 'AP',
  badgeColor: 'text-muted-foreground',
  engine: 'alpaca',
  guardCategory: 'securities',
  subtitleFields: [],
  schema: {
    type: 'object',
    properties: {},
  },
}

const health: BrokerHealthInfo = {
  status: 'healthy',
  reach: 'readable',
  tier: 'account',
  consecutiveFailures: 0,
  recovering: false,
  connecting: false,
  disabled: false,
}

afterEach(cleanup)

describe('EditUTADialog compact layout', () => {
  it('keeps identity and every footer action in wrapping mobile-safe regions', () => {
    render(
      <EditUTADialog
        uta={uta}
        preset={preset}
        health={health}
        onSave={vi.fn().mockResolvedValue(undefined)}
        onDelete={vi.fn().mockResolvedValue(undefined)}
        onViewInPortfolio={vi.fn()}
        onClose={vi.fn()}
      />,
    )

    const dialog = screen.getByRole('dialog', { name: `Edit ${uta.label}` })
    const close = screen.getByRole('button', { name: `Close ${uta.label} editor` })
    const footer = screen.getByTestId('edit-uta-footer')
    const body = screen.getByTestId('edit-uta-scroll')

    expect(dialog.className).toContain('sm:w-[560px]')
    expect(close.className).toContain('absolute')
    expect(close.className).toContain('sm:static')
    expect(screen.getByRole('button', { name: 'View in Portfolio' })).toBeTruthy()
    expect(body.className).toContain('min-h-0')
    expect(body.className).toContain('overflow-y-auto')
    expect(footer.firstElementChild?.className).toContain('flex-wrap')
    expect(screen.getByRole('button', { name: 'Delete UTA' }).className).toContain('shrink-0')

    fireEvent.click(screen.getByRole('switch', { name: 'Read-only account' }))
    expect(screen.getByRole('button', { name: 'Save' })).toBeTruthy()
    fireEvent.click(screen.getByRole('button', { name: 'Delete UTA' }))
    expect(screen.getByRole('button', { name: 'Confirm' })).toBeTruthy()
    expect(screen.getByRole('button', { name: 'Cancel' })).toBeTruthy()
  })
})
