import { readFileSync } from 'node:fs'
import type { Component } from '@earendil-works/pi-tui'

import { inspectRuntime } from './lifecycle.mjs'
import { loadPiTui } from './pi-tui-loader.ts'

interface RuntimeSummary {
  class?: string
  home?: string
  productVersion?: string
  runtimeVersion?: string
  endpoints?: { web?: string | null }
  owner?: {
    surface?: string
    pid?: number
  } | null
  components?: {
    alice?: { status?: string }
    uta?: { status?: string }
    connector?: { status?: string }
  }
}

export interface SupervisorSnapshot {
  version: string
  channel: string
  runtime: RuntimeSummary | null
  diagnostic?: string
}

export interface SupervisorTuiDependencies {
  env?: NodeJS.ProcessEnv
  stdin?: NodeJS.ReadStream
  stdout?: NodeJS.WriteStream
  inspect?: () => Promise<RuntimeSummary>
  loadTui?: typeof loadPiTui
  version?: string
  channel?: string
}

export async function runSupervisorTui(
  dependencies: SupervisorTuiDependencies = {},
): Promise<number> {
  const stdin = dependencies.stdin ?? process.stdin
  const stdout = dependencies.stdout ?? process.stdout
  if (!stdin.isTTY || !stdout.isTTY) {
    throw Object.assign(
      new Error('the Supervisor TUI requires an interactive terminal; use "openalice status --json" for automation'),
      { code: 'ETTY', exitCode: 2 },
    )
  }

  let runtime: RuntimeSummary | null = null
  let diagnostic: string | undefined
  try {
    runtime = await (dependencies.inspect ?? (() => inspectRuntime()))()
  } catch (error: unknown) {
    diagnostic = error instanceof Error ? error.message : String(error)
  }

  const piTui = await (dependencies.loadTui ?? loadPiTui)(dependencies.env)
  const terminal = new piTui.ProcessTerminal()
  const ui = new piTui.TUI(terminal)
  const screen = new SupervisorScreen({
    version: dependencies.version ?? readCliVersion(),
    channel: dependencies.channel ?? 'development',
    runtime,
    diagnostic,
  })
  ui.addChild(screen)

  return new Promise<number>((resolve) => {
    let settled = false
    const finish = (code = 0) => {
      if (settled) return
      settled = true
      removeInputListener()
      process.off('SIGTERM', onTerminate)
      process.off('SIGINT', onTerminate)
      ui.stop()
      resolve(code)
    }
    const onTerminate = () => finish()
    const removeInputListener = ui.addInputListener((data) => {
      if (
        piTui.matchesKey(data, 'q')
        || piTui.matchesKey(data, 'escape')
        || piTui.matchesKey(data, 'ctrl+c')
      ) {
        finish()
        return { consume: true }
      }
      return undefined
    })

    process.once('SIGTERM', onTerminate)
    process.once('SIGINT', onTerminate)
    ui.start()
  })
}

export class SupervisorScreen implements Component {
  private readonly snapshot: SupervisorSnapshot

  constructor(snapshot: SupervisorSnapshot) {
    this.snapshot = snapshot
  }

  render(width: number): string[] {
    const runtime = this.snapshot.runtime
    const narrow = width < 60
    const state = runtime?.class ?? 'unavailable'
    const lines = [
      `OpenAlice  ${this.snapshot.version}  ${this.snapshot.channel}`,
      '─'.repeat(Math.max(1, Math.min(width, 80))),
      narrow ? `Runtime: ${state}` : `Runtime state: ${state}`,
      `Home: ${runtime?.home ?? 'default'}`,
    ]
    if (!narrow) {
      lines.push(
        `Owner: ${formatOwner(runtime)}`,
        `Web: ${runtime?.endpoints?.web ?? 'not available'}`,
        `Components: ${formatComponents(runtime)}`,
      )
    }
    if (this.snapshot.diagnostic) {
      lines.push('', `Diagnostic: ${sanitize(this.snapshot.diagnostic)}`)
    }
    lines.push(
      '',
      state === 'absent'
        ? 'OpenAlice is stopped. Runtime controls are coming in the next increment.'
        : 'Open the Web UI for product interaction.',
      '',
      'q / Esc / Ctrl+C  Detach',
    )
    return lines.map((line) => truncate(line, width))
  }

  invalidate(): void {}
}

function formatOwner(runtime: RuntimeSummary | null): string {
  if (!runtime?.owner) return 'none'
  const pid = runtime.owner.pid === undefined ? '' : ` pid ${runtime.owner.pid}`
  return `${runtime.owner.surface ?? 'unknown'}${pid}`
}

function formatComponents(runtime: RuntimeSummary | null): string {
  const components = runtime?.components
  if (!components) return 'not reported'
  return [
    `Alice ${components.alice?.status ?? 'unknown'}`,
    `UTA ${components.uta?.status ?? 'optional'}`,
    `Connector ${components.connector?.status ?? 'optional'}`,
  ].join(' · ')
}

function sanitize(value: string): string {
  return value.replaceAll(/[\u0000-\u001f\u007f-\u009f]/g, ' ')
}

function truncate(value: string, width: number): string {
  if (width <= 0) return ''
  return value.length <= width ? value : `${value.slice(0, Math.max(0, width - 1))}…`
}

function readCliVersion(): string {
  const packageUrl = new URL('../package.json', import.meta.url)
  const manifest = JSON.parse(readFileSync(packageUrl, 'utf8')) as { version?: unknown }
  return typeof manifest.version === 'string' ? manifest.version : 'unknown'
}
