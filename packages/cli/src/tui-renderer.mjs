const ENTER_ALTERNATE_SCREEN = '\x1b[?1049h'
const LEAVE_ALTERNATE_SCREEN = '\x1b[?1049l'
const HIDE_CURSOR = '\x1b[?25l'
const SHOW_CURSOR = '\x1b[?25h'
const RESET_STYLE = '\x1b[0m'

export class AnsiTerminalRenderer {
  constructor(output) {
    this.output = output
    this.active = false
    this.previousLines = []
  }

  enter() {
    if (this.active) return
    this.active = true
    this.output.write(`${ENTER_ALTERNATE_SCREEN}${HIDE_CURSOR}\x1b[2J\x1b[H`)
  }

  render(lines) {
    if (!this.active) this.enter()
    const nextLines = Array.isArray(lines) ? lines.map(String) : []
    const lineCount = Math.max(this.previousLines.length, nextLines.length)
    let update = ''
    for (let index = 0; index < lineCount; index += 1) {
      const next = nextLines[index] ?? ''
      if (this.previousLines[index] === next) continue
      update += `\x1b[${index + 1};1H${next}\x1b[K`
    }
    if (update) this.output.write(update)
    this.previousLines = nextLines
  }

  invalidate() {
    this.previousLines = []
  }

  close() {
    if (!this.active) return
    this.active = false
    this.previousLines = []
    this.output.write(`${RESET_STYLE}${SHOW_CURSOR}${LEAVE_ALTERNATE_SCREEN}`)
  }
}

export const terminalSequences = {
  enterAlternateScreen: ENTER_ALTERNATE_SCREEN,
  leaveAlternateScreen: LEAVE_ALTERNATE_SCREEN,
  hideCursor: HIDE_CURSOR,
  showCursor: SHOW_CURSOR,
  resetStyle: RESET_STYLE,
}
