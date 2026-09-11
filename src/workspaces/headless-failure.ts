import { open } from 'node:fs/promises'
import { stripVTControlCharacters } from 'node:util'
import type { HeadlessStructuredOutput } from './headless-output.js'

export interface HeadlessFailureInput {
  readonly status: string
  readonly structured?: HeadlessStructuredOutput | null
  readonly error?: string
  readonly stderrTail?: string
  readonly exitCode?: number | null
  readonly signal?: string | null
  readonly killed?: boolean
  readonly processStarted?: boolean
}

/** Successful/recovered turns may contain stderr warnings or earlier errors. */
export function headlessFailureSummary(input: HeadlessFailureInput): string | undefined {
  if (input.status !== 'failed' && input.status !== 'interrupted') return undefined
  const blocks = input.structured?.blocks ?? []
  const lastError = blocks.findLastIndex((block) => block.type === 'error')
  const lastText = blocks.findLastIndex((block) => block.type === 'text')
  const block = lastError > lastText ? blocks[lastError] : undefined
  const structuredError = block?.type === 'error' ? block.message : undefined
  const message = input.processStarted === false && input.error
    ? input.error
    : input.killed
      ? 'Agent run was terminated by the timeout watchdog.'
      : structuredError || input.error || input.stderrTail?.trim()
        || (input.signal ? `Agent process terminated by signal ${input.signal}.` : undefined)
        || (input.exitCode != null ? `Agent process exited with code ${input.exitCode}.` : undefined)
        || (input.status === 'interrupted' ? 'Agent run was interrupted.' : 'Agent run failed without a diagnostic message.')
  return stripVTControlCharacters(message).trim().slice(-2000)
}

/** Read a bounded tail even for historical failures whose task record has no error. */
export async function readHeadlessStderr(path: string): Promise<{ stderrTail: string; stderrTruncated: boolean } | undefined> {
  const file = await open(path, 'r').catch(() => null)
  if (!file) return undefined
  try {
    const size = (await file.stat()).size
    const start = Math.max(0, size - 16 * 1024)
    const buffer = Buffer.alloc(size - start)
    const { bytesRead } = await file.read(buffer, 0, buffer.length, start)
    return { stderrTail: stripVTControlCharacters(buffer.subarray(0, bytesRead).toString('utf8')), stderrTruncated: start > 0 }
  } catch {
    return undefined
  } finally {
    await file.close()
  }
}
