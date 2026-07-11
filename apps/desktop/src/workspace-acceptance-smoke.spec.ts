import { describe, expect, it, vi } from 'vitest'

import { runRendererWorkspaceAcceptanceSmoke } from './workspace-acceptance-smoke.js'

describe('Workspace acceptance renderer source', () => {
  it('preserves literal newline escapes until Git Bash receives the command', async () => {
    const executeJavaScript = vi.fn(async () => ({}))
    const win = { webContents: { executeJavaScript } }

    await runRendererWorkspaceAcceptanceSmoke(win as never, 'http://127.0.0.1:1234/v1')
    const source = executeJavaScript.mock.calls[0]?.[0] ?? ''

    for (const marker of ['CLI_ENV', 'CLI_MANIFESTS', 'GIT', 'WORKSPACE_CLI_CONTRACT']) {
      expect(source).toContain(`"printf '__OPENALICE_%s_OK__\\\\n' '${marker}'"`)
    }
  })
})
