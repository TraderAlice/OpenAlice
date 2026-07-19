const KITTY_SCAN_TAIL_LIMIT = 4096
const KITTY_STACK_LIMIT = 16

/** Mirrors xterm's Kitty keyboard flag stack from raw PTY output. */
export class TerminalKittyKeyboardModeTracker {
  private scanTail = ''
  private currentFlags = 0
  private mainFlags = 0
  private altFlags = 0
  private mainStack: number[] = []
  private altStack: number[] = []
  private alternateScreenActive = false

  get flags(): number {
    return this.currentFlags
  }

  reset(): void {
    this.scanTail = ''
    this.currentFlags = 0
    this.mainFlags = 0
    this.altFlags = 0
    this.mainStack = []
    this.altStack = []
    this.alternateScreenActive = false
  }

  scan(data: string): void {
    const input = this.scanTail + data
    this.scanTail = this.extractScanTail(input)
    // eslint-disable-next-line no-control-regex -- terminal protocol bytes
    const mode = /\x1bc|(?:\x1b\[|\x9b)(?:!p|\?([0-9;]+)([hl])|([<>=])([0-9;]*)u)/g
    let match: RegExpExecArray | null
    while ((match = mode.exec(input)) !== null) {
      if (match[0] === '\x1bc') {
        const tail = this.scanTail
        this.reset()
        this.scanTail = tail
        continue
      }
      if (match[0].endsWith('!p')) {
        this.currentFlags = 0
        this.mainFlags = 0
        this.altFlags = 0
        this.mainStack = []
        this.altStack = []
        continue
      }
      if (match[1] !== undefined) {
        this.applyScreenSwitch(match[1], match[2] === 'h')
        continue
      }
      this.applyKittySequence(match[3], match[4] ?? '')
    }
  }

  private applyScreenSwitch(params: string, enabled: boolean): void {
    for (const rawParam of params.split(';')) {
      const param = Number(rawParam)
      if (param !== 47 && param !== 1047 && param !== 1049) continue
      if (enabled) {
        this.mainFlags = this.currentFlags
        this.currentFlags = this.altFlags
        this.alternateScreenActive = true
      } else {
        this.altFlags = this.currentFlags
        this.currentFlags = this.mainFlags
        this.alternateScreenActive = false
      }
    }
  }

  private applyKittySequence(prefix: string, params: string): void {
    const parsed = params.split(';').map((entry) => Number(entry))
    const stack = this.alternateScreenActive ? this.altStack : this.mainStack
    if (prefix === '>') {
      if (stack.length >= KITTY_STACK_LIMIT) stack.shift()
      stack.push(this.currentFlags)
      this.currentFlags = parsed[0] || 0
      return
    }
    if (prefix === '<') {
      const count = Math.max(1, parsed[0] || 1)
      for (let i = 0; i < count && stack.length > 0; i++) {
        this.currentFlags = stack.pop() as number
      }
      if (stack.length === 0) this.currentFlags = 0
      return
    }
    const flags = parsed[0] || 0
    const operation = parsed.length > 1 && parsed[1] ? parsed[1] : 1
    if (operation === 1) this.currentFlags = flags
    else if (operation === 2) this.currentFlags |= flags
    else if (operation === 3) this.currentFlags &= ~flags
  }

  private extractScanTail(input: string): string {
    const start = Math.max(input.lastIndexOf('\x1b'), input.lastIndexOf('\x9b'))
    if (start === -1) return ''
    const tail = input.slice(start)
    if (tail.length > KITTY_SCAN_TAIL_LIMIT) return ''
    if (tail === '\x1b' || tail === '\x1b[' || tail === '\x9b') return tail
    const body = tail.startsWith('\x1b[')
      ? tail.slice(2)
      : tail.startsWith('\x9b')
        ? tail.slice(1)
        : null
    if (body === null) return ''
    return body === '!' || /^[<>=?]?[0-9;]*$/.test(body) ? tail : ''
  }
}
