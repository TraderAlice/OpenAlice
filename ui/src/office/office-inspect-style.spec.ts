import { readFileSync } from 'node:fs'
import { basename, resolve } from 'node:path'

import { describe, expect, it } from 'vitest'

const uiRoot = basename(process.cwd()) === 'ui' ? process.cwd() : resolve(process.cwd(), 'ui')
const css = readFileSync(resolve(uiRoot, 'src/office/office.css'), 'utf8')
const gameWindowStart = css.indexOf('@keyframes oa-office-gba-window')
const gameWindowEnd = css.indexOf('\n}', gameWindowStart)
const gameWindowCss = css.slice(gameWindowStart, gameWindowEnd)
const mediumStart = css.indexOf('@container (max-width: 760px)', gameWindowStart)
const compactStart = css.indexOf('@container (max-width: 680px)', mediumStart)
const phoneStart = css.indexOf('@media (max-width: 580px)', compactStart)
const mediumCss = css.slice(mediumStart, compactStart)
const compactCss = css.slice(compactStart, phoneStart)
const drawerLabelRules = [...css.matchAll(/\.oa-office-drawer__label\s*\{([^}]*)\}/g)]
const drawerLabelCss = drawerLabelRules.at(-1)?.[1] ?? ''

describe('Office Agent-file style contract', () => {
  it('opens game windows as opaque stepped panels instead of blending with the floor', () => {
    expect(gameWindowStart).toBeGreaterThan(-1)
    expect(gameWindowEnd).toBeGreaterThan(gameWindowStart)
    expect(gameWindowCss).toContain('transform: scaleY(0.85)')
    expect(gameWindowCss).not.toContain('opacity')
  })

  it('keeps character information ahead of the full-width command row', () => {
    expect(css).toMatch(
      /\.oa-office-inspect\s*\{[\s\S]*?max-height: min\(416px, calc\(100% - 84px\)\);[\s\S]*?overflow: hidden/,
    )
    expect(css).toMatch(
      /\.oa-office-inspect__profile\s*\{[\s\S]*?min-height: 0;[\s\S]*?grid-template-columns: 76px minmax\(180px, 1fr\) minmax\(250px, 1\.35fr\)[\s\S]*?overflow-y: auto/,
    )
    expect(css).toMatch(
      /\.oa-office-inspect__actions\s*\{[\s\S]*?grid-column: 1 \/ -1;[\s\S]*?flex: none/,
    )
    expect(css).toMatch(
      /\.oa-office-inspect__actions\[data-has-activity="true"\]\s*\{[^}]*grid-template-columns: minmax\(0, 0\.9fr\) minmax\(0, 1\.1fr\)/s,
    )
  })

  it('keeps callsigns short, clamps optional Assignments, and uses a simple DOM-owned close mark', () => {
    expect(css).toMatch(/\.oa-office-inspect__assignment > p\s*\{[\s\S]*?-webkit-line-clamp: 2/)
    expect(css).toMatch(/\.oa-office-inspect__assignment p\[data-expanded="true"\]\s*\{[\s\S]*?overflow: visible/)
    expect(css).toMatch(/\.oa-office-window__close-mark\s*\{[\s\S]*?clip-path: polygon/)
  })

  it('keeps the three-column character card in landscape windows', () => {
    expect(mediumStart).toBeGreaterThan(gameWindowStart)
    expect(compactStart).toBeGreaterThan(mediumStart)
    expect(phoneStart).toBeGreaterThan(compactStart)
    expect(mediumCss).not.toContain('.oa-office-inspect__facts')
    expect(compactCss).toContain('grid-template-columns: 64px minmax(0, 1fr)')
    expect(compactCss).toContain('.oa-office-inspect__facts,')
    expect(compactCss).toContain('grid-column: 1 / -1')
    expect(compactCss).toMatch(
      /\.oa-office-inspect__latest-result\s*\{[\s\S]*?grid-template-columns: minmax\(0, 1fr\) auto/,
    )
    expect(compactCss).toMatch(
      /\.oa-office-inspect__latest-result time\s*\{[\s\S]*?position: static;[\s\S]*?grid-column: 2;[\s\S]*?grid-row: 1;[\s\S]*?justify-self: end/,
    )
    expect(compactCss).toMatch(
      /\.oa-office-inspect__latest-result p\s*\{[\s\S]*?grid-column: 1 \/ -1;[\s\S]*?grid-row: 2/,
    )
  })

  it('keeps completed records legible as a responsive reward grid', () => {
    expect(css).toMatch(
      /\.oa-office-drawers ul\s*\{[\s\S]*?grid-template-columns: repeat\(3, minmax\(0, 1fr\)\)/,
    )
    expect(compactCss).toMatch(
      /\.oa-office-drawers ul\s*\{[\s\S]*?grid-template-columns: repeat\(2, minmax\(0, 1fr\)\)/,
    )
    expect(css.slice(phoneStart)).toMatch(
      /\.oa-office-drawers ul\s*\{[\s\S]*?grid-template-columns: 1fr/,
    )
    expect(drawerLabelCss).toContain('white-space: normal')
    expect(drawerLabelCss).toContain('overflow-wrap: anywhere')
    expect(drawerLabelCss).toContain('-webkit-line-clamp: 2')
  })
})
