import { readFileSync } from 'node:fs'
import { basename, resolve } from 'node:path'

import { describe, expect, it } from 'vitest'

const uiRoot = basename(process.cwd()) === 'ui' ? process.cwd() : resolve(process.cwd(), 'ui')
const css = readFileSync(resolve(uiRoot, 'src/office/office.css'), 'utf8')
const gameWindowStart = css.indexOf('@keyframes oa-office-gba-window')
const mediumStart = css.indexOf('@container (max-width: 760px)', gameWindowStart)
const compactStart = css.indexOf('@container (max-width: 680px)', mediumStart)
const phoneStart = css.indexOf('@media (max-width: 580px)', compactStart)
const mediumCss = css.slice(mediumStart, compactStart)
const compactCss = css.slice(compactStart, phoneStart)

describe('Office Agent-file style contract', () => {
  it('keeps character information ahead of the full-width command row', () => {
    expect(css).toMatch(/\.oa-office-inspect\s*\{[\s\S]*?max-height: 270px/)
    expect(css).toMatch(
      /\.oa-office-inspect__profile\s*\{[\s\S]*?grid-template-columns: 76px minmax\(180px, 1fr\) minmax\(250px, 1\.35fr\)/,
    )
    expect(css).toMatch(
      /\.oa-office-inspect__actions\s*\{[\s\S]*?grid-column: 1 \/ -1/,
    )
  })

  it('keeps the three-column character card in landscape windows', () => {
    expect(mediumStart).toBeGreaterThan(gameWindowStart)
    expect(compactStart).toBeGreaterThan(mediumStart)
    expect(phoneStart).toBeGreaterThan(compactStart)
    expect(mediumCss).not.toContain('.oa-office-inspect__facts')
    expect(compactCss).toContain('grid-template-columns: 64px minmax(0, 1fr)')
    expect(compactCss).toContain('.oa-office-inspect__facts,')
    expect(compactCss).toContain('grid-column: 1 / -1')
  })
})
