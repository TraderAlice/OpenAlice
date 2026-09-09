import { readFile, realpath } from 'node:fs/promises'
import { homedir } from 'node:os'
import { join, resolve } from 'node:path'
import { isJsonObject, type JsonObject } from './model.js'

/** Read the active parent chain from Claude's own session file, never a cache. */
export async function readClaudeHistory(cwd: string, sessionId: string, env: Readonly<Record<string, string>>): Promise<JsonObject[]> {
  if (!/^[0-9a-f]{8}(?:-[0-9a-f]{4}){3}-[0-9a-f]{12}$/i.test(sessionId)) {
    throw new Error('Claude requires a valid native session id')
  }
  const config = env['CLAUDE_CONFIG_DIR'] || join(env['HOME'] || homedir(), '.claude')
  const canonical = await realpath(cwd)
  for (const directory of new Set([canonical, resolve(cwd)])) {
    const key = directory.replaceAll('/', '-').replaceAll('.', '-')
    try {
      return selectClaudeHistory(await readFile(join(config, 'projects', key, `${sessionId}.jsonl`), 'utf8'))
    } catch (error) {
      if ((error as NodeJS.ErrnoException).code !== 'ENOENT') throw error
    }
  }
  throw new Error('Claude session history was not found for this workspace. Open the original Session in the terminal to check its location.')
}

export function selectClaudeHistory(raw: string): JsonObject[] {
  const records = new Map<string, JsonObject>()
  let leaf: string | undefined
  for (const line of raw.split('\n')) {
    let value: unknown
    try { value = JSON.parse(line) } catch { continue } // A writer may leave a partial final line.
    if (!isJsonObject(value) || value['isSidechain'] === true || typeof value['uuid'] !== 'string') continue
    records.set(value['uuid'], value)
    if (value['type'] === 'user' || value['type'] === 'assistant') leaf = value['uuid']
  }
  const chain: JsonObject[] = []
  const visited = new Set<string>()
  while (leaf && !visited.has(leaf)) {
    visited.add(leaf)
    const entry = records.get(leaf)
    if (!entry) break
    if ((entry['type'] === 'user' || entry['type'] === 'assistant') && isJsonObject(entry['message'])) chain.push(entry)
    leaf = typeof entry['parentUuid'] === 'string' ? entry['parentUuid'] : undefined
  }
  return chain.reverse()
}
