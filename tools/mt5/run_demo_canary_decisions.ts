import { runDemoDecisionCycle } from '../../src/domain/mt5/demo-decision-service.js'
import { resolveJmbMt5Roots } from '../../src/domain/mt5/local-paths.js'

try {
  const results = await runDemoDecisionCycle({ roots: resolveJmbMt5Roots() })
  for (const result of results) {
    console.log(`${result.broker} ${result.symbol}: ${result.state} ${result.detail}`)
  }
} catch (error) {
  console.error(error instanceof Error ? error.message : 'Demo canary decision cycle failed.')
  process.exitCode = 1
}
