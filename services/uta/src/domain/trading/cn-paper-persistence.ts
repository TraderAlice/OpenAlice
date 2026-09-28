/**
 * CN Local Paper book persistence — load/save runtime cash, positions, T+1.
 *
 * Sibling of git-persistence.ts: lives under data/trading/<accountId>/.
 */

import { readFile, writeFile, mkdir } from 'fs/promises'
import { dirname } from 'path'
import { dataPath } from '@/core/paths.js'
import {
  parseCnPaperBookState,
  type CnPaperBookState,
} from './brokers/mock/cn-paper-book.js'

function bookFilePath(accountId: string): string {
  return dataPath('trading', accountId, 'cn-paper-book.json')
}

/** Read saved CN paper book, or undefined when missing / unreadable. */
export async function loadCnPaperBook(accountId: string): Promise<CnPaperBookState | undefined> {
  const filePath = bookFilePath(accountId)
  try {
    const raw = JSON.parse(await readFile(filePath, 'utf-8')) as unknown
    return parseCnPaperBookState(raw)
  } catch {
    return undefined
  }
}

/** Persist callback fired after CN paper book mutations. */
export function createCnPaperBookPersister(
  accountId: string,
): (state: CnPaperBookState) => Promise<void> {
  const filePath = bookFilePath(accountId)
  return async (state: CnPaperBookState) => {
    await mkdir(dirname(filePath), { recursive: true })
    await writeFile(filePath, JSON.stringify(state, null, 2))
  }
}

export { bookFilePath as cnPaperBookFilePath }
