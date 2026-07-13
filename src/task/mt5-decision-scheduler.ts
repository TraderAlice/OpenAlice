import { createPump, type Pump } from '../core/pump.js'

export interface JmbMt5DecisionScheduler {
  start(): Promise<void>
  stop(): void
  runNow(): Promise<void>
}

export function createJmbMt5DecisionScheduler(options: {
  runCycle: () => Promise<unknown>
  every?: string
  logger?: Pick<Console, 'log' | 'warn' | 'error'>
}): JmbMt5DecisionScheduler {
  const pump: Pump = createPump({
    name: 'jmb-mt5-decision-cycle',
    every: options.every ?? '5m',
    serial: true,
    onTick: async () => { await options.runCycle() },
    logger: options.logger,
  })

  return {
    async start() {
      await pump.runNow()
      pump.start()
    },
    stop() {
      pump.stop()
    },
    runNow() {
      return pump.runNow()
    },
  }
}
