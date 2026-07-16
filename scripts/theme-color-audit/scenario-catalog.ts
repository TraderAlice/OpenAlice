import type { StaticColorManifest, ThemeColorScenario } from './types.js'
import { globalColorSourcePaths, themeColorScenarios } from './scenarios.js'

export interface ResolvedScenario extends ThemeColorScenario {
  readonly inventoryIds: readonly string[]
}

export function validateScenarioCatalog(scenarios: readonly ThemeColorScenario[] = themeColorScenarios): void {
  const ids = new Set<string>()
  for (const scenario of scenarios) {
    if (ids.has(scenario.scenarioId)) throw new Error(`duplicate scenario ID: ${scenario.scenarioId}`)
    ids.add(scenario.scenarioId)
    if (!scenario.route.startsWith('/')) throw new Error(`${scenario.scenarioId}: route must be absolute`)
    if (scenario.themes.length === 0) throw new Error(`${scenario.scenarioId}: theme matrix is empty`)
    if (scenario.sourcePaths.length === 0) throw new Error(`${scenario.scenarioId}: source coverage is empty`)
  }
}

export function resolveScenarioCoverage(
  manifest: StaticColorManifest,
  scenarios: readonly ThemeColorScenario[] = themeColorScenarios,
  globalPathsInput: readonly string[] = globalColorSourcePaths,
): readonly ResolvedScenario[] {
  validateScenarioCatalog(scenarios)
  const runtime = manifest.occurrences.filter((entry) => entry.sourceClass === 'runtime')
  const knownPaths = new Set(runtime.map((entry) => entry.path))
  const globalPaths = new Set<string>(globalPathsInput)
  const coveredPaths = new Set<string>(globalPaths)
  for (const scenario of scenarios) {
    for (const path of scenario.sourcePaths) {
      if (!knownPaths.has(path)) throw new Error(`${scenario.scenarioId}: source path has no runtime occurrences: ${path}`)
      coveredPaths.add(path)
    }
  }
  const missing = [...knownPaths].filter((path) => !coveredPaths.has(path)).sort()
  if (missing.length > 0) throw new Error(`runtime source paths without scenarios:\n${missing.join('\n')}`)

  return scenarios.map((scenario) => ({
    ...scenario,
    inventoryIds: runtime
      .filter((entry) => globalPaths.has(entry.path) || scenario.sourcePaths.includes(entry.path))
      .map((entry) => entry.inventoryId),
  }))
}
