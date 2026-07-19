import { readFileSync } from 'node:fs'
import { basename, resolve } from 'node:path'

import { describe, expect, it } from 'vitest'

const uiRoot = basename(process.cwd()) === 'ui' ? process.cwd() : resolve(process.cwd(), 'ui')
const css = readFileSync(resolve(uiRoot, 'src/components/workspace/workspaces.css'), 'utf8')

function declarationsFor(selector: string): string {
  const escaped = selector.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')
  const match = css.match(new RegExp(`${escaped}\\s*\\{([^}]*)\\}`))
  if (!match?.[1]) throw new Error(`Missing CSS rule for ${selector}`)
  return match[1]
}

describe('terminal responsive layout contract', () => {
  it('keeps FitAddon parent dimensions free of visual padding', () => {
    const body = declarationsFor('.terminal-body')
    const host = declarationsFor('.terminal-host')

    expect(body).toContain('padding: 8px 8px 4px')
    expect(body).toContain('overflow: hidden')
    expect(host).not.toContain('padding:')
    expect(host).toContain('width: 100%')
    expect(host).toContain('height: 100%')
    expect(host).toContain('min-width: 0')
  })

  it('lets xterm own its viewport and screen dimensions', () => {
    const root = declarationsFor('.terminal-host > .xterm')
    const viewport = declarationsFor('.terminal-host .xterm-viewport')

    expect(root).toContain('max-width: 100%')
    expect(root).toContain('min-width: 0')
    expect(viewport).not.toMatch(/(?:^|\s)(?:width|height)\s*:/)
    expect(css).not.toMatch(/\.terminal-host\s+\.xterm-screen\s*\{/)
  })

  it('allows the terminal shell and header text to shrink', () => {
    expect(declarationsFor('.terminal-shell')).toContain('min-width: 0')
    expect(declarationsFor('.terminal-header')).toContain('overflow: hidden')
    expect(declarationsFor('.terminal-title')).toContain('text-overflow: ellipsis')
    expect(declarationsFor('.terminal-meta')).toContain('text-overflow: ellipsis')
  })
})
