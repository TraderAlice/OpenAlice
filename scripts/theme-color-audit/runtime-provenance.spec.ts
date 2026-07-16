import { describe, expect, it } from 'vitest'
import { auditRuntimeNames } from './audit-vite-plugin.js'

describe('theme color audit runtime provenance', () => {
  it('uses names isolated from production domain attributes', () => {
    expect(auditRuntimeNames.ATTRIBUTE).toBe('data-openalice-color-audit')
    expect(auditRuntimeNames.VALUE_HOOK).toBe('__OPENALICE_THEME_COLOR_VALUE__')
  })
})
