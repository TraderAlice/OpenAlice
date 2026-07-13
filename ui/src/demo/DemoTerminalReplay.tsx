import { useEffect, useRef, useState } from 'react'
import type { ReactElement } from 'react'

import { FitAddon } from '@xterm/addon-fit'
import { WebLinksAddon } from '@xterm/addon-web-links'
import type { WebglAddon } from '@xterm/addon-webgl'
import { Terminal as Xterm } from '@xterm/xterm'
import '@xterm/xterm/css/xterm.css'

import { attachWebglRenderer } from '../components/workspace/renderer'
import { useResolvedTerminalTheme } from '../components/workspace/terminalTheme'
import { DemoTerminalStub } from './DemoTerminalStub'
import { transcriptsByWorkspace } from './fixtures/transcripts'
import type { Transcript } from './types'

interface DemoTerminalReplayProps {
  readonly label: string
  readonly wsId: string
  readonly sessionId: string
}

export function DemoTerminalReplay(props: DemoTerminalReplayProps): ReactElement {
  const transcript = transcriptsByWorkspace[props.wsId]
  if (!transcript) return <DemoTerminalStub label={props.label} />
  return <ReplayPane key={props.sessionId} label={props.label} transcript={transcript} />
}

function ReplayPane({ label, transcript }: { label: string; transcript: Transcript }): ReactElement {
  const containerRef = useRef<HTMLDivElement | null>(null)
  const [done, setDone] = useState(false)
  const [replayKey, setReplayKey] = useState(0)
  const { profile: terminalThemeProfile } = useResolvedTerminalTheme()

  useEffect(() => {
    const container = containerRef.current
    if (!container) return

    const term = new Xterm({
      theme: terminalThemeProfile.xtermTheme,
      fontFamily:
        'ui-monospace, "SF Mono", Menlo, Monaco, "Cascadia Mono", "DejaVu Sans Mono", monospace',
      fontSize: 13,
      lineHeight: 1.2,
      cursorBlink: true,
      allowProposedApi: true,
      scrollback: 10_000,
      disableStdin: true,
      convertEol: false,
    })

    const fit = new FitAddon()
    term.loadAddon(fit)
    term.loadAddon(new WebLinksAddon())
    term.open(container)

    // Defer everything until xterm's renderer has actually mounted and
    // computed dimensions. Calling fit() or term.write() in the same frame
    // as term.open() triggers a "Cannot read properties of undefined
    // (reading 'dimensions')" race inside Viewport.syncScrollArea.
    let webgl: WebglAddon | null = null
    let resizeObserver: ResizeObserver | null = null
    let frameIdx = 0
    let startTime = 0
    let rafId = 0
    let disposed = false
    const speed = transcript.defaultSpeed ?? 1.0

    const tick = (now: number) => {
      if (disposed) return
      if (startTime === 0) startTime = now
      const elapsed = (now - startTime) * speed
      while (frameIdx < transcript.frames.length && transcript.frames[frameIdx].atMs <= elapsed) {
        term.write(b64ToBytes(transcript.frames[frameIdx].bytesB64))
        frameIdx++
      }
      if (frameIdx < transcript.frames.length) {
        rafId = requestAnimationFrame(tick)
      } else {
        setDone(true)
      }
    }

    // Poll until the container has real dimensions before fitting + writing.
    // ResizeObserver alone isn't sufficient: the flex/grid parent can resolve
    // its size in a later layout pass than the first RAF, and starting writes
    // into a 0-cell terminal leaves it stuck at default 80×24 and wrapping
    // weirdly. Bound the poll so we never hang.
    let pollTries = 0
    const initId = window.setTimeout(function init() {
      if (disposed) return
      const width = container.clientWidth
      const height = container.clientHeight
      if ((width < 50 || height < 30) && pollTries < 40) {
        pollTries++
        window.setTimeout(init, 25)
        return
      }
      // Best-effort WebGL (shared loader: escape-hatch flag + context-loss
      // degradation); falls back to the DOM renderer silently.
      webgl = attachWebglRenderer(term)
      try { fit.fit() } catch { /* noop */ }
      resizeObserver = new ResizeObserver(() => {
        try { fit.fit() } catch { /* noop */ }
      })
      resizeObserver.observe(container)
      rafId = requestAnimationFrame(tick)
    }, 0)

    return () => {
      disposed = true
      window.clearTimeout(initId)
      cancelAnimationFrame(rafId)
      resizeObserver?.disconnect()
      webgl?.dispose()
      term.dispose()
    }
  }, [transcript, replayKey, terminalThemeProfile])

  return (
    <div className="terminal-shell">
      <header className="terminal-header">
        <span className="inline-flex items-center gap-1.5 text-[10px] uppercase tracking-wider text-amber-400">
          <span className="w-1.5 h-1.5 rounded-full bg-amber-400 animate-pulse" />
          Replay
        </span>
        <span className="text-[11px] text-text-muted truncate">{label}</span>
        <span className="flex-1" />
        {done && (
          <button
            type="button"
            onClick={() => setReplayKey((k) => k + 1)}
            className="text-[11px] text-amber-400 hover:underline"
          >
            ↻ Replay again
          </button>
        )}
      </header>
      <div ref={containerRef} className="terminal-host" />
    </div>
  )
}

function b64ToBytes(b64: string): Uint8Array {
  const bin = atob(b64)
  const out = new Uint8Array(bin.length)
  for (let i = 0; i < bin.length; i++) out[i] = bin.charCodeAt(i)
  return out
}
