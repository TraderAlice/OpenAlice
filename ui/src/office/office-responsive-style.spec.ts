import { readFileSync } from 'node:fs'
import { basename, resolve } from 'node:path'

import { describe, expect, it } from 'vitest'

const uiRoot = basename(process.cwd()) === 'ui' ? process.cwd() : resolve(process.cwd(), 'ui')
const css = readFileSync(resolve(uiRoot, 'src/office/office.css'), 'utf8')

const stageStart = css.indexOf('.oa-office-main {')
const stageEnd = css.indexOf('\n}', stageStart)
const stageCss = css.slice(stageStart, stageEnd)
const narrowLiveStart = css.indexOf('@container (max-width: 520px)')
const narrowLiveEnd = css.indexOf('@media (prefers-reduced-motion: reduce)', narrowLiveStart)
const narrowLiveCss = css.slice(narrowLiveStart, narrowLiveEnd)
const touchLayoutStart = css.lastIndexOf('@container (max-width: 760px)', narrowLiveStart)
const compactWindowStart = css.indexOf('@container (max-width: 680px)', touchLayoutStart)
const touchLayoutCss = css.slice(touchLayoutStart, compactWindowStart)
const compactWindowCss = css.slice(compactWindowStart, narrowLiveStart)
const coarseTouchStart = css.indexOf('@media (hover: none), (pointer: coarse)', touchLayoutStart)
const coarseTouchEnd = css.indexOf('@container (max-width: 680px)', coarseTouchStart)
const narrowLayoutCss = css.slice(touchLayoutStart, coarseTouchStart)
const coarseTouchCss = css.slice(coarseTouchStart, coarseTouchEnd)

