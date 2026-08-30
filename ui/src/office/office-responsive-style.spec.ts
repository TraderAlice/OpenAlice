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
    expect(narrowLiveCss).toContain('.oa-office-interact-prompt[data-has-detail="true"]:not(')
    expect(narrowLiveCss).toContain('max-width: 168px')
    expect(narrowLiveCss).toContain('grid-template-columns: 30px minmax(0, 1fr) 32px')
    expect(narrowLiveCss).toContain('[data-kind="inbox-service"]')
    expect(narrowLiveCss).toContain('max-width: 240px')
    expect(css).toContain('-webkit-line-clamp: 2')
    expect(css.match(/var\(--office-prompt-tail-shift, 0px\)/g)).toHaveLength(4)
  })

  it('gives narrow auto-route status a second line for cancellation guidance', () => {
    expect(css).toMatch(/\.oa-office-route-status\s*\{[^}]*max-width:\s*min\(420px,/s)
    expect(narrowLiveCss).toContain('.oa-office-route-status')
    expect(narrowLiveCss).toContain('grid-template-columns: 30px minmax(0, 1fr)')
    expect(narrowLiveCss).toContain('.oa-office-route-status__cancel')
    expect(css).toMatch(/\.oa-office-route-status__copy strong\s*\{[^}]*-webkit-line-clamp:\s*2/s)
    expect(narrowLiveCss).toContain('grid-column: 2')
  })

  it('keeps auto-route markers small, static, and anchored to Alice feet', () => {
    expect(css).toMatch(/\.oa-office-route-trail__step\s*\{[\s\S]*?width: 12px;[\s\S]*?height: 12px;[\s\S]*?opacity: 0\.42;[\s\S]*?calc\(-50% \+ 22px\)/)
    expect(css).toMatch(/\.oa-office-route-target-pointer\s*\{[\s\S]*?width: 20px;[\s\S]*?height: 20px;[\s\S]*?opacity: 0\.78;/)
    expect(css).not.toContain('@keyframes oa-office-route-step')
    expect(css).not.toContain('@keyframes oa-office-route-target-pointer')
    expect(css).toMatch(/\.oa-office-replay-visitor\s*\{[\s\S]*?width: 20px;[\s\S]*?height: 20px;[\s\S]*?translate\(-50%, -46px\);/)
    expect(css).not.toContain('@keyframes oa-office-replay-visitor')
  })

  it('anchors normalized coworker emotes beside the character instead of over room signs', () => {
    expect(css).toMatch(
      /\.oa-office-mood-emote\s*\{[^}]*top:\s*-4px;[^}]*left:\s*64%;/s,
    )
    expect(css).toMatch(
      /\.oa-office-mood-emote\[data-kind="working"\]\s*\{[^}]*width:\s*32px;[^}]*height:\s*32px;/s,
    )
    expect(css).toMatch(
      /\.oa-office-mood-emote\[data-kind="sleeping"\]\s*\{[^}]*width:\s*40px;[^}]*height:\s*40px;[^}]*steps\(3, end\) 3;/s,
    )
    expect(css).toMatch(
      /\.oa-office-desk\[data-awake="false"\]:not\(\[data-replay-focus="true"\]\) \.oa-office-coworker\s*\{[^}]*translateY\(6px\)/s,
    )
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

  it('moves top notifications below the live Office HUD without affecting modal windows', () => {
    expect(css).toContain(
      'body:has(.oa-office-main):not(:has(.oa-office-window)):not(:has(.oa-office-pause-menu))',
    )
    expect(css).toMatch(
      /\[data-sonner-toaster\]\[data-y-position="top"\]\s*\{\s*--offset-top: 82px !important;\s*--mobile-offset-top: 82px !important;/,
    )
    expect(css).toMatch(
      /@media \(max-width: 700px\) \{[\s\S]*?\[data-sonner-toaster\]\[data-y-position="top"\]\s*\{\s*--offset-top: 96px !important;/,
    )
  })

  it('keeps the roster command legend fixed while only the teammate grid scrolls', () => {
    expect(css).toMatch(
      /\.oa-office-roster__body\s*\{[\s\S]*?display: grid;[\s\S]*?grid-template-rows: auto minmax\(0, 1fr\);[\s\S]*?overflow: hidden;/,
    )
    expect(css).toMatch(
      /\.oa-office-roster ul\s*\{[\s\S]*?min-height: 0;[\s\S]*?overflow: auto;/,
    )
  })

  it('shrink-wraps the desktop occupancy journal without weakening narrow-stage containment', () => {
    expect(css).toMatch(/\.oa-office-window--log\s*\{[\s\S]*?bottom: auto;[\s\S]*?max-height: calc\(100% - 92px\)/)
    expect(css).toMatch(
      /\.oa-office-runtime__journal\s*\{[\s\S]*?grid-template-columns: minmax\(300px, 48%\) minmax\(0, 1fr\)/,
    )
    expect(css).toMatch(/@container \(max-width: 760px\) \{\s*\.oa-office-window--log\s*\{[^}]*bottom: 8px;[^}]*max-height: none;/)
  })

  it('compacts sparse desktop channels without reducing the phone journal', () => {
    expect(css).toMatch(
      /@container \(min-width: 761px\) \{[\s\S]*?\.oa-office-runtime__journal\[data-compact="true"\] \.oa-office-runtime__index\s*\{[\s\S]*?max-height: 320px;[\s\S]*?\.oa-office-runtime__journal\[data-compact="true"\] \.oa-office-runtime__event\s*\{[\s\S]*?min-height: 320px;/,
    )
    expect(css).toMatch(
      /@container \(max-width: 760px\) \{[\s\S]*?\.oa-office-runtime__index\s*\{[\s\S]*?max-height: 156px;[\s\S]*?\.oa-office-runtime__event\s*\{[\s\S]*?min-height: 156px;/,
    )
  })

  it('turns the narrow activity journal into a records-to-detail game menu', () => {
    expect(css).toMatch(
      /@container \(max-width: 760px\) \{[\s\S]*?data-mobile-view="index"\] \.oa-office-runtime__event,[\s\S]*?data-mobile-view="detail"\] \.oa-office-runtime__index\s*\{\s*display: none;/,
    )
    expect(css).toMatch(
      /data-mobile-view="index"\] \.oa-office-runtime__index\s*\{\s*max-height: none;/,
    )
    expect(css).toMatch(
      /\.oa-office-runtime__back\s*\{[\s\S]*?display: flex;[\s\S]*?grid-column: 1 \/ -1;/,
    )
  })

  it('keeps four log channels on one game-menu row until a phone needs two rows', () => {
    expect(css).toMatch(/\.oa-office-runtime__channels\s*\{[\s\S]*?grid-template-columns: repeat\(4, minmax\(0, 1fr\)\)/)
    expect(css).toMatch(/\.oa-office-runtime__input-hint\s*\{[\s\S]*?text-align: right;/)
    expect(css).toMatch(/@container \(max-width: 480px\) \{[\s\S]*?\.oa-office-runtime__channels\s*\{[\s\S]*?grid-template-columns: repeat\(2, minmax\(0, 1fr\)\)/)
    expect(coarseTouchCss).toMatch(/\.oa-office-runtime__input-hint\s*\{\s*display: none;/)
  })

  it('keeps long journal reports summarized without losing the command row', () => {
    expect(css).toMatch(
      /\.oa-office-runtime__event\s*\{[\s\S]*?grid-template-rows: minmax\(min-content, 1fr\) auto;[\s\S]*?min-height: 400px;/,
    )
    expect(css).toMatch(
      /\.oa-office-runtime__detail\s*\{[\s\S]*?overflow: hidden;[\s\S]*?-webkit-line-clamp: 5/,
    )
    expect(css).toMatch(
      /\.oa-office-runtime__actions\s*\{[\s\S]*?position: sticky;[\s\S]*?bottom: 0;/,
    )
    expect(css).toMatch(
      /\.oa-office-runtime__actions::after\s*\{[\s\S]*?top: 100%;[\s\S]*?height: 11px;[\s\S]*?background: var\(--gba-paper\);/,
    )
    expect(css).toMatch(
      /@container \(max-width: 760px\) \{[\s\S]*?\.oa-office-runtime__event\s*\{[\s\S]*?min-height: 156px;/,
    )
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
    expect(css).toMatch(
      /\.oa-office-window__input-hint \[data-input='touch'\]\s*\{\s*display: none;/,
    )
    expect(coarseTouchCss).toMatch(
      /\.oa-office-window__input-hint \[data-input='keyboard'\]\s*\{\s*display: none;/,
    )
    expect(coarseTouchCss).toMatch(
      /\.oa-office-window__input-hint \[data-input='touch'\]\s*\{\s*display: inline;/,
    )
    expect(css.match(/\.oa-office-map-controls\[data-action-ready='true'\]/g)).toHaveLength(2)
    expect(css.match(/\.oa-office-map-controls\[data-routing='true'\]/g)).toHaveLength(2)
    expect(css).toContain(".oa-office-building[data-controls-suspended='true'] :is(")
  })

  it('keeps the floor identity and commands on the first phone HUD row', () => {
    expect(narrowLiveStart).toBeGreaterThan(-1)
    expect(narrowLiveEnd).toBeGreaterThan(narrowLiveStart)
    expect(narrowLiveCss).toMatch(/\n\s*\.oa-office-hud \{/)
    expect(narrowLiveCss).not.toContain(':not([data-replay="true"])')
    expect(narrowLiveCss).toContain('"identity actions"')
    expect(narrowLiveCss).toContain('grid-template-columns: minmax(0, 1fr) auto')
    expect(narrowLiveCss).toContain('grid-area: identity')
    expect(narrowLiveCss).toContain('grid-area: actions')
  })

  it('preserves live and replay agent status as a separate full-width phone HUD row', () => {
    expect(narrowLiveCss).toContain('"status status"')
    expect(narrowLiveCss).toContain('grid-area: status')
    expect(narrowLiveCss).toContain('.oa-office-building[data-replay="true"] .oa-office-hud__status')
    expect(narrowLiveCss).toContain('display: flex')
    expect(narrowLiveCss).toContain('width: 100%')
    expect(narrowLiveCss).toContain('border-top: 1px solid')
    expect(narrowLiveCss).toContain('.oa-office-hud__status span:not(:first-child)')
    expect(narrowLiveCss).toContain('display: inline-flex')
  })
})
