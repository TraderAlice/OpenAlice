import { describe, expect, it } from 'vitest'

import { AGENT_INSTALL, installHintFor } from './agentInstall'

describe('installHintFor', () => {
  it('keeps npm one-liners on Windows', () => {
    expect(installHintFor('claude', 'Win32')).toEqual(AGENT_INSTALL.claude)
  })

  it('hides pipe-to-shell install commands on Windows', () => {
    expect(installHintFor('cursor', 'Win32')).toEqual({ url: AGENT_INSTALL.cursor!.url })
    expect(installHintFor('agy', 'Windows')).toEqual({ url: AGENT_INSTALL.agy!.url })
    expect(installHintFor('grok', 'Win32')).toEqual({ url: AGENT_INSTALL.grok!.url })
    expect(installHintFor('omp', 'Win32')).toEqual({ url: AGENT_INSTALL.omp!.url })
  })

  it('keeps pipe-to-shell install commands on POSIX', () => {
    expect(installHintFor('cursor', 'MacIntel')).toEqual(AGENT_INSTALL.cursor)
    expect(installHintFor('omp', 'Linux x86_64')).toEqual(AGENT_INSTALL.omp)
  })
})
