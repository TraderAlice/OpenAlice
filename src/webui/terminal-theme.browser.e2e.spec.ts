import { spawn, type ChildProcess } from 'node:child_process'
import { once } from 'node:events'
import { createServer } from 'node:net'
import { chromium, type Browser, type Page } from 'playwright'
import { afterAll, beforeAll, describe, expect, it } from 'vitest'

import { demoThemeFamily } from '../../ui/src/demo/fixtures/themes.js'
import type { ThemeVariant } from '../../ui/src/api/themes.js'

const uiRoot = new URL('../../ui', import.meta.url).pathname
const viteCli = new URL('../../ui/node_modules/vite/bin/vite.js', import.meta.url).pathname
let vite: ChildProcess | undefined
let browser: Browser | undefined
let page: Page | undefined
let baseUrl = ''

async function availablePort(): Promise<number> {
  const server = createServer()
  server.listen(0, '127.0.0.1')
  await once(server, 'listening')
  const address = server.address()
  if (address === null || typeof address === 'string') throw new Error('Failed to allocate xterm browser port')
  server.close()
  await once(server, 'close')
  return address.port
}

async function waitForServer(url: string, child: ChildProcess): Promise<void> {
  const deadline = Date.now() + 30_000
  while (Date.now() < deadline) {
    if (child.exitCode !== null) throw new Error(`Demo Vite exited before ready (${child.exitCode})`)
    try {
      if ((await fetch(url)).ok) return
    } catch { /* not bound yet */ }
    await new Promise((resolve) => setTimeout(resolve, 100))
  }
  throw new Error(`Timed out waiting for ${url}`)
}

