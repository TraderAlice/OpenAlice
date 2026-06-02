/**
 * CLI command map — the public `alice <group> <verb>` surface.
 *
 * This map IS the CLI's contract, deliberately decoupled from internal tool
 * names: a verb like `news grep` maps to the `grepNews` tool here, so internal
 * renames don't break the CLI and vice-versa. Adding a row makes the command
 * reachable in every workspace with zero client change — the `alice` client is
 * manifest-driven, and the gateway only lets the CLI invoke tools listed here.
 *
 * Deferred on purpose (NOT exposed via the CLI yet, still reachable via MCP):
 *   - `trading`: irreversible broker mutations. Exposing them on a brand-new
 *     surface needs its own boundary review (AI <-> human boundary discipline),
 *     not a default-on.
 *   - `cron`: mutates schedules; same reasoning.
 */
export const CLI_COMMANDS: Record<string, Record<string, string>> = {
  news: {
    glob: 'globNews',
    grep: 'grepNews',
    read: 'readNews',
  },
  market: {
    search: 'marketSearchForResearch',
  },
  equity: {
    profile: 'equityGetProfile',
    financials: 'equityGetFinancials',
    ratios: 'equityGetRatios',
    earnings: 'equityGetEarningsCalendar',
    insiders: 'equityGetInsiderTrading',
    discover: 'equityDiscover',
  },
  economy: {
    'fred-search': 'economyFredSearch',
    'fred-series': 'economyFredSeries',
    'fred-regional': 'economyFredRegional',
    'bls-search': 'economyBlsSearch',
    'bls-series': 'economyBlsSeries',
    energy: 'economyEnergyOutlook',
    petroleum: 'economyPetroleumStatus',
  },
  analysis: {
    indicator: 'calculateIndicator',
  },
  think: {
    calc: 'calculate',
  },
}

/** Every tool name the CLI map references — for invoke gating + anti-rot tests. */
export function mappedToolNames(): Set<string> {
  const names = new Set<string>()
  for (const verbs of Object.values(CLI_COMMANDS)) {
    for (const toolName of Object.values(verbs)) names.add(toolName)
  }
  return names
}

/** Resolve a (group, verb) pair to its underlying tool name, or null. */
export function resolveCommand(group: string, verb: string): string | null {
  return CLI_COMMANDS[group]?.[verb] ?? null
}
