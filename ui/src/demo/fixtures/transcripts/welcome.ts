import type { Transcript, TranscriptFrame } from '../../types'

// Hand-crafted demo transcript: agent investigates Apple Q1 earnings,
// finds a deceleration signal, writes a report, pushes to Inbox. The
// session that "produced" the inbox entry the visitor sees.

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
function typeOut(text: string, perCharMs = 30): void {
  for (const ch of text) add(perCharMs, ch)
}

add(0, '\x1b[2J\x1b[H')
add(80, '\x1b[1;36m╭───────────────────────────────╮\x1b[0m\r\n')
add(40, '\x1b[1;36m│\x1b[0m  \x1b[1mPi\x1b[0m \x1b[2m· workspace aapl-q1\x1b[0m           \x1b[1;36m│\x1b[0m\r\n')
add(40, '\x1b[1;36m╰───────────────────────────────╯\x1b[0m\r\n')
add(600, '\r\n')
add(0, "Hi! I'm Pi.\r\n\r\n")

// User prompt
add(1200, '\x1b[1;32m❯\x1b[0m ')
add(700, '')
typeOut("hey, what jumped out from Apple's Q1 earnings?")
add(400, '\r\n\r\n')

// Tool calls
add(600, '\x1b[2m▶\x1b[0m Reading \x1b[36mdata/news/aapl-q1-2026.md\x1b[0m\r\n')
add(900, '\x1b[2m▶\x1b[0m Reading \x1b[36mdata/sec/aapl/10-Q-Q1-2026.json\x1b[0m\r\n')
add(1100, '\x1b[2m▶\x1b[0m Calculating quarterly services revenue YoY...\x1b[0m\r\n')
add(1500, '\r\n')

// Finding
add(400, "Something the headline EPS beat is hiding:\r\n\r\n")
add(700, '  \x1b[2mQ2 FY25:\x1b[0m  services \x1b[33m+16.3%\x1b[0m YoY\r\n')
add(80, '  \x1b[2mQ3 FY25:\x1b[0m            \x1b[33m+14.2%\x1b[0m\r\n')
add(80, '  \x1b[2mQ4 FY25:\x1b[0m            \x1b[33m+12.0%\x1b[0m\r\n')
add(80, '  \x1b[2mQ1 FY26:\x1b[0m            \x1b[1;31m+9.1%\x1b[0m  \x1b[2m← three-quarter deceleration\x1b[0m\r\n')
add(800, '\r\n')

add(500, "Third consecutive deceleration in services growth.\r\n")
add(40, 'Services has historically been the margin defender (\x1b[33m~29%\x1b[0m);\r\n')
add(40, 'if growth slips below \x1b[33m+8%\x1b[0m the \x1b[1mSaaS-like multiple thesis\x1b[0m\r\n')
add(40, 'breaks down.\r\n\r\n')

add(900, 'Let me write this up properly.\r\n\r\n')

// More tool calls
add(500, '\x1b[2m▶\x1b[0m Writing \x1b[36mresearch-AAPL-q1.md\x1b[0m\r\n')
add(1400, '\x1b[2m▶\x1b[0m \x1b[35minbox_push\x1b[0m: \x1b[2m"AAPL Q1 — Hidden Deceleration Signal"\x1b[0m\r\n')
add(1100, '\r\n')

// Wrap-up
add(500, '\x1b[32m✓\x1b[0m Done. Report posted to your \x1b[1mInbox\x1b[0m.\r\n\r\n')
add(800, 'Want me to set up a watchlist alert on next quarter\'s\r\n')
add(40, 'services number?\r\n\r\n')

// Cursor
add(400, '\x1b[1;32m❯\x1b[0m ')
add(400, '\x1b[5m▁\x1b[0m')

export const aaplResearchTranscript: Transcript = {
  label: 'AAPL Q1 research',
  durationMs: cursor + 500,
  defaultSpeed: 1.0,
  frames,
}
