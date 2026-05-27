import type { Transcript, TranscriptFrame } from '../../types'

// Hand-crafted placeholder transcript. Replace with a real recorded session
// (see ui/src/demo/recorder/README.md) when one is captured.

const enc = new TextEncoder()
function b64(s: string): string {
  const bytes = enc.encode(s)
  let bin = ''
  for (let i = 0; i < bytes.length; i++) bin += String.fromCharCode(bytes[i])
  return btoa(bin)
}

const frames: TranscriptFrame[] = []
let cursor = 0

function add(deltaMs: number, text: string): void {
  cursor += deltaMs
  frames.push({ atMs: cursor, bytesB64: b64(text) })
}

function typeOut(text: string, perCharMs = 35): void {
  for (const ch of text) add(perCharMs, ch)
}

// Banner
add(0, '\x1b[2J\x1b[H')
add(80, '\x1b[1;36m╭───────────────────────────────╮\x1b[0m\r\n')
add(40, '\x1b[1;36m│\x1b[0m  \x1b[1mClaude Code\x1b[0m \x1b[2m· workspace demo\x1b[0m  \x1b[1;36m│\x1b[0m\r\n')
add(40, '\x1b[1;36m╰───────────────────────────────╯\x1b[0m\r\n')
add(600, '\r\n')
add(0, "Hi! I'm Claude. Ask me anything about this workspace.\r\n\r\n")

// User prompt
add(1200, '\x1b[1;32m❯\x1b[0m ')
add(700, '')
typeOut('what does this project do?')
add(400, '\r\n\r\n')

// Tool calls
add(500, '\x1b[2m⏵ Reading\x1b[0m \x1b[36mREADME.md\x1b[0m\r\n')
add(900, '\x1b[2m⏵ Reading\x1b[0m \x1b[36mCLAUDE.md\x1b[0m\r\n')
add(1100, '\x1b[2m⏵ Listing\x1b[0m \x1b[36msrc/\x1b[0m\r\n')
add(800, '\r\n')

// Response — chunked to feel like streaming
add(600, 'OpenAlice is a \x1b[1mfile-driven AI trading agent\x1b[0m. The architecture\r\n')
add(60, 'splits into two long-running processes supervised by Guardian:\r\n\r\n')
add(400, '  \x1b[36m•\x1b[0m \x1b[1mAlice\x1b[0m — the agent runtime: provider routing, workspaces,\r\n')
add(40, '    tool center, listeners. Lives in \x1b[2msrc/\x1b[0m.\r\n')
add(200, '  \x1b[36m•\x1b[0m \x1b[1mUTA\x1b[0m — broker connections + git-like trade approval\r\n')
add(40, '    state. Isolated for credential safety. Lives in\r\n')
add(40, '    \x1b[2mservices/uta/\x1b[0m.\r\n\r\n')

add(700, 'They communicate over HTTP via a typed protocol\r\n')
add(40, '(\x1b[2m@traderalice/uta-protocol\x1b[0m). The split means broker\r\n')
add(40, "credentials never enter the agent process.\r\n\r\n")

add(800, "You're looking at a \x1b[1mWorkspace\x1b[0m right now — Alice's\r\n")
add(40, 'capability extension surface. Each workspace spawns a\r\n')
add(40, 'native CLI agent (\x1b[36mclaude\x1b[0m, \x1b[36mcodex\x1b[0m, or \x1b[36mshell\x1b[0m) in an isolated\r\n')
add(40, "PTY. New capabilities ship as templates, not core code.\r\n\r\n")

add(1000, '\x1b[2mWhat would you like to dig into?\x1b[0m\r\n\r\n')
add(400, '\x1b[1;32m❯\x1b[0m ')
add(400, '\x1b[5m▁\x1b[0m') // blinking underscore

export const welcomeTranscript: Transcript = {
  label: 'Workspace intro',
  durationMs: cursor + 500,
  defaultSpeed: 1.0,
  frames,
}
