import { describe, expect, it } from 'vitest'
import { applyAuditRuntimeOverrides } from './audit-vite-plugin.js'

describe('theme color audit runtime overrides', () => {
  it('keeps first-run test routing active even when the file has no residual color occurrence', () => {
    const source = [
      "const ONBOARDING_TEST_MODE = import.meta.env.VITE_OPENALICE_ONBOARDING_TEST === '1'",
      'parseFirstRunStepOverride(window.location.search, ONBOARDING_TEST_MODE)',
    ].join('\n')
    const transformed = applyAuditRuntimeOverrides('ui/src/components/FirstRunGuide.tsx', source)
    expect(transformed).toContain('const ONBOARDING_TEST_MODE = true')
    expect(transformed).toContain("window.sessionStorage.getItem('__OPENALICE_AUDIT_ONBOARDING_SEARCH__')")
  })

  it('keeps the real terminal surface and audit websocket active without residual literals in Terminal.tsx', () => {
    const source = 'if (import.meta.env.VITE_DEMO_MODE) {}\nnew WebSocket(currentUrl())'
    const transformed = applyAuditRuntimeOverrides('ui/src/components/workspace/Terminal.tsx', source)
    expect(transformed).toContain('if (false)')
    expect(transformed).toContain('new globalThis.__OPENALICE_AUDIT_WEBSOCKET__(currentUrl())')
  })
})
