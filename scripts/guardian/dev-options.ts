import { resolve } from 'node:path'

export interface DevGuardianOptions {
  readonly home: string | null
}
export function parseDevGuardianOptions(
  argv: readonly string[],
  cwd = process.cwd(),
): DevGuardianOptions {
  let home: string | null = null
  for (let index = 0; index < argv.length; index += 1) {
    const arg = argv[index]
    if (arg === '--') continue
    if (arg === '--home') {
      const value = argv[index + 1]
      if (!value || value === '--' || value.startsWith('--')) {
        throw new Error('--home requires a directory path')
      }
      home = resolve(cwd, value)
      index += 1
      continue
    }
    if (arg.startsWith('--home=')) {
      const value = arg.slice('--home='.length).trim()
      if (!value) throw new Error('--home requires a directory path')
      home = resolve(cwd, value)
    }
  }
  return { home }
}
