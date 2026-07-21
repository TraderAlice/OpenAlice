import { createPump } from '../core/pump.js'
import {
  appendOutcomeOnce,
  ExecutionOutcomeValidationError,
  executionEventToOutcome,
  readExecutionEvents,
  type ExecutionOutcomeImportOptions,
  type ExecutionOutcomeImportResult,
} from '../domain/mt5/execution-outcomes.js'

export interface JmbMt5OutcomeImporter {
  start(): Promise<void>
  stop(): void
  runNow(): Promise<void>
}

function fileErrorCode(error: unknown): string | null {
  return typeof error === 'object' && error !== null && 'code' in error ? String(error.code) : null
}

async function importInstrument(
  options: ExecutionOutcomeImportOptions,
  instrument: ExecutionOutcomeImportOptions['instruments'][number],
): Promise<ExecutionOutcomeImportResult> {
  if (instrument.symbol !== 'XAUUSD') {
    return {
      broker: instrument.broker,
      symbol: 'XAUUSD',
      state: 'blocked',
      imported: 0,
      detail: 'Only XAUUSD demo execution outcomes are eligible for learning import.',
    }
  }
  const expectedServer = instrument.broker === 'hfmarkets' ? 'HFMarketsGlobal-Demo4' : 'ICMarketsSC-Demo'
  if (instrument.server !== expectedServer) {
    return {
      broker: instrument.broker,
      symbol: 'XAUUSD',
      state: 'blocked',
      imported: 0,
      detail: 'The configured demo server does not match the broker allowlist.',
    }
  }

  try {
    const events = await readExecutionEvents(options.executionRoot, instrument.broker, 'XAUUSD')
    const outcomes = events.flatMap((event) => {
      if (event.broker !== instrument.broker || event.server !== instrument.server) {
        throw new ExecutionOutcomeValidationError('Execution event identity does not match the configured instrument.')
      }
      const outcome = executionEventToOutcome(event)
      return outcome === null ? [] : [outcome]
    })

    let imported = 0
    for (const outcome of outcomes) {
      if (await appendOutcomeOnce(options.learningRoot, outcome)) imported += 1
    }
    return {
      broker: instrument.broker,
      symbol: 'XAUUSD',
      state: imported > 0 ? 'imported' : 'no_new_outcome',
      imported,
      detail: imported > 0
        ? `Imported ${imported} reconciled demo execution outcome${imported === 1 ? '' : 's'}.`
        : 'No new reconciled terminal demo execution outcome is available.',
    }
  } catch (error) {
    if (fileErrorCode(error) === 'ENOENT') {
      return {
        broker: instrument.broker,
        symbol: 'XAUUSD',
        state: 'no_new_outcome',
        imported: 0,
        detail: 'No demo execution event journal is available.',
      }
    }
    const blocked = error instanceof ExecutionOutcomeValidationError
    return {
      broker: instrument.broker,
      symbol: 'XAUUSD',
      state: blocked ? 'blocked' : 'error',
      imported: 0,
      detail: blocked
        ? `The demo execution journal failed strict validation: ${error.message}`
        : 'The demo execution outcome import failed at its isolated broker boundary.',
    }
  }
}

export async function importReconciledExecutionOutcomes(
  options: ExecutionOutcomeImportOptions,
): Promise<ExecutionOutcomeImportResult[]> {
  return Promise.all(options.instruments.map((instrument) => importInstrument(options, instrument)))
}

export function createJmbMt5OutcomeImporter(options: {
  runCycle: () => Promise<ExecutionOutcomeImportResult[]>
  every?: string
}): JmbMt5OutcomeImporter {
  const pump = createPump({
    name: 'jmb-mt5-outcome-import',
    every: options.every ?? '5m',
    serial: true,
    onTick: async () => { await options.runCycle() },
  })
  return {
    async start() { await pump.runNow(); pump.start() },
    stop() { pump.stop() },
    runNow() { return pump.runNow() },
  }
}