describe('Office responsive style contract', () => {
  it('owns one map stage without the superseded room and group scene graph', () => {
    expect(css).toMatch(/\.oa-office-map-stage\s*\{[\s\S]*?overflow: hidden/)
    expect(css).not.toMatch(/\.oa-office-room(?:\b|--|__|\[|:)/)
    expect(css).not.toMatch(/\.oa-office-group(?:s)?(?:\b|__|\[|:)/)
    expect(css).not.toContain('.oa-office-room-grid')
  })

  it('uses the available stage instead of forcing the viewport into 4:3', () => {
    expect(stageStart).toBeGreaterThan(-1)
    expect(stageEnd).toBeGreaterThan(stageStart)
    expect(stageCss).toContain('width: 100cqw')
    expect(stageCss).toContain('height: 100cqh')
    expect(stageCss).toContain('aspect-ratio: auto')
    expect(css).not.toContain('aspect-ratio: 4 / 3')
  })

  it('renders the non-walkable map perimeter as a physical building boundary', () => {
    const campusBlocks = [...css.matchAll(/\.oa-office-campus\s*\{([\s\S]*?)\}/g)]
      .map((match) => match[1])
    const mapBlocks = [...css.matchAll(/\.oa-office-map\s*\{([\s\S]*?)\}/g)]
      .map((match) => match[1])

    expect(campusBlocks.some((block) => block.includes(
      'background-image: var(--office-building-foundation)',
    ))).toBe(true)
    expect(campusBlocks.some((block) => block.includes('background-size: 192px 192px')))
      .toBe(true)
    expect(mapBlocks.some((block) => block.includes('0 0 0 4px var(--gba-ink)'))).toBe(true)
  })

  it('closes the pixel departure shutter before holding the readable destination', () => {
    expect(css).toMatch(/\.oa-office-departure\s*\{[\s\S]*?animation: oa-office-departure-curtain 320ms steps\(6, end\) forwards/)
    expect(css).toMatch(/\.oa-office-departure__message\s*\{[\s\S]*?animation: oa-office-departure-message 320ms steps\(2, end\) forwards/)
    expect(css).toMatch(/@keyframes oa-office-departure-curtain\s*\{[\s\S]*?100% \{ clip-path: inset\(0\); \}/)
  })

  it('keeps detailed interaction prompts inside the phone map', () => {
    expect(narrowLiveCss).toContain('.oa-office-interact-prompt[data-has-detail="true"]')
    expect(narrowLiveCss).toContain('max-width: 168px')
    expect(narrowLiveCss).toContain('grid-template-columns: 30px minmax(0, 1fr) 32px')
    expect(css.match(/var\(--office-prompt-tail-shift, 0px\)/g)).toHaveLength(4)
  })

  it('gives narrow auto-route status a second line for cancellation guidance', () => {
    expect(narrowLiveCss).toContain('.oa-office-route-status')
    expect(narrowLiveCss).toContain('grid-template-columns: 30px minmax(0, 1fr)')
    expect(narrowLiveCss).toContain('.oa-office-route-status__cancel')
    expect(narrowLiveCss).toContain('grid-column: 2')
  })

  it('keeps auto-route markers small, static, and anchored to Alice feet', () => {
    expect(css).toMatch(/\.oa-office-route-trail__step\s*\{[\s\S]*?width: 12px;[\s\S]*?height: 12px;[\s\S]*?opacity: 0\.42;[\s\S]*?calc\(-50% \+ 22px\)/)
    expect(css).toMatch(/\.oa-office-route-target-pointer\s*\{[\s\S]*?width: 20px;[\s\S]*?height: 20px;[\s\S]*?opacity: 0\.78;/)
    expect(css).not.toContain('@keyframes oa-office-route-step')
    expect(css).not.toContain('@keyframes oa-office-route-target-pointer')
  })

  it('stacks window location and type as deliberate phone title lines', () => {
    expect(css).toMatch(/\.oa-office-window__title-copy\s*\{[\s\S]*?display: flex/)
    expect(css).toMatch(/\.oa-office-window__title-room\s*\{[\s\S]*?text-overflow: ellipsis/)
    expect(narrowLiveCss).toContain('.oa-office-window__title-copy')
    expect(narrowLiveCss).toContain('display: grid')
    expect(narrowLiveCss).toContain('.oa-office-window__title-separator')
    expect(narrowLiveCss).toContain('display: none')
  })

  it('keeps landscape windows dense until the stage is genuinely narrow', () => {
    expect(touchLayoutStart).toBeGreaterThan(-1)
    expect(compactWindowStart).toBeGreaterThan(touchLayoutStart)
    expect(touchLayoutCss).not.toContain('.oa-office-roster ul')
    expect(compactWindowCss).toContain('.oa-office-roster ul,')
    expect(compactWindowCss).toContain('grid-template-columns: 1fr')
    expect(compactWindowCss).toContain('.oa-office-roster__summary small')
  })

  it('shrink-wraps the desktop occupancy journal without weakening narrow-stage containment', () => {
    expect(css).toMatch(/\.oa-office-window--log\s*\{[\s\S]*?bottom: auto;[\s\S]*?max-height: calc\(100% - 92px\)/)
    expect(css).toMatch(/@container \(max-width: 760px\) \{\s*\.oa-office-window--log\s*\{[^}]*bottom: 8px;[^}]*max-height: none;/)
  })

  it('lets input capability own touch controls independently of stage width', () => {
    expect(coarseTouchStart).toBeGreaterThan(touchLayoutStart)
    expect(coarseTouchEnd).toBeGreaterThan(coarseTouchStart)
    expect(narrowLayoutCss).not.toContain('.oa-office-touch-dpad')
    expect(narrowLayoutCss).not.toContain("[data-input='touch']")
    expect(coarseTouchCss).not.toContain('@container (max-width: 760px)')
    expect(coarseTouchCss).toContain('.oa-office-touch-dpad')
    expect(coarseTouchCss).toContain('display: grid')
    expect(coarseTouchCss).toContain('.oa-office-touch-action')
    expect(coarseTouchCss).toContain("[data-input='keyboard']")
    expect(coarseTouchCss).toContain("[data-input='touch']")
    expect(coarseTouchCss).toContain('.oa-office-map-controls__move')
    expect(coarseTouchCss).toContain('.oa-office-route-status')
    expect(coarseTouchCss).toContain('bottom: 122px')
    expect(css.match(/\.oa-office-map-controls\[data-action-ready='true'\]/g)).toHaveLength(2)
    expect(css.match(/\.oa-office-map-controls\[data-routing='true'\]/g)).toHaveLength(2)
    expect(css).toContain(".oa-office-building[data-controls-suspended='true'] :is(")
  })

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
