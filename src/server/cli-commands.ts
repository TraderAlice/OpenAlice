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
 *   - `traderhub`       (key `traderhub`) → global ToolCenter — LOW-FREQUENCY
 *                                            market data via the TraderHub-first
 *                                            client chain (boards, fundamentals,
 *                                            macro series, calendars). Named after
 *                                            the hosted hub so the binary name IS
 *                                            the domain name.
 *   - `alice-uta`       (key `uta`)       → global ToolCenter — TRADING (accounts,
 *                                            portfolio, orders, trading-as-git approval
 *                                            flow). Boundary-reviewed 2026-06-11: broker
 *                                            mutations are deliberate product surface
 *                                            (users want agent trading); cron stays
 *                                            MCP-only — no scheduling from the CLI.
 *
 * The (group, verb) → internal-tool-name map IS each export's contract,
 * deliberately decoupled from internal tool names: a verb like `rss grep` maps
 * to `grepRss`, so internal renames don't break the CLI and vice-versa. Adding
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
      // `rss`, not `news`: the backing store is the RSS collector's archive —
      // only what the user's subscribed feeds pulled. Naming it "news" baited
      // agents into treating it as general news search; the group name should
      // say what the data actually is.
      rss: {
        glob: 'globRss',
        grep: 'grepRss',
        read: 'readRss',
      },
      market: {
        search: 'marketSearchForResearch',
      },
      analysis: {
        'search-bars': 'searchBars',
        quant: 'calculateQuant',
      },
      think: {
        calc: 'calculate',
      },
    },
  },
  traderhub: {
    binary: 'traderhub',
    scope: 'global',
    description: 'Low-frequency market data — boards, fundamentals, macro, calendars (TraderHub-first)',
    commands: {
      board: {
        get: 'marketGetBoard',
        rotation: 'sectorRotation',
      },
      equity: {
        profile: 'equityGetProfile',
        financials: 'equityGetFinancials',
        ratios: 'equityGetRatios',
        earnings: 'equityGetEarningsCalendar',
        insiders: 'equityGetInsiderTrading',
        'short-interest': 'equityGetShortInterest',
        estimates: 'equityGetEstimates',
        discover: 'equityDiscover',
      },
      etf: {
        search: 'etfSearch',
        info: 'etfGetInfo',
        holdings: 'etfGetHoldings',
        sectors: 'etfGetSectors',
      },
      economy: {
        'fred-search': 'economyFredSearch',
        'fred-series': 'economyFredSeries',
        'fred-regional': 'economyFredRegional',
        'bls-search': 'economyBlsSearch',
        'bls-series': 'economyBlsSeries',
        energy: 'economyEnergyOutlook',
        petroleum: 'economyPetroleumStatus',
        'euro-bop': 'economyEuroAreaBop',
      },
      global: {
        cpi: 'economyCountryCpi',
        rates: 'economyCountryRates',
        leading: 'economyLeadingIndicator',
        retail: 'economyCountryRetail',
        house: 'economyCountryHousePrices',
        share: 'economyCountrySharePrices',
      },
      shipping: {
        'port-search': 'economyPortSearch',
        'port-volume': 'economyPortVolume',
        chokepoint: 'economyChokepointVolume',
      },
      fed: {
        documents: 'economyFomcDocuments',
        'balance-sheet': 'economyFedBalanceSheet',
        dealers: 'economyDealerPositioning',
      },
      crypto: {
        options: 'cryptoOptionsChains',
        futures: 'cryptoFuturesInstruments',
      },
      index: {
        search: 'indexSearch',
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
  uta: {
    binary: 'alice-uta',
    scope: 'global',
    description: 'Trading — accounts, portfolio, orders, and the trading-as-git approval flow',
    commands: {
      account: {
        list: 'listUTAs',
        info: 'getAccount',
        portfolio: 'getPortfolio',
      },
      contract: {
        search: 'searchContracts',
        details: 'getContractDetails',
        quote: 'getQuote',
      },
      order: {
        list: 'getOrders',
        place: 'placeOrder',
        modify: 'modifyOrder',
        cancel: 'cancelOrder',
      },
      position: {
        close: 'closePosition',
      },
      // trading-as-git: the approval/state flow mirrors git verbs on purpose.
      git: {
        status: 'tradingStatus',
        log: 'tradingLog',
        show: 'tradingShow',
        commit: 'tradingCommit',
        push: 'tradingPush',
        sync: 'tradingSync',
      },
      market: {
        clock: 'getMarketClock',
      },
      // MockBroker simulator only — no-op against real brokers.
      sim: {
        'price-change': 'simulatePriceChange',
      },
    },
  },
  // cron: deliberately NOT exported — scheduling stays MCP-only.
}

/**
 * Map a PATH binary name to its export key. `alice` → `data`; `alice-<x>` →
 * `<x>`; any other bare name (e.g. `traderhub`) is its own key. Mirrored in
 * the shim (bin/alice).
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
