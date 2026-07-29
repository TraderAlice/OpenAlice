import { lstat, open, readdir } from 'node:fs/promises'
import { resolve } from 'node:path'

import { resolveOpenAliceHome } from './server-control.mjs'

const LOG_NAME_PATTERN = /^server\.log(?:\.(\d{1,3}))?$/
const MAX_LOG_FILES = 10
const MAX_BYTES_PER_FILE = 256 * 1024
const MAX_TOTAL_BYTES = 1024 * 1024
const DEFAULT_LINES = 200
const MAX_LINES = 5_000

export async function readRuntimeLogs(options = {}, dependencies = {}) {
  const homeRoot = resolveOpenAliceHome(options.homeRoot, {
    env: dependencies.env,
    homeDir: dependencies.homeDir,
  })
  const lineLimit = normalizeLineLimit(options.lines)
  const files = await discoverRuntimeLogs(homeRoot, dependencies)
  const entries = []
  let remainingBytes = MAX_TOTAL_BYTES

  for (const file of files) {
    if (remainingBytes <= 0) break
    const byteLimit = Math.min(MAX_BYTES_PER_FILE, remainingBytes)
    const tail = await readFileTail(file.path, byteLimit, dependencies)
    remainingBytes -= tail.bytesRead
    const text = redactRuntimeLog(tail.text)
    const lines = text.split(/\r?\n/)
    while (lines.at(-1) === '') lines.pop()
    for (const line of lines) {
      if (line.length === 0 && entries.at(-1)?.text === '') continue
      entries.push({ file: file.name, text: line })
    }
  }

  while (entries.at(-1)?.text === '') entries.pop()
  return {
    home: homeRoot,
    component: 'runtime',
    lineLimit,
    truncated: files.some((file) => file.size > MAX_BYTES_PER_FILE)
      || entries.length > lineLimit,
    files: files.map(({ name, size, modifiedAt }) => ({ name, size, modifiedAt })),
    entries: entries.slice(-lineLimit),
  }
}

export async function discoverRuntimeLogs(homeRoot, dependencies = {}) {
  const readdirImpl = dependencies.readdirImpl ?? readdir
  const lstatImpl = dependencies.lstatImpl ?? lstat
  const logsDirectory = resolve(homeRoot, 'logs')
  let directoryStat
  try {
    directoryStat = await lstatImpl(logsDirectory)
  } catch (error) {
    if (error?.code === 'ENOENT') return []
    throw error
  }
  if (!directoryStat.isDirectory() || directoryStat.isSymbolicLink()) {
    throw logError('EUNSAFELOGPATH', `OpenAlice log directory is not a regular directory: ${logsDirectory}`)
  }

  const names = await readdirImpl(logsDirectory)
  const candidates = []
  for (const name of names) {
    const match = LOG_NAME_PATTERN.exec(name)
    if (!match) continue
    const path = resolve(logsDirectory, name)
    const stats = await lstatImpl(path)
    if (!stats.isFile() || stats.isSymbolicLink()) continue
    candidates.push({
      name,
      path,
      rotation: match[1] ? Number(match[1]) : 0,
      size: stats.size,
      modifiedAt: stats.mtime.toISOString(),
    })
  }

  return candidates
    .sort((left, right) => left.rotation - right.rotation)
    .slice(0, MAX_LOG_FILES)
    .sort((left, right) => right.rotation - left.rotation)
}

export function redactRuntimeLog(value) {
  const lines = String(value).split(/\r?\n/)
  let redactNextNonEmpty = false
  return lines.map((originalLine) => {
    let line = originalLine
    if (/first-run admin token/i.test(line)) redactNextNonEmpty = true
    else if (redactNextNonEmpty && line.trim()) {
      line = line.replace(/\S+/, '[REDACTED]')
      redactNextNonEmpty = false
    }
    line = line
      .replace(/\bBearer\s+[A-Za-z0-9._~+/=-]{8,}/gi, 'Bearer [REDACTED]')
      .replace(
        /(["'](?:api[-_ ]?key|access[-_ ]?token|refresh[-_ ]?token|token|secret|password|private[-_ ]?key|sealing[-_ ]?key)["']\s*:\s*)(["'])(.*?)\2/gi,
        '$1$2[REDACTED]$2',
      )
      .replace(
        /(["']?(?:api[-_ ]?key|access[-_ ]?token|refresh[-_ ]?token|token|secret|password|private[-_ ]?key|sealing[-_ ]?key)["']?\s*[:=]\s*)(["']?)[^\s,;&}"']+\2/gi,
        '$1[REDACTED]',
      )
      .replace(
        /([?&](?:api[-_]?key|access[-_]?token|refresh[-_]?token|token|secret|password)=)[^&\s]+/gi,
        '$1[REDACTED]',
      )
      .replace(/\bsk-[A-Za-z0-9_-]{12,}\b/g, '[REDACTED]')
      .replace(/\bAKIA[A-Z0-9]{16}\b/g, '[REDACTED]')
    return escapeControlCharacters(line)
  }).join('\n')
}

function escapeControlCharacters(value) {
  return value.replace(
    /[\u0000-\u0008\u000b\u000c\u000e-\u001f\u007f-\u009f]/g,
    (character) => `\\x${character.codePointAt(0).toString(16).padStart(2, '0')}`,
  )
}

async function readFileTail(path, byteLimit, dependencies) {
  const openImpl = dependencies.openImpl ?? open
  const handle = await openImpl(path, 'r')
  try {
    const stats = await handle.stat()
    const length = Math.min(stats.size, byteLimit)
    const buffer = Buffer.alloc(length)
    const position = Math.max(0, stats.size - length)
    const { bytesRead } = await handle.read(buffer, 0, length, position)
    let text = buffer.subarray(0, bytesRead).toString('utf8')
    if (position > 0) {
      const firstNewline = text.indexOf('\n')
      text = firstNewline >= 0 ? text.slice(firstNewline + 1) : ''
    }
    return { text, bytesRead }
  } finally {
    await handle.close()
  }
}

function normalizeLineLimit(value) {
  if (value === undefined || value === null) return DEFAULT_LINES
  if (!Number.isInteger(value) || value < 1 || value > MAX_LINES) {
    throw logError('EUSAGE', `--lines must be an integer between 1 and ${MAX_LINES}`, 2)
  }
  return value
}

function logError(code, message, exitCode = 1) {
  const error = new Error(message)
  error.code = code
  error.exitCode = exitCode
  return error
}
