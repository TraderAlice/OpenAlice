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
        // window: date-bounded, oldest-first — for aligning catalysts to a price path.
        window: 'windowRss',
        read: 'readRss',
      },
      market: {
        search: 'marketSearchForResearch',
        // Discover data sources + drive them: `vendors` lists what's available,
        // each with on/off state and a usage note (symbol convention, search
        // language); `vendor-set` flips one on/off, live on the next search.
        vendors: 'listMarketVendors',
        'vendor-set': 'setMarketVendor',
      },
      analysis: {
        'search-bars': 'searchBars',
        quant: 'calculateQuant',
        // Honest as-of read (dated bars, no-lookahead, freshness contract) + a
        // path-dependent backtest. The Retrospective / Time-Machine primitives.
        snapshot: 'marketSnapshot',
        simulate: 'simulate',
        'delta-volume': 'calculateDeltaVolume',
        'volume-profile': 'calculateVolumeProfile',
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
    description: 'Agent collaboration — push/read the user inbox, locate a peer workspace (peer path), track entities',
    commands: {
      // inbox push: surface doc(s) + comment to the user's Inbox tab. Attach
      // files with repeatable `--doc <path>` (the shim folds them into the
      // `docs: [{ path }]` array; bare paths wrap, JSON objects pass through);
      // `--comments` carries the markdown note. At least one of the two.
      // inbox read: look back at the inbox stream — `--self` narrows to this
      // workspace's own pushes (whose doc paths are cwd-relative, so readable
      // with the shell); `--limit N` caps the newest-first window.
      inbox: {
        push: 'inbox_push',
        read: 'inbox_read',
        ask: 'inbox_ask',
      },
      // peer path: resolve another workspace's absolute dir by id (the
      // `workspaceId` an inbox_read entry carries), so the agent can read/edit
      // that peer's files with native tools — cross-workspace collaboration.
      peer: {
        path: 'workspace_path',
        sessions: 'workspace_sessions',
      },
      // track: the durable cross-workspace tracked-entity index ([[name]]).
      track: {
        add: 'entity_upsert',
        search: 'entity_search',
      },
      // issue: the issue board. READS are GLOBAL — `list` scans every
      // workspace's titles, `show <name>` resolves a name across the board and
      // returns full detail (issue + runs + inbox reports). WRITES stay local —
      // create/update/comment author in the CALLER's own `.alice/issues/`
      // (editing a peer's board is the human-approved peer-edit path).
      issue: {
        update: 'issue_update',
        comment: 'issue_comment',
        create: 'issue_create',
        list: 'issue_list',
        show: 'issue_show',
        ask: 'issue_ask',
      },
      provenance: {
        show: 'provenance_show',
      },
      signature: {
        show: 'session_signature',
      },
      conversation: {
        ask: 'conversation_ask',
        await: 'conversation_await',
        collect: 'conversation_collect',
        read: 'conversation_read',
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
        expand: 'expandContract',
      },
      order: {
        list: 'getOrders',
        history: 'orderHistory',
        trades: 'tradeHistory',
        place: 'placeOrder',
        modify: 'modifyOrder',
        cancel: 'cancelOrder',
      },
      position: {
        // listing positions = `account portfolio` (one tool, one verb).
        close: 'closePosition',
      },
      // trading-as-git: the approval/state flow mirrors git verbs on purpose.
      git: {
        status: 'tradingStatus',
        log: 'tradingLog',
        show: 'tradingShow',
        commit: 'tradingCommit',
        push: 'tradingPush',
        reject: 'tradingReject',
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
