import { readFileSync } from 'node:fs'
import { basename, resolve } from 'node:path'

import { describe, expect, it } from 'vitest'

const uiRoot = basename(process.cwd()) === 'ui' ? process.cwd() : resolve(process.cwd(), 'ui')
const css = readFileSync(resolve(uiRoot, 'src/office/office.css'), 'utf8')

describe('Office pause style contract', () => {
  it('freezes the floor behind Menu with a pixel-grid veil', () => {
    expect(css).toMatch(/\.oa-office-campus\[data-menu-open="true"\]\s*\{[\s\S]*?cursor: default/)
    expect(css).toMatch(/\.oa-office-campus\[data-menu-open="true"\]::after\s*\{[\s\S]*?z-index: 50/)
    expect(css).toMatch(/\.oa-office-campus\[data-menu-open="true"\]::after\s*\{[\s\S]*?4px 4px/)
  })
})
