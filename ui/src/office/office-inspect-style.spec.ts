import { readFileSync } from 'node:fs'
import { basename, resolve } from 'node:path'

import { describe, expect, it } from 'vitest'

const uiRoot = basename(process.cwd()) === 'ui' ? process.cwd() : resolve(process.cwd(), 'ui')
const css = readFileSync(resolve(uiRoot, 'src/office/office.css'), 'utf8')

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
})
