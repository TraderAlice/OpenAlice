import type { RuntimeColorWorklist, ThemeColorScenario } from './types.js'
import { themeColorScenarios } from './scenarios.js'

export function assertScenarioPath(scenarioId: string, route: string, actualUrl: string): void {
  const expectedPath = new URL(route, 'http://openalice.audit').pathname
  const actualPath = new URL(actualUrl).pathname
  if (actualPath !== expectedPath) throw new Error(`${scenarioId}: redirected to ${actualUrl}`)
}

export function validateScenarioCoverage(worklist: RuntimeColorWorklist, scenarios: readonly ThemeColorScenario[] = themeColorScenarios): void {
  const expected = new Set(worklist.items.map((item) => item.inventoryId))
  const seenScenarios = new Set<string>()
  const assigned = new Map<string, string[]>()
  for (const scenario of scenarios) {
    if (seenScenarios.has(scenario.scenarioId)) throw new Error(`duplicate scenario ID: ${scenario.scenarioId}`)
    seenScenarios.add(scenario.scenarioId)
    if (scenario.inventoryIds.length === 0) throw new Error(`${scenario.scenarioId}: inventoryIds is empty`)
    if (!scenario.route.startsWith('/')) throw new Error(`${scenario.scenarioId}: route must be absolute`)
    if (scenario.state !== 'normal' && (scenario.stateDriver ?? 'action') === 'action' && scenario.actions.length === 0) throw new Error(`${scenario.scenarioId}: state ${scenario.state} requires a user action`)
    for (const inventoryId of scenario.inventoryIds) {
      if (!expected.has(inventoryId)) throw new Error(`${scenario.scenarioId}: unknown or stale inventory ID ${inventoryId}`)
      const owners = assigned.get(inventoryId) ?? []; owners.push(scenario.scenarioId); assigned.set(inventoryId, owners)
    }
  }
  const missing = [...expected].filter((inventoryId) => !assigned.has(inventoryId))
  if (missing.length > 0) throw new Error(`runtime work items without scenarios (${missing.length}):\n${missing.join('\n')}`)
}
