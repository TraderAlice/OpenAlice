import { cleanup, render, screen } from '@testing-library/react'
import { afterEach, beforeEach, describe, expect, it } from 'vitest'

import { demoThemeFamily } from '../demo/fixtures/themes'
import { useThemeStore } from '../theme/store'
import { FileContentView } from './FileContentView'

beforeEach(() => {
  useThemeStore.setState({
    families: [demoThemeFamily('tinted-base16', 'Report test', ['light', 'dark'])],
    appearance: {
      activeFamilyId: 'demo-tinted-base16-report-test',
      mode: 'light',
      terminal: { mode: 'follow' },
      marketColors: 'protected',
      marketDirection: 'green-up-red-down',
      statusColors: 'protected',
    },
    status: 'ready',
  })
})

afterEach(() => {
  cleanup()
  useThemeStore.setState({ families: [], appearance: null, status: 'idle' })
})

describe('FileContentView', () => {
  it('renders .html reports in the isolated report viewer', () => {
    render(<FileContentView path="research/close.html" result={{ kind: 'ok', content: '<h1>Close</h1>' }} />)

    expect(screen.getByTitle('HTML report: research/close.html')).toBeTruthy()
  })

  it('does not treat the legacy .htm extension as an HTML report', () => {
    render(<FileContentView path="research/legacy.htm" result={{ kind: 'ok', content: '<h1>Legacy</h1>' }} />)

    expect(screen.queryByTitle('HTML report: research/legacy.htm')).toBeNull()
    expect(screen.getByText('<h1>Legacy</h1>')).toBeTruthy()
  })
})
