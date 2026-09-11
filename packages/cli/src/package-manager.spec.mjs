import { describe, expect, it } from 'vitest'

import {
  packageManagerForSource,
  packageManagerUninstallMessage,
  packageManagerUpdateMessage,
} from './package-manager.mjs'

describe('package-manager ownership guidance', () => {
  it.each([
    ['npm', 'npm install -g openalice@latest', 'npm uninstall -g openalice'],
    ['bun', 'bun add -g --trust openalice@latest', 'bun remove -g openalice'],
    ['brew', 'brew upgrade traderalice/tap/openalice', 'brew uninstall traderalice/tap/openalice'],
    ['aur', 'paru -S openalice-bin', 'paru -Rns openalice-bin'],
  ])('routes %s lifecycle commands back to its owner', (method, update, uninstall) => {
    const source = { schemaVersion: 3, method }
    expect(packageManagerUpdateMessage(source)).toContain(update)
    expect(packageManagerUninstallMessage(source)).toContain(uninstall)
  })

  it('does not claim direct or legacy installs', () => {
    expect(packageManagerForSource({ schemaVersion: 3, method: 'direct' })).toBeNull()
    expect(packageManagerForSource({ schemaVersion: 2 })).toBeNull()
  })
})
