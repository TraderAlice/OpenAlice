import { appendFileSync, mkdirSync, renameSync, statSync, unlinkSync } from 'node:fs'
import { dirname } from 'node:path'

const DEFAULT_MAX_LOG_BYTES = 512 * 1024

export class BoundedTextTail {
  private value = ''

  constructor(private readonly maxCharacters = 12_000) {}

  append(chunk: string | Uint8Array): void {
    this.value += typeof chunk === 'string' ? chunk : Buffer.from(chunk).toString('utf8')
    if (this.value.length > this.maxCharacters) {
      this.value = this.value.slice(-this.maxCharacters)
    }
  }

  text(): string {
    return this.value
  }
}

export class DesktopDiagnostics {
  constructor(
    readonly path: string,
    private readonly maxLogBytes = DEFAULT_MAX_LOG_BYTES,
  ) {
    mkdirSync(dirname(path), { recursive: true })
    try {
      if (statSync(path).size > maxLogBytes) {
        try { unlinkSync(`${path}.previous`) } catch { /* no previous log */ }
        renameSync(path, `${path}.previous`)
      }
    } catch {
      // A missing or concurrently rotated log starts fresh.
    }
  }

  write(source: string, message: string | Uint8Array): void {
    const text = typeof message === 'string' ? message : Buffer.from(message).toString('utf8')
    const normalized = text.endsWith('\n') ? text : `${text}\n`
    try {
      appendFileSync(this.path, `[${new Date().toISOString()}] [${source}] ${normalized}`, 'utf8')
    } catch {
      // Diagnostics must never become a new startup failure.
    }
  }
}

export function conciseDiagnosticTail(raw: string, maxLines = 8): string {
  return raw
    .split(/\r?\n/)
    .map((line) => line.trim())
    .filter(Boolean)
    .slice(-maxLines)
    .join('\n')
}
