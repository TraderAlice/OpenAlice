export class ProcessTerminal {}

export class TUI {
  #children = []
  #inputHandlers = new Set()
  #started = false

  addChild(component) {
    this.#children.push(component)
  }

  addInputListener(listener) {
    const handler = (chunk) => {
      listener(String(chunk))
    }
    this.#inputHandlers.add(handler)
    process.stdin.on('data', handler)
    return () => {
      this.#inputHandlers.delete(handler)
      process.stdin.off('data', handler)
    }
  }

  requestRender() {
    if (this.#started) this.#render()
  }

  setShowHardwareCursor() {}

  start() {
    this.#started = true
    process.stdin.setEncoding('utf8')
    if (process.stdin.isTTY) process.stdin.setRawMode(true)
    process.stdin.resume()
    this.#render()
  }

  stop() {
    this.#started = false
    for (const handler of this.#inputHandlers) {
      process.stdin.off('data', handler)
    }
    this.#inputHandlers.clear()
    if (process.stdin.isTTY) process.stdin.setRawMode(false)
    process.stdin.pause()
    process.stdout.write('\u001b[?25h\u001b[?2004l\n')
  }

  #render() {
    const width = process.stdout.columns || 100
    const lines = this.#children.flatMap((component) => (
      component.render?.(width) ?? []
    ))
    process.stdout.write(`\u001b[2J\u001b[H${lines.join('\n')}\n`)
  }
}

export class Input {}
export class SelectList {}
export class SettingsList {}

export function matchesKey(data, key) {
  const keys = {
    enter: ['\r', '\n'],
    escape: ['\u001b'],
    'ctrl+c': ['\u0003'],
    tab: ['\t'],
    'shift+tab': ['\u001b[Z'],
    up: ['\u001b[A'],
    down: ['\u001b[B'],
    left: ['\u001b[D'],
    right: ['\u001b[C'],
  }
  return keys[key]?.includes(data) ?? data === key
}
