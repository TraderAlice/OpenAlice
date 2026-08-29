import { readFileSync } from 'node:fs'
import { basename, resolve } from 'node:path'

import { describe, expect, it } from 'vitest'

const uiRoot = basename(process.cwd()) === 'ui' ? process.cwd() : resolve(process.cwd(), 'ui')
const css = readFileSync(resolve(uiRoot, 'src/office/office.css'), 'utf8')

const narrowLiveStart = css.indexOf('@container (max-width: 520px)')
const narrowLiveEnd = css.indexOf('@media (prefers-reduced-motion: reduce)', narrowLiveStart)
const narrowLiveCss = css.slice(narrowLiveStart, narrowLiveEnd)

describe('Office responsive style contract', () => {
  it('keeps the live-floor identity and Menu on the first phone HUD row', () => {
    expect(narrowLiveStart).toBeGreaterThan(-1)
    expect(narrowLiveEnd).toBeGreaterThan(narrowLiveStart)
    expect(narrowLiveCss).toContain('.oa-office-building:not([data-replay="true"]) .oa-office-hud')
    expect(narrowLiveCss).toContain('"identity actions"')
    expect(narrowLiveCss).toContain('grid-template-columns: minmax(0, 1fr) auto')
    expect(narrowLiveCss).toContain('grid-area: identity')
    expect(narrowLiveCss).toContain('grid-area: actions')
  })

  it('preserves live agent status as a separate full-width phone HUD row', () => {
    expect(narrowLiveCss).toContain('"status status"')
    expect(narrowLiveCss).toContain('grid-area: status')
    expect(narrowLiveCss).toContain('width: 100%')
    expect(narrowLiveCss).toContain('border-top: 1px solid')
  })
})
