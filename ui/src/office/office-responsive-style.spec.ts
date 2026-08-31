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
    expect(css).toMatch(/\.oa-office-map-stage\s*\{[\s\S]*?overflow: clip/)
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
    expect(css.match(/var\(--office-prompt-tail-shift, 0px\)/g)).toHaveLength(5)
    expect(css).toMatch(
      /\.oa-office-interact-prompt\[data-kind="operations"\]\[data-side="above"\]::before\s*\{[\s\S]*?bottom: -35px;[\s\S]*?repeating-linear-gradient/,
    )
  })

  it('gives narrow auto-route status a second line for cancellation guidance', () => {
    expect(css).toMatch(/\.oa-office-route-status\s*\{[^}]*max-width:\s*min\(420px,/s)
    expect(css).toMatch(/\.oa-office-route-status\[data-edge='top'\]\s*\{[^}]*top:\s*14px;[^}]*bottom:\s*auto;/s)
    expect(narrowLiveCss).toContain('.oa-office-route-status')
    expect(narrowLiveCss).toContain('grid-template-columns: 30px minmax(0, 1fr)')
    expect(narrowLiveCss).toContain('.oa-office-route-status__cancel')
    expect(css).toMatch(/\.oa-office-route-status__copy strong\s*\{[^}]*-webkit-line-clamp:\s*2/s)
    expect(narrowLiveCss).toContain('grid-column: 2')
  })

  it('keeps the replay exit inside the pixel control language', () => {
    expect(css).toMatch(
      /\.oa-office-replay-exit__icon\s*\{[^}]*display:\s*block;[^}]*width:\s*18px;[^}]*height:\s*18px;[^}]*object-fit:\s*contain;/s,
    )
    expect(css).not.toContain('.oa-office-replay-exit__arrow')
  })

  it('confirms acknowledged landmarks once without leaving ambient map noise', () => {
    expect(css).toMatch(
      /\.oa-office-landmark-ack\s*\{[\s\S]*?animation: oa-office-landmark-ack 900ms steps\(4, end\) forwards;/,
    )
    expect(css).toMatch(
      /@keyframes oa-office-landmark-ack\s*\{[\s\S]*?100% \{ opacity: 0; transform: translateY\(-8px\) scale\(1\); \}/,
    )
    expect(css).toMatch(
      /@media \(prefers-reduced-motion: reduce\) \{[\s\S]*?\.oa-office-landmark-ack \{ animation: none; \}/,
    )
    expect(css).toMatch(
      /\.oa-office-landmark-ack\s*\{[^}]*width:\s*max-content;[^}]*min-width:\s*30px;[^}]*white-space:\s*nowrap;/s,
    )
  })

  it('keeps the cadence review readable and actionable on phone and short landscape stages', () => {
    expect(css).toMatch(
      /\.oa-office-cadence__review,[\s\S]*?\.oa-office-cadence__actions button\s*\{[^}]*min-height:\s*44px;/,
    )
    expect(narrowLiveCss).toMatch(
      /\.oa-office-cadence__facts,[\s\S]*?\.oa-office-cadence__evidence dl\s*\{\s*grid-template-columns:\s*1fr;/,
    )
    expect(narrowLiveCss).toMatch(
      /\.oa-office-cadence__actions\s*\{\s*grid-template-columns:\s*1fr;/,
    )
    expect(css).toMatch(
      /@container \(max-width: 760px\) and \(max-height: 420px\) \{[\s\S]*?\.oa-office-cadence\s*\{[^}]*top:\s*60px;[^}]*bottom:\s*8px;[^}]*max-height:\s*none;/,
    )
  })

  it('keeps pending landmark counts compact and game-readable', () => {
    for (const selector of [
      '.oa-office-map-service__signal',
      '.oa-office-operations-board__signal',
    ]) {
      const start = css.indexOf(`${selector} {`)
      const end = css.indexOf('\n}', start)
      const block = css.slice(start, end)

      expect(start).toBeGreaterThan(-1)
      expect(block).toContain('width: auto')
      expect(block).toContain('min-width: 26px')
      expect(block).toContain('padding: 0 4px')
      expect(block).toContain('border-radius: 2px')
      expect(block).toContain('font-size: 11px')
    }
  })

  it('shows fresh News as ambient placard motion without manufacturing a pending badge', () => {
    expect(css).toMatch(
      /\.oa-office-map-service\[data-kind="news"\]\[data-fresh="true"\] \.oa-office-map-service__placard\s*\{[^}]*drop-shadow[^}]*animation:\s*oa-office-service-fresh 920ms steps\(2, end\) infinite;/s,
    )
    expect(css).toMatch(
      /@media \(prefers-reduced-motion: reduce\) \{[\s\S]*?\[data-kind="news"\]\[data-fresh="true"\] \.oa-office-map-service__placard,[\s\S]*?animation: none;/,
    )
  })

  it('keeps roster state beside identity and gives assignments two stable lines', () => {
    const dormantCardStart = css.indexOf('.oa-office-roster li button[data-awake="false"]')
    const focusedCardStart = css.indexOf('.oa-office-roster li button:focus-visible {')

    expect(css).toMatch(
      /\.oa-office-roster__identity\s*\{[^}]*grid-template-columns:\s*minmax\(0, 1fr\) auto;/s,
    )
    expect(css).toMatch(
      /\.oa-office-roster__title\s*\{[^}]*display:\s*flex;[^}]*min-width:\s*0;[^}]*white-space:\s*nowrap;/s,
    )
    expect(css).toMatch(
      /\.oa-office-roster__callsign\s*\{[^}]*min-width:\s*0;[^}]*overflow:\s*hidden;[^}]*text-overflow:\s*ellipsis;/s,
    )
    expect(css).toMatch(/\.oa-office-roster__session\s*\{[^}]*flex:\s*none;/s)
    expect(css).toMatch(
      /\.oa-office-roster__meta\s*\{[^}]*overflow-wrap:\s*anywhere;[^}]*-webkit-line-clamp:\s*2;/s,
    )
    expect(css).toMatch(/\.oa-office-roster__cursor\s*\{[^}]*opacity:\s*0;/s)
    expect(css).toMatch(
      /\.oa-office-roster li button:is\(:hover, :focus-visible\) \.oa-office-roster__cursor\s*\{[^}]*opacity:\s*1;/s,
    )
    expect(dormantCardStart).toBeGreaterThan(-1)
    expect(focusedCardStart).toBeGreaterThan(dormantCardStart)
    expect(css).toMatch(
      /\.oa-office-roster li button:focus-visible\s*\{[^}]*background:\s*color-mix\(in srgb, var\(--gba-water\) 26%, var\(--gba-paper\)\);[^}]*inset 0 0 0 2px var\(--gba-water\),/s,
    )
    expect(css).toMatch(
      /\.oa-office-roster li button\[data-replay-focus="true"\]\s*\{[^}]*border-color:\s*var\(--gba-water\);[^}]*inset 0 0 0 2px color-mix\(in srgb, var\(--gba-water\) 54%, transparent\),/s,
    )
    expect(css).toMatch(
      /\.oa-office-roster__status\[data-power="replay"\]\s*\{[^}]*border-color:\s*var\(--gba-water\);[^}]*background:\s*color-mix\(in srgb, var\(--gba-water\) 30%, var\(--gba-paper\)\);/s,
    )
    expect(css).toMatch(
      /\.oa-office-roster li button:focus-visible \.oa-office-roster__cursor\s*\{[^}]*drop-shadow\(1px 1px 0 var\(--gba-paper\)\);/s,
    )
  })

  it('keeps auto-route markers readable, static, and anchored to Alice feet', () => {
    expect(css).toMatch(/\.oa-office-route-trail__step\s*\{[\s\S]*?width: 12px;[\s\S]*?height: 12px;[\s\S]*?opacity: 0\.68;[\s\S]*?calc\(-50% \+ 22px\)/)
    expect(css).toMatch(/\.oa-office-route-trail__step img\s*\{[\s\S]*?drop-shadow\(1px 1px 0 color-mix\(in srgb, var\(--gba-ink\) 62%, transparent\)\);/)
    expect(css).toMatch(/\.oa-office-route-trail__step\[data-destination="true"\]\s*\{[\s\S]*?opacity: 0\.86;/)
    expect(css).toMatch(/\.oa-office-route-target-pointer,\s*\.oa-office-duty-target-beacon\s*\{[\s\S]*?width: 20px;[\s\S]*?height: 20px;[\s\S]*?opacity: 0\.78;/)
    expect(css).not.toContain('@keyframes oa-office-route-step')
    expect(css).not.toContain('@keyframes oa-office-route-target-pointer')
    expect(css).toMatch(/\.oa-office-duty-target-beacon\s*\{[^}]*width: 24px;[^}]*height: 24px;[^}]*drop-shadow\(1px 0 0 var\(--gba-paper\)\)[^}]*animation: oa-office-duty-target-beacon 220ms steps\(2, end\) 3;/s)
    expect(css).toMatch(/\.oa-office-duty-target-beacon\[data-reduced-motion="true"\]\s*\{[^}]*animation: none;/s)
    expect(css).toMatch(/\.oa-office-replay-visitor\s*\{[\s\S]*?width: 20px;[\s\S]*?height: 20px;[\s\S]*?translate\(-50%, -46px\);/)
    expect(css).not.toContain('@keyframes oa-office-replay-visitor')
  })

  it('reveals Office time changes through a map-only stepped palette curtain', () => {
    expect(css).toMatch(
      /\.oa-office-time-shift\s*\{[^}]*z-index:\s*35;[^}]*pointer-events:\s*none;[^}]*animation-duration:\s*360ms;[^}]*steps\(6, end\);/s,
    )
    expect(css).toMatch(
      /\.oa-office-time-shift\[data-office-time="day"\]\s*\{[^}]*oa-office-time-shift-day;/s,
    )
    expect(css).toMatch(
      /\.oa-office-time-shift\[data-office-time="night"\]\s*\{[^}]*oa-office-time-shift-night;/s,
    )
    expect(css).toMatch(
      /\.oa-office-time-shift\[data-reduced-motion="true"\]\s*\{[^}]*animation:\s*none;/s,
    )
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
      /\.oa-office-desk\[data-awake="false"\]:not\(\[data-replay-focus="true"\]\) \.oa-office-coworker\s*\{[^}]*translateY\(3px\)/s,
    )
  })

  it('lights each active Harness landmark without adding motion in reduced-motion mode', () => {
    expect(css).toMatch(
      /\.oa-office-pod\[data-harness="chat"\]\s*\{[^}]*--office-harness-live-color:\s*var\(--office-amber\);/s,
    )
    expect(css).toMatch(
      /\.oa-office-pod\[data-harness="prediction"\]\s*\{[^}]*--office-harness-live-color:\s*var\(--terminal-magenta\);/s,
    )
    expect(css).toMatch(
      /\.oa-office-pod\[data-powered="true"\] \.oa-office-pod__harness-prop\s*\{[^}]*oa-office-harness-live 1\.2s steps\(2, end\) infinite;/s,
    )
    expect(css).toMatch(
      /\.oa-office-pod\[data-powered="true"\]\[data-reduced-motion="true"\] \.oa-office-pod__harness-prop\s*\{[^}]*animation:\s*none;/s,
    )
  })

  it('keeps employee replay beacons beside current coworker state', () => {
    expect(css).toMatch(
      /\.oa-office-replay-beacon\[data-kind="employee"\]\s*\{[^}]*--office-replay-beacon-shift-x:\s*calc\(-100% - 14px\);/s,
    )
    expect(css).toMatch(
      /@keyframes oa-office-replay-beacon\s*\{[^}]*translate\(var\(--office-replay-beacon-shift-x\),/s,
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

  it('moves party counts into the title on short landscape screens', () => {
    expect(css).toMatch(/\.oa-office-window__title-count\s*\{[\s\S]*?display: none/)
    expect(css).toMatch(
      /\.oa-office-roster \.oa-office-window__title-count\s*\{[\s\S]*?display: grid;[\s\S]*?min-width: 54px;/,
    )
    expect(css).toMatch(
      /\.oa-office-cabinet-window \.oa-office-window__title-count\s*\{[\s\S]*?display: grid;[\s\S]*?min-width: 54px;/,
    )
    expect(css).toMatch(
      /@container \(max-width: 760px\) and \(max-height: 420px\) \{[\s\S]*?\.oa-office-roster \.oa-office-window__title-count,[\s\S]*?\.oa-office-cabinet-window \.oa-office-window__title-count\s*\{\s*display: grid;/,
    )
    expect(css).toMatch(
      /@container \(max-width: 760px\) and \(max-height: 420px\) \{[\s\S]*?\.oa-office-roster__body\s*\{\s*grid-template-rows: minmax\(0, 1fr\);/,
    )
    expect(css).toMatch(
      /@container \(max-width: 760px\) and \(max-height: 420px\) \{[\s\S]*?\.oa-office-cabinet-window__body\s*\{\s*grid-template-rows: minmax\(0, 1fr\) auto;/,
    )
    expect(css).toMatch(
      /@container \(max-width: 760px\) and \(max-height: 420px\) \{[\s\S]*?\.oa-office-cabinet-window\[data-record-count="3"\],[\s\S]*?data-record-count="4"\][\s\S]*?height: min\(358px, calc\(100% - 86px\)\);/,
    )
    expect(css).toMatch(
      /@container \(max-width: 760px\) and \(max-height: 420px\) \{[\s\S]*?\.oa-office-cabinet-window__records li button\s*\{[\s\S]*?min-height: 66px;[\s\S]*?padding-block: 4px;/,
    )
    expect(css).toMatch(
      /@container \(max-width: 760px\) and \(max-height: 420px\) \{[\s\S]*?\.oa-office-cabinet-window__records \.oa-office-cabinet-window__record-copy\s*\{\s*gap: 1px;/,
    )
    expect(css).toMatch(
      /@container \(max-width: 760px\) and \(max-height: 420px\) \{[\s\S]*?\.oa-office-cabinet-window__record-copy :is\(strong, small\)\s*\{\s*line-height: 1\.15;/,
    )
    expect(css).toMatch(
      /@container \(max-width: 760px\) and \(max-height: 420px\) \{[\s\S]*?\.oa-office-roster__summary,[\s\S]*?\.oa-office-cabinet-window__summary\s*\{\s*display: none;/,
    )
  })

  it('keeps the Agent story ahead of diagnostic facts on short landscape screens', () => {
    expect(css).toMatch(
      /@container \(max-width: 760px\) and \(max-height: 420px\) \{[\s\S]*?\.oa-office-inspect__profile\s*\{[\s\S]*?grid-template-columns: 76px minmax\(0, 1fr\);[\s\S]*?grid-auto-rows: max-content;[\s\S]*?align-content: start;[\s\S]*?align-items: start;/,
    )
    expect(css).toMatch(
      /@container \(max-width: 760px\) and \(max-height: 420px\) \{[\s\S]*?\.oa-office-inspect__facts\s*\{\s*grid-column: 1 \/ -1;/,
    )
    expect(css).toMatch(
      /@container \(max-width: 760px\) and \(max-height: 420px\) \{[\s\S]*?\.oa-office-inspect__identity\s*\{[\s\S]*?display: flex;[\s\S]*?align-items: baseline;/,
    )
    expect(css).toMatch(
      /@container \(max-width: 760px\) and \(max-height: 420px\) \{[\s\S]*?\.oa-office-inspect__identity p\s*\{[\s\S]*?text-overflow: ellipsis;[\s\S]*?white-space: nowrap;/,
    )
    expect(css).toMatch(
      /@container \(max-width: 760px\) and \(max-height: 420px\) \{[\s\S]*?\.oa-office-inspect__latest-result\s*\{\s*margin-top: 5px;/,
    )
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
    expect(css).toMatch(
      /body:has\(\.oa-office-main\):has\(button\[title="Dismiss until next reload"\]\)[\s\S]*?--offset-top: 116px !important;\s*--mobile-offset-top: 116px !important;/,
    )
    expect(css).toMatch(
      /@media \(max-width: 700px\) \{[\s\S]*?body:has\(\.oa-office-main\):has\(button\[title="Dismiss until next reload"\]\)[\s\S]*?--offset-top: 130px !important;\s*--mobile-offset-top: 130px !important;/,
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

  it('gives dense filing cabinets complete desktop rows and the available narrow floor height', () => {
    expect(css).toMatch(
      /\.oa-office-cabinet-window\s*\{[\s\S]*?height: min\(438px, calc\(100% - 86px\)\);/,
    )
    expect(css).toMatch(
      /\.oa-office-cabinet-window\[data-dense="true"\]\s*\{\s*height: min\(520px, calc\(100% - 86px\)\);/,
    )
    expect(css).toMatch(
      /@container \(max-width: 680px\) \{[\s\S]*?\.oa-office-cabinet-window\[data-dense="true"\]\s*\{\s*bottom: 12px;\s*height: auto;/,
    )
    expect(css).toMatch(
      /\.oa-office-cabinet-window__body\s*\{[\s\S]*?grid-template-rows: auto minmax\(0, 1fr\) auto;[\s\S]*?overflow: hidden;/,
    )
  })

  it('keeps narrow Agent file grid rows at natural height instead of overlapping records', () => {
    expect(css).toMatch(
      /@container \(max-width: 680px\) \{[\s\S]*?\.oa-office-inspect__profile\s*\{[\s\S]*?grid-auto-rows: max-content;[\s\S]*?align-content: start;[\s\S]*?align-items: start;/,
    )
    expect(css).toMatch(
      /@container \(max-width: 680px\) \{[\s\S]*?\.oa-office-inspect__portrait\s*\{\s*align-self: center;/,
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
      /@container \(min-width: 761px\) \{[\s\S]*?\.oa-office-runtime__journal\[data-compact="true"\]\s*\{[\s\S]*?height: 320px;/,
    )
    expect(css).toMatch(
      /@container \(max-width: 760px\) \{[\s\S]*?\.oa-office-runtime__index\s*\{[\s\S]*?height: 156px;[\s\S]*?\.oa-office-runtime__event\s*\{[\s\S]*?height: 100%;/,
    )
  })

  it('turns the narrow activity journal into a records-to-detail game menu', () => {
    expect(css).toMatch(
      /@container \(max-width: 760px\) \{[\s\S]*?data-mobile-view="index"\] \.oa-office-runtime__event,[\s\S]*?data-mobile-view="detail"\] \.oa-office-runtime__index\s*\{\s*display: none;/,
    )
    expect(css).toMatch(
      /data-mobile-view="index"\] \.oa-office-runtime__index\s*\{\s*height: 100%;/,
    )
    expect(css).toMatch(
      /\.oa-office-runtime__back\s*\{[\s\S]*?display: flex;[\s\S]*?grid-column: 1 \/ -1;/,
    )
    expect(css).toMatch(
      /@container \(max-width: 760px\) and \(max-height: 420px\) \{[\s\S]*?data-mobile-view="detail"[\s\S]*?top: 52px;[\s\S]*?bottom: 0;[\s\S]*?max-height: none;/,
    )
    expect(css).toMatch(
      /@container \(max-width: 760px\) and \(max-height: 420px\) \{[\s\S]*?\.oa-office-window--log:has\([\s\S]*?data-mobile-view="detail"[\s\S]*?\.oa-office-replay-panel,[\s\S]*?\.oa-office-runtime__channels,[\s\S]*?\.oa-office-runtime__input-hint[\s\S]*?display: none;/,
    )
    expect(css).toMatch(
      /@container \(max-width: 760px\) and \(max-height: 420px\) \{[\s\S]*?data-mobile-view="detail"[\s\S]*?\.oa-office-runtime__actions\s*\{\s*position: sticky;\s*bottom: 0;[\s\S]*?padding-top: 2px;/,
    )
  })

  it('keeps four log channels on one game-menu row until a phone needs two rows', () => {
    expect(css).toMatch(/\.oa-office-runtime__channels\s*\{[\s\S]*?grid-template-columns: repeat\(4, minmax\(0, 1fr\)\)/)
    expect(css).toMatch(/\.oa-office-runtime__input-hint\s*\{[\s\S]*?text-align: right;/)
    expect(css).toMatch(/@container \(max-width: 480px\) \{[\s\S]*?\.oa-office-runtime__channels\s*\{[\s\S]*?grid-template-columns: repeat\(2, minmax\(0, 1fr\)\)/)
    expect(coarseTouchCss).toMatch(/\.oa-office-runtime__input-hint\s*\{\s*display: none;/)
  })

  it('reserves enough pause-menu legend width for the dual-purpose Escape command', () => {
    expect(css).toMatch(
      /\.oa-office-pause-menu__controls dl > div\s*\{[\s\S]*?grid-template-columns: minmax\(92px, auto\) 1fr;/,
    )
  })

  it('keeps long journal reports summarized without losing the command row', () => {
    expect(css).toMatch(
      /\.oa-office-runtime__event\s*\{[\s\S]*?grid-template-rows: minmax\(min-content, 1fr\) auto;[\s\S]*?overflow-y: auto;/,
    )
    expect(css).toMatch(
      /\.oa-office-runtime__detail\s*\{[\s\S]*?overflow: visible;/,
    )
    expect(css).toMatch(
      /\.oa-office-runtime__detail\[data-expandable="true"\]:not\(\[data-expanded="true"\]\)\s*\{[\s\S]*?overflow: hidden;[\s\S]*?-webkit-line-clamp: 5/,
    )
    expect(css).toMatch(
      /\.oa-office-runtime__detail-label\s*\{[\s\S]*?color: var\(--gba-moss-dark\);[\s\S]*?font-weight: 900;[\s\S]*?text-transform: uppercase;/,
    )
    expect(css).toMatch(
      /\.oa-office-runtime__actions\s*\{[\s\S]*?position: sticky;[\s\S]*?bottom: 0;/,
    )
    expect(css).toMatch(
      /\.oa-office-runtime__actions::after\s*\{[\s\S]*?top: 100%;[\s\S]*?height: 11px;[\s\S]*?background: var\(--gba-paper\);/,
    )
    expect(css).toMatch(
      /@container \(max-width: 480px\) \{[\s\S]*?\.oa-office-runtime__actions\s*\{[\s\S]*?grid-template-columns: repeat\(2, minmax\(0, 1fr\)\);[\s\S]*?\.oa-office-runtime__actions > \.oa-office-runtime__open\s*\{[\s\S]*?grid-column: auto;[\s\S]*?align-self: stretch;/,
    )
    expect(css).toMatch(
      /\.oa-office-runtime__open--receipt\s*\{[\s\S]*?width: 100%;[\s\S]*?margin-top: 8px;/,
    )
    expect(css).toMatch(
      /@container \(max-width: 760px\) \{[\s\S]*?\.oa-office-runtime__event\s*\{[\s\S]*?height: 100%;/,
    )
    expect(css).toMatch(
      /\.oa-office-runtime__detail-toggle:focus-visible\s*\{[\s\S]*?outline: 2px solid var\(--gba-water\);[\s\S]*?background: color-mix\(in srgb, var\(--gba-paper\) 72%, transparent\);[\s\S]*?box-shadow: 2px 2px 0 color-mix\(in srgb, var\(--gba-ink\) 38%, transparent\);/,
    )
  })

  it('gives long journal assignments a bounded keyboard-readable disclosure', () => {
    expect(css).toMatch(
      /\.oa-office-runtime__assignment > p\s*\{[\s\S]*?display: block;[\s\S]*?overflow: visible;/,
    )
    expect(css).toMatch(
      /\.oa-office-runtime__assignment\[data-expandable="true"\] > p:not\(\[data-expanded="true"\]\)\s*\{[\s\S]*?-webkit-line-clamp: 3;/,
    )
    expect(css).toMatch(
      /\.oa-office-runtime__assignment > p\[data-expanded="true"\]\s*\{[\s\S]*?max-height: 7\.8em;[\s\S]*?overflow-y: auto;[\s\S]*?scrollbar-width: thin;/,
    )
  })

  it('keeps dormant map coworkers legible while the workstation carries power state', () => {
    expect(css).toMatch(
      /\.oa-office-desk\[data-awake="false"\]:not\(\[data-replay-focus="true"\]\) \.oa-office-coworker img\s*\{[\s\S]*?saturate\(0\.92\) brightness\(0\.94\)/,
    )
    expect(css).toMatch(
      /\.oa-office-desk\[data-awake="false"\]:not\(\[data-replay-focus="true"\]\) \.oa-office-coworker::after\s*\{[\s\S]*?opacity: 0\.58;/,
    )
  })

  it('pins activity-log chrome while the record and detail panes own overflow', () => {
    expect(css).toMatch(
      /\.oa-office-window--log\s*\{[\s\S]*?top: 72px;[\s\S]*?overflow: clip;/,
    )
    expect(css).toMatch(
      /\.oa-office-window--log \.oa-office-window__body\s*\{[\s\S]*?display: flex;[\s\S]*?overflow: clip;/,
    )
    expect(css).toMatch(/\.oa-office-runtime__tabs\s*\{[\s\S]*?overflow: clip;/)
    expect(css).toMatch(/\.oa-office-runtime__panel\s*\{[\s\S]*?overflow: clip;/)
    expect(css).toMatch(
      /\.oa-office-runtime__journal\s*\{[\s\S]*?height: clamp\(220px, calc\(100cqh - 300px\), 400px\);/,
    )
    expect(css).toMatch(/\.oa-office-runtime__index\s*\{[\s\S]*?overflow: auto;/)
    expect(css).toMatch(/\.oa-office-runtime__event\s*\{[\s\S]*?overflow-y: auto;/)
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
    expect(coarseTouchCss).toMatch(
      /\.oa-office-pause-menu__controls\s*\{\s*display: none;/,
    )
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

  it('keeps the floor identity, commands, and compact duty ticket on the phone HUD', () => {
    expect(narrowLiveStart).toBeGreaterThan(-1)
    expect(narrowLiveEnd).toBeGreaterThan(narrowLiveStart)
    expect(narrowLiveCss).toMatch(/\n\s*\.oa-office-hud \{/)
    expect(narrowLiveCss).not.toContain(':not([data-replay="true"])')
    expect(narrowLiveCss).toContain('"identity actions"')
    expect(narrowLiveCss).toContain('"duty duty"')
    expect(narrowLiveCss).toContain('grid-template-columns: minmax(0, 1fr) auto')
    expect(narrowLiveCss).toContain('grid-area: identity')
    expect(narrowLiveCss).toContain('grid-area: actions')
    expect(narrowLiveCss).toContain('grid-area: duty')
    expect(css).toMatch(
      /\.oa-office-hud__duty\s*\{[^}]*min-height:\s*34px;[^}]*grid-template-columns:\s*minmax\(0, 1fr\) auto;/s,
    )
    expect(css).toMatch(/\.oa-office-hud__duty-meta\s*\{\s*display:\s*none;/)
    expect(css).toMatch(/\.oa-office-hud__duty strong\s*\{[^}]*grid-column:\s*1;/s)
  })

  it('keeps clear duty copy passive and yields phone HUD space to guidance', () => {
    expect(css).toContain('button.oa-office-hud__duty:is(:hover, :focus-visible)')
    expect(css).not.toMatch(/\n\.oa-office-hud__duty:is\(/)
    expect(narrowLiveCss).toContain('.oa-office-building[data-replay="true"] .oa-office-hud__status')
    expect(narrowLiveCss).toMatch(
      /\.oa-office-hud__status,\s*\.oa-office-building\[data-replay="true"\] \.oa-office-hud__status\s*\{\s*display: none;/,
    )
  })
})
