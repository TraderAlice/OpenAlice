import { cleanup, render, screen } from '@testing-library/react'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { createDemoConnectorSnapshot } from '../demo/fixtures/connectors'
import { ConnectorStatusPage } from './ConnectorStatusPage'
import { ConnectorsPage } from './ConnectorsPage'

const mocks = vi.hoisted(() => ({
  load: vi.fn(),
  save: vi.fn(),
  test: vi.fn(),
  openOrFocus: vi.fn(),
}))

vi.mock('../api', async (importOriginal) => {
  const actual = await importOriginal<typeof import('../api')>()
  return {
    ...actual,
    api: {
      ...actual.api,
      connectors: {
        load: mocks.load,
        save: mocks.save,
        test: mocks.test,
      },
    },
  }
})

vi.mock('../tabs/store', () => ({
  useWorkspace: (selector: (state: { openOrFocus: typeof mocks.openOrFocus }) => unknown) =>
    selector({ openOrFocus: mocks.openOrFocus }),
}))

beforeEach(() => {
  vi.clearAllMocks()
  mocks.load.mockImplementation(async () => createDemoConnectorSnapshot())
  mocks.save.mockImplementation(async (config) => ({ config }))
  mocks.test.mockResolvedValue({ ok: true, probeId: 'connector-probe-demo' })
})

afterEach(() => cleanup())

describe('Connector demo routes', () => {
  it('renders the read-only operations route from the demo snapshot', async () => {
    render(<ConnectorStatusPage />)

    expect(await screen.findByText('Connector Service')).toBeTruthy()
    expect(screen.getByText('Discord')).toBeTruthy()
    expect(screen.getByText('Telegram')).toBeTruthy()
    expect(screen.getByText(/External delivery is disabled/)).toBeTruthy()
  })

  it('renders the Connector configuration route from the demo snapshot', async () => {
    render(<ConnectorsPage />)

    expect(await screen.findByText('Run external notification connectors')).toBeTruthy()
    expect(screen.getByText('Discord')).toBeTruthy()
    expect(screen.getByText('Telegram')).toBeTruthy()
    expect(screen.getByText('Application ID')).toBeTruthy()
    expect(screen.getAllByText('Bot token')).toHaveLength(2)
  })
})
