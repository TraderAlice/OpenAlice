import { spawn } from 'node:child_process'

const KEYBOARD_INPUT_SOURCE_TIMEOUT_MS = 500
const MAC_HITOOLBOX_DOMAIN = 'com.apple.HIToolbox'

export const MAC_SELECTED_INPUT_SOURCES_JSON_COMMAND = [
  `/usr/bin/defaults export ${MAC_HITOOLBOX_DOMAIN} -`,
  '/usr/bin/plutil -extract AppleSelectedInputSources xml1 -o - -',
  '/usr/bin/plutil -convert json -o - -',
].join(' | ')

export interface KeyboardInputSourceCommandRunner {
  (command: string, args: string[], timeoutMessage: string): Promise<string>
}

function readCommandStdout(
  command: string,
  args: string[],
  timeoutMessage: string,
): Promise<string> {
  return new Promise((resolve, reject) => {
    let settled = false
    let child: ReturnType<typeof spawn> | undefined

    const killTree = (): void => {
      if (!child?.pid) return
      try {
        process.kill(-child.pid, 'SIGKILL')
      } catch {
        child.kill()
      }
    }

    const timer = setTimeout(() => {
      if (settled) return
      settled = true
      killTree()
      reject(new Error(timeoutMessage))
    }, KEYBOARD_INPUT_SOURCE_TIMEOUT_MS)

    const settle = (callback: () => void): void => {
      if (settled) return
      settled = true
      clearTimeout(timer)
      callback()
    }

    try {
      child = spawn(command, args, { detached: true, stdio: ['ignore', 'pipe', 'ignore'] })
      let stdout = ''
      child.stdout?.setEncoding('utf8')
      child.stdout?.on('data', (chunk: string) => { stdout += chunk })
      const failWith = (error: Error): void => {
        killTree()
        settle(() => reject(error))
      }
      child.stdout?.on('error', failWith)
      child.on('error', failWith)
      child.on('close', (code, signal) => {
        settle(() => code === 0
          ? resolve(stdout)
          : reject(new Error(
              `${command} exited with ${signal ? `signal ${signal}` : `code ${code ?? 'unknown'}`}`,
            )))
      })
    } catch (error) {
      settle(() => reject(error))
    }
  })
}

export function readSelectedInputSourceIdFromJson(stdout: string): string | null {
  let records: unknown
  try {
    records = JSON.parse(stdout)
  } catch {
    return null
  }
  if (!Array.isArray(records)) return null

  for (const record of records.slice().reverse()) {
    if (!record || typeof record !== 'object') continue
    const fields = record as Record<string, unknown>
    const kind = typeof fields.InputSourceKind === 'string' ? fields.InputSourceKind : ''
    if (kind.toLowerCase().includes('non keyboard')) continue
    const inputMode = fields['Input Mode']
    if (typeof inputMode === 'string' && inputMode.trim()) return inputMode.trim()
    const bundleId = fields['Bundle ID']
    if (typeof bundleId === 'string' && bundleId.trim()) return bundleId.trim()
  }
  return null
}

export async function readKeyboardInputSourceId(options: {
  platform?: NodeJS.Platform
  runCommand?: KeyboardInputSourceCommandRunner
} = {}): Promise<string | null> {
  if ((options.platform ?? process.platform) !== 'darwin') return null
  const runCommand = options.runCommand ?? readCommandStdout

  try {
    const selected = await runCommand(
      '/bin/sh',
      ['-c', MAC_SELECTED_INPUT_SOURCES_JSON_COMMAND],
      'Selected keyboard input source probe timed out',
    )
    const selectedId = readSelectedInputSourceIdFromJson(selected)
    if (selectedId) return selectedId
  } catch {
    // Fall through to the keyboard-layout preference.
  }

  try {
    const fallback = await runCommand(
      '/usr/bin/defaults',
      ['read', MAC_HITOOLBOX_DOMAIN, 'AppleCurrentKeyboardLayoutInputSourceID'],
      'Keyboard layout input source probe timed out',
    )
    return fallback.trim() || null
  } catch {
    return null
  }
}
