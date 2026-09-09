import { mkdtemp, mkdir, writeFile, rm } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { afterEach, expect, it } from 'vitest'
import { readClaudeHistory, selectClaudeHistory } from './claude-history.js'
const roots: string[] = []
afterEach(async () => { await Promise.all(roots.splice(0).map((root) => rm(root, { recursive: true, force: true }))) })
const entry = (uuid: string, parentUuid: string | null, type: string, extra = {}) => ({ uuid, parentUuid, type, message: { role: type, content: uuid }, ...extra })
it('replays the latest main chain across attachments without abandoned branches or sidechains', () => {
  const values = [entry('u', null, 'user'), entry('old', 'u', 'assistant'), entry('attachment', 'u', 'attachment'), entry('new', 'attachment', 'assistant'), entry('side', 'new', 'assistant', { isSidechain: true })]
  expect(selectClaudeHistory(values.map((v) => JSON.stringify(v)).join('\n') + '\n{"partial":')).toEqual([values[0], values[3]])
})
it('bounds malformed parent cycles', () => {
  expect(selectClaudeHistory([entry('a', 'b', 'user'), entry('b', 'a', 'assistant')].map((v) => JSON.stringify(v)).join('\n'))).toHaveLength(2)
})
it('reads only the requested session under the configured native directory', async () => {
  const root = await mkdtemp(join(tmpdir(), 'claude-history-')); roots.push(root)
  const cwd = join(root, 'workspace'); await mkdir(cwd)
  const config = join(root, 'config')
  const { realpath } = await import('node:fs/promises')
  const key = (await realpath(cwd)).replaceAll('/', '-').replaceAll('.', '-')
  const dir = join(config, 'projects', key); await mkdir(dir, { recursive: true })
  const id = '11111111-1111-4111-8111-111111111111'
  const record = entry('a', null, 'user')
  await writeFile(join(dir, `${id}.jsonl`), JSON.stringify(record))
  expect(await readClaudeHistory(cwd, id, { CLAUDE_CONFIG_DIR: config })).toEqual([record])
  await expect(readClaudeHistory(cwd, '../other', { CLAUDE_CONFIG_DIR: config })).rejects.toThrow('valid native session id')
  await expect(readClaudeHistory(cwd, '22222222-2222-4222-8222-222222222222', { CLAUDE_CONFIG_DIR: config })).rejects.toThrow('not found')
})