describe('xterm theme runtime in a real browser', () => {
  beforeAll(async () => {
    const port = await availablePort()
    baseUrl = `http://127.0.0.1:${port}`
    vite = spawn(process.execPath, [
      viteCli, '--mode', 'demo', '--host', '127.0.0.1', '--port', String(port), '--strictPort',
    ], { cwd: uiRoot, env: { ...process.env, NO_COLOR: '1' }, stdio: ['ignore', 'pipe', 'pipe'] })
    await waitForServer(`${baseUrl}/settings`, vite)
    browser = await chromium.launch({ headless: true, channel: 'chrome' })
    page = await browser.newPage({ viewport: { width: 900, height: 700 } })
  }, 45_000)

  afterAll(async () => {
    await browser?.close()
    if (vite !== undefined && vite.exitCode === null) {
      vite.kill('SIGTERM')
      await Promise.race([once(vite, 'exit'), new Promise((resolve) => setTimeout(resolve, 5_000))])
      if (vite.exitCode === null) vite.kill('SIGKILL')
    }
  }, 10_000)

  it('hot-updates OSC colors without replacing the terminal, buffer, or selection', async () => {
    if (page === undefined) throw new Error('Browser setup failed')
    const family = demoThemeFamily('tinted-base16', 'Runtime xterm', ['light', 'dark'])
    const light = family.variants.light
    const dark = family.variants.dark
    if (light === undefined || dark === undefined) throw new Error('Paired fixture omitted a variant')
    const oscRgb = (hex: string) => `rgb:${hex.slice(1, 3).repeat(2)}/${hex.slice(3, 5).repeat(2)}/${hex.slice(5, 7).repeat(2)}`
    const expected = (variant: typeof light) => [
      variant.palette.base00,
      variant.palette.base12 ?? variant.palette.base08,
      variant.palette.base09,
      variant.palette.base06,
      variant.palette.base05,
      variant.palette.base00,
      variant.palette.base0D,
    ].map(oscRgb)
    await page.goto(`${baseUrl}/settings`)

    const result = await page.evaluate(async ({ lightVariant, darkVariant }) => {
      const [{ Terminal }, themeModule] = await Promise.all([
        (0, eval)('import("/@id/@xterm/xterm")') as Promise<typeof import('@xterm/xterm')>,
        (0, eval)('import("/src/components/workspace/terminalThemeProfile.ts")') as Promise<
          typeof import('../../ui/src/components/workspace/terminalThemeProfile.js')
        >,
      ])
      const host = document.createElement('div')
      host.style.cssText = 'width:800px;height:500px;position:fixed;inset:0;background:#000'
      document.body.append(host)
      const lightProfile = themeModule.terminalThemeProfileForVariant(lightVariant)
      const darkProfile = themeModule.terminalThemeProfileForVariant(darkVariant)
      const terminal = new Terminal({ cols: 80, rows: 12, allowProposedApi: true, theme: lightProfile.xtermTheme })
      terminal.open(host)
      ;(terminal as typeof terminal & { __identity?: string }).__identity = 'same-xterm-object'
      await new Promise<void>((resolve) => terminal.write('persistent marker\r\nselected text\r\n', resolve))
      terminal.select(0, 1, 8)
      const before = {
        identity: (terminal as typeof terminal & { __identity?: string }).__identity,
        selection: terminal.getSelection(),
        bufferLength: terminal.buffer.active.length,
        marker: terminal.buffer.active.getLine(0)?.translateToString(true),
      }

      const replies: string[] = []
      const disposable = terminal.onData((data) => replies.push(data))
      const query = async (osc: string): Promise<string> => {
        const start = replies.length
        await new Promise<void>((resolve) => terminal.write(`\u001b]${osc};?\u001b\\`, resolve))
        const deadline = Date.now() + 2_000
        while (replies.length === start && Date.now() < deadline) {
          await new Promise((resolve) => setTimeout(resolve, 10))
        }
        if (replies.length === start) throw new Error(`No OSC response for ${osc}`)
        return replies.slice(start).join('')
      }

      const lightReplies = await Promise.all(['4;0', '4;9', '4;16', '4;21', '10', '11', '12'].map(query))
      await new Promise<void>((resolve) => terminal.write('\u001b]4;0;#123456\u001b\\', resolve))
      const overriddenBlack = await query('4;0')
      themeModule.applyTerminalTheme(terminal, darkProfile)
      const darkReplies = await Promise.all(['4;0', '4;9', '4;16', '4;21', '10', '11', '12'].map(query))
      const after = {
        identity: (terminal as typeof terminal & { __identity?: string }).__identity,
        selection: terminal.getSelection(),
        bufferLength: terminal.buffer.active.length,
        marker: terminal.buffer.active.getLine(0)?.translateToString(true),
      }
      disposable.dispose()
      terminal.dispose()
      host.remove()
      return { before, after, lightReplies, overriddenBlack, darkReplies }
    }, { lightVariant: light, darkVariant: dark })

    expect(result.after).toEqual(result.before)
    expect(result.before).toMatchObject({
      identity: 'same-xterm-object', selection: 'selected', marker: 'persistent marker',
    })
    expect(result.overriddenBlack).toContain('rgb:1212/3434/5656')
    for (const [index, color] of expected(light).entries()) {
      expect(result.lightReplies[index], `light query ${index}`).toContain(color)
    }
    for (const [index, color] of expected(dark).entries()) {
      expect(result.darkReplies[index], `dark query ${index}`).toContain(color)
    }
    expect(result.darkReplies[0]).not.toBe(result.overriddenBlack)
  }, 30_000)

  it('answers OSC from Base24 bright slots and an exact ANSI16 override', async () => {
    if (page === undefined) throw new Error('Browser setup failed')
    const base = demoThemeFamily('tinted-base16', 'Runtime extended', ['dark']).variants.dark
    if (base === undefined) throw new Error('Dark fixture omitted its variant')
    const base24: ThemeVariant = {
      ...base,
      id: 'runtime-base24',
      palette: {
        ...base.palette,
        base10: '#202122', base11: '#303132', base12: '#aa1020', base13: '#bbaa20',
        base14: '#20aa30', base15: '#20aabb', base16: '#2055cc', base17: '#aa20bb',
      },
    }
    const override: ThemeVariant = {
      ...base,
      id: 'runtime-ansi-override',
      ansi16Override: {
        foreground: '#f0f0f0', background: '#101010', cursor: '#80c0ff', cursorText: '#101010',
        selectionForeground: '#ffffff', selectionBackground: '#303060',
        colors: [
          '#010101', '#110000', '#001100', '#111100', '#000011', '#110011', '#001111', '#aaaaaa',
          '#555555', '#ff1010', '#10ff10', '#ffff10', '#1010ff', '#ff10ff', '#10ffff', '#fefefe',
        ],
      },
    }
    await page.goto(`${baseUrl}/settings`)
    const replies = await page.evaluate(async ({ base24Variant, overrideVariant }) => {
      const [{ Terminal }, themeModule] = await Promise.all([
        (0, eval)('import("/@id/@xterm/xterm")') as Promise<typeof import('@xterm/xterm')>,
        (0, eval)('import("/src/components/workspace/terminalThemeProfile.ts")') as Promise<
          typeof import('../../ui/src/components/workspace/terminalThemeProfile.js')
        >,
      ])
      const host = document.createElement('div')
      host.style.cssText = 'width:800px;height:500px;position:fixed;inset:0'
      document.body.append(host)
      const terminal = new Terminal({ cols: 80, rows: 12, allowProposedApi: true })
      terminal.open(host)
      const output: string[] = []
      const disposable = terminal.onData((data) => output.push(data))
      const query = async (osc: string): Promise<string> => {
        const start = output.length
        await new Promise<void>((resolve) => terminal.write(`\u001b]${osc};?\u001b\\`, resolve))
        const deadline = Date.now() + 2_000
        while (output.length === start && Date.now() < deadline) await new Promise((resolve) => setTimeout(resolve, 10))
        if (output.length === start) throw new Error(`No OSC response for ${osc}`)
        return output.slice(start).join('')
      }
      themeModule.applyTerminalTheme(terminal, themeModule.terminalThemeProfileForVariant(base24Variant))
      const base24Replies = await Promise.all(['4;9', '4;10', '4;11', '4;12', '4;13', '4;14'].map(query))
      themeModule.applyTerminalTheme(terminal, themeModule.terminalThemeProfileForVariant(overrideVariant))
      const overrideReplies = await Promise.all(['4;0', '4;9', '4;14', '4;15', '4;16', '10', '11', '12'].map(query))
      disposable.dispose()
      terminal.dispose()
      host.remove()
      return { base24Replies, overrideReplies }
    }, { base24Variant: base24, overrideVariant: override })
    const rgb = (hex: string) => `rgb:${hex.slice(1, 3).repeat(2)}/${hex.slice(3, 5).repeat(2)}/${hex.slice(5, 7).repeat(2)}`
    for (const [index, color] of ['#aa1020', '#20aa30', '#bbaa20', '#2055cc', '#aa20bb', '#20aabb'].entries()) {
      expect(replies.base24Replies[index]).toContain(rgb(color))
    }
    for (const [index, color] of [
      '#010101', '#ff1010', '#10ffff', '#fefefe', base.palette.base09, '#f0f0f0', '#101010', '#80c0ff',
    ].entries()) {
      expect(replies.overrideReplies[index]).toContain(rgb(color))
    }
  }, 30_000)
})
