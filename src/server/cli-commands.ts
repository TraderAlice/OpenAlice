/**
 * CLI export registry — the public `alice* <group> <verb>` surface, split into
 * independently-exported binaries by tool CATEGORY.
 *
 * Each export is one PATH binary (the shim self-detects which via argv[0]) over
 * one tool-center scope:
 *   - `alice`           (key `data`)      → global ToolCenter — market/research
 *                                            DATA sources (finance-domain; swapped
 *                                            out when the workspace's domain changes).
 *   - `alice-workspace` (key `workspace`) → WorkspaceToolCenter — AGENT
 *                                            COLLABORATION (inbox push + entity
 *                                            tracking); scoped per workspace,
 *                                            launcher-universal (survives a domain swap).
 *   - `alice-uta`       (key `uta`)       → RESERVED. trading/cron live here once
 *                                            the AI<->human boundary review greenlights
 *                                            irreversible broker mutations. Not exposed yet.
 *
 * The (group, verb) → internal-tool-name map IS each export's contract,
 * deliberately decoupled from internal tool names: a verb like `news grep` maps
 * to `grepNews`, so internal renames don't break the CLI and vice-versa. Adding
 * a row makes the command reachable in every workspace with zero client change —
 * the `alice*` client is manifest-driven, and the gateway only lets an export
 * invoke tools listed in ITS map.
 */

export interface CliExport {
  /** PATH binary name. The shim is one file; siblings are byte-identical copies. */
  readonly binary: string
  /** Which registry backs this export — global catalog vs per-workspace scoped. */
  readonly scope: 'global' | 'scoped'
  readonly description: string
  /** group -> verb -> internal tool name. */
  readonly commands: Record<string, Record<string, string>>
}

export const CLI_EXPORTS: Record<string, CliExport> = {
  data: {
    binary: 'alice',
    scope: 'global',
    description: 'Market & research data sources',
    commands: {
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
    },
  },
  workspace: {
    binary: 'alice-workspace',
    scope: 'scoped',
    description: 'Agent collaboration — push to the user inbox, track entities',
    commands: {
      // inbox push: surface a doc + comment to the user's Inbox tab. v1 is
      // comment-only via the CLI (`--comments`); the `docs` array param needs
      // structured-arg support in the client (a flat flag can't carry it).
      inbox: {
        push: 'inbox_push',
      },
      // track: the durable cross-workspace tracked-entity index ([[name]]).
      track: {
        add: 'entity_upsert',
        search: 'entity_search',
      },
    },
  },
  // uta: reserved — see header. Intentionally absent until boundary review.
}

/**
 * Map a PATH binary name to its export key. `alice` → `data`; `alice-<x>` → `<x>`
 * (e.g. `alice-workspace` → `workspace`). Mirrored in the shim (bin/alice).
 */
export function exportKeyForBinary(binary: string): string {
  return binary === 'alice' ? 'data' : binary.replace(/^alice-/, '')
}

/** The export descriptor for a key, or null. */
export function getExport(key: string): CliExport | null {
  return CLI_EXPORTS[key] ?? null
}

/** Every internal tool name ONE export references — for invoke gating + anti-rot tests. */
export function mappedToolNames(exportKey: string): Set<string> {
  const names = new Set<string>()
  const exp = CLI_EXPORTS[exportKey]
  if (!exp) return names
  for (const verbs of Object.values(exp.commands)) {
    for (const toolName of Object.values(verbs)) names.add(toolName)
  }
  return names
}

/** Resolve an (export, group, verb) triple to its underlying tool name, or null. */
export function resolveCommand(exportKey: string, group: string, verb: string): string | null {
  return CLI_EXPORTS[exportKey]?.commands[group]?.[verb] ?? null
}
