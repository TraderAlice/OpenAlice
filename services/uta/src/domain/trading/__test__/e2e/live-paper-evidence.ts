import { appendFile, mkdir } from 'node:fs/promises'
import { execFileSync } from 'node:child_process'
import { resolve } from 'node:path'
import type { Contract } from '@traderalice/ibkr'

export interface ContractEvidence {
  conId: number
  symbol: string
  localSymbol: string
  secType: string
  exchange: string
  primaryExchange: string
  currency: string
  tradingClass: string
  multiplier: string
}

export interface LivePaperEvidence {
  scenario: string
  phase: string
  contract?: ContractEvidence
  request?: Partial<ContractEvidence>
  result?: {
    success?: boolean
    status?: string
    error?: string
  }
  baseline?: {
    positions: number
    openOrders: number
  }
  cleanup?: {
    positions: number
    openOrders: number
    matchesBaseline: boolean
  }
  note?: string
}

const runStamp = new Date().toISOString().replaceAll(':', '-').replaceAll('.', '-')
const runId = process.env.OPENALICE_UTA_LIVE_RUN_ID || `${runStamp}-${process.pid}`

function currentCommit(): string {
  if (process.env.GITHUB_SHA) return process.env.GITHUB_SHA
  try {
    return execFileSync('git', ['rev-parse', 'HEAD'], { encoding: 'utf8' }).trim()
  } catch {
    return 'unknown'
  }
}

const gitCommit = currentCommit()

export function contractEvidence(contract: Contract): ContractEvidence {
  return {
    conId: contract.conId,
    symbol: contract.symbol,
    localSymbol: contract.localSymbol,
    secType: contract.secType,
    exchange: contract.exchange,
    primaryExchange: contract.primaryExchange,
    currency: contract.currency,
    tradingClass: contract.tradingClass,
    multiplier: contract.multiplier,
  }
}

/** Append a deliberately small, non-account live-paper record. The default
 * destination is under ignored data/; callers must not pass balances,
 * credentials, account ids, positions, or other private broker payloads. */
export async function recordLivePaperEvidence(evidence: LivePaperEvidence): Promise<string> {
  const outputDir = resolve(
    process.env.OPENALICE_UTA_LIVE_RECORD_DIR ||
      resolve(process.cwd(), 'data', 'uta-live-paper-runs'),
  )
  await mkdir(outputDir, { recursive: true })
  const outputPath = resolve(outputDir, `${runId}.jsonl`)
  await appendFile(outputPath, `${JSON.stringify({
    schemaVersion: 1,
    recordedAt: new Date().toISOString(),
    gitCommit,
    paper: true,
    broker: 'ibkr',
    ...evidence,
  })}\n`, 'utf8')
  return outputPath
}
