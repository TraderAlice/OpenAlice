import { cleanup, fireEvent, render, screen } from '@testing-library/react'
import { afterEach, describe, expect, it, vi } from 'vitest'

import type { BrokerPreset } from '../../api/types'
import { CreateUTADialog } from './CreateUTADialog'

const brokerPreset: BrokerPreset = {
  id: 'okx',
  label: 'OKX',
  description: 'OKX Unified Trading Account.',
  category: 'recommended',
  defaultName: 'OKX',
  badge: 'OK',
  badgeColor: 'text-text-muted',
  engine: 'ccxt',
  guardCategory: 'crypto',
  subtitleFields: [],
  schema: {
    type: 'object',
    properties: {
      apiKey: { type: 'string', title: 'API key', writeOnly: true },
    },
    required: ['apiKey'],
  },
}

function setup(props: Partial<Parameters<typeof CreateUTADialog>[0]> = {}) {
  const onClose = vi.fn()
  const onSave = vi.fn()
  const onOpenExisting = vi.fn()
  render(
    <CreateUTADialog
      presets={[brokerPreset]}
      onClose={onClose}
      onSave={onSave}
      onOpenExisting={onOpenExisting}
      {...props}
    />,
  )
  return { onClose, onSave, onOpenExisting }
}

afterEach(() => {
  cleanup()
  vi.clearAllMocks()
})

describe('CreateUTADialog', () => {
  it('uses broker-facing setup labels instead of internal UTA labels', () => {
    setup()

    expect(screen.getByText('Connect Broker · Pick Platform')).toBeTruthy()
    expect(screen.getByLabelText('Close broker setup')).toBeTruthy()
  })

  it('can default a readonly onboarding account to read-only', () => {
    setup({ initialReadOnly: true })

    fireEvent.click(screen.getByText('OKX'))

    const switches = screen.getAllByRole('switch')
    expect(switches[0]?.getAttribute('aria-checked')).toBe('true')
    expect(switches[1]?.getAttribute('aria-checked')).toBe('true')
  })

  it('surfaces an onboarding escape action from every wizard step', () => {
    const onEscape = vi.fn()
    setup({ escapeAction: { label: 'Continue without UTA', onClick: onEscape } })

    fireEvent.click(screen.getByRole('button', { name: 'Continue without UTA' }))

    expect(onEscape).toHaveBeenCalled()
  })
})
