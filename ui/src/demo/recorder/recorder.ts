import type { Transcript, TranscriptFrame } from '../types'

const PTY_URL_PATTERN = /\/api\/workspaces\/pty(\?|$)/
const STORAGE_HINT = '__demoRecord'

let active = false
let originalWS: typeof WebSocket | null = null
let frames: TranscriptFrame[] = []
let startTs = 0

function bytesToB64(buffer: ArrayBuffer): string {
  const bytes = new Uint8Array(buffer)
  let binary = ''
  for (let i = 0; i < bytes.length; i++) binary += String.fromCharCode(bytes[i])
  return btoa(binary)
}

export function startRecording(): void {
  if (active) {
    console.warn('[recorder] already active — call __demoRecord.stop() first')
    return
  }
  originalWS = window.WebSocket
  frames = []
  startTs = Date.now()

  // Constructor proxy: tap only PTY connections, pass others through unchanged.
  const Recorder = function (
    this: WebSocket,
    url: string | URL,
    protocols?: string | string[],
  ): WebSocket {
    const ws = new originalWS!(url, protocols)
    if (PTY_URL_PATTERN.test(String(url))) {
      ws.addEventListener('message', (ev: MessageEvent) => {
        if (ev.data instanceof ArrayBuffer) {
          frames.push({ atMs: Date.now() - startTs, bytesB64: bytesToB64(ev.data) })
        } else if (ev.data instanceof Blob) {
          ev.data.arrayBuffer().then((buf) => {
            frames.push({ atMs: Date.now() - startTs, bytesB64: bytesToB64(buf) })
          })
        }
      })
    }
    return ws
  } as unknown as typeof WebSocket

  // Copy static fields so callers that do `WebSocket.OPEN` etc. still work.
  Recorder.prototype = originalWS.prototype
  Object.assign(Recorder, {
    CONNECTING: originalWS.CONNECTING,
    OPEN: originalWS.OPEN,
    CLOSING: originalWS.CLOSING,
    CLOSED: originalWS.CLOSED,
  })

  window.WebSocket = Recorder
  active = true
  console.info('[recorder] PTY recording started — interact with the terminal, then call __demoRecord.stop(label)')
}

export function stopRecording(label = 'recorded'): Transcript | null {
  if (!active) {
    console.warn('[recorder] not active')
    return null
  }
  if (originalWS) window.WebSocket = originalWS
  active = false

  const transcript: Transcript = {
    label,
    durationMs: frames.length > 0 ? frames[frames.length - 1].atMs + 500 : 0,
    frames,
  }

  // Trigger download
  const blob = new Blob([JSON.stringify(transcript, null, 2)], { type: 'application/json' })
  const url = URL.createObjectURL(blob)
  const a = document.createElement('a')
  a.href = url
  a.download = `transcript-${slug(label)}-${Date.now()}.json`
  document.body.appendChild(a)
  a.click()
  document.body.removeChild(a)
  URL.revokeObjectURL(url)

  console.info(`[recorder] stopped · ${frames.length} frames · ${transcript.durationMs}ms · downloaded`)
  return transcript
}

function slug(s: string): string {
  return s.toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-+|-+$/g, '') || 'recording'
}

// Auto-attach to window for dev-console use. Only loaded in dev mode by main.tsx,
// so this side effect is invisible to demo / prod builds.
declare global {
  interface Window {
    [STORAGE_HINT]?: {
      start: typeof startRecording
      stop: typeof stopRecording
    }
  }
}

window.__demoRecord = { start: startRecording, stop: stopRecording }
console.info('[recorder] ready · run __demoRecord.start() in console before opening a terminal')
