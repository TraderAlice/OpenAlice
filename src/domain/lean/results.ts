import type {
  BacktestRequest,
  BacktestResult,
  ChartPoint,
  ChartSeries,
  ClosedTrade,
  LeanOrder,
  LeanRuntimeStatistics,
  LeanStatistics
} from "./types.js";

export function parsePercent(val: unknown): number {
  if (typeof val === "number") {
    return Math.abs(val) <= 1 ? val : val / 100;
  }
  if (typeof val !== "string") return 0;
  const cleaned = val.replace(/%/g, "").trim();
  const num = parseFloat(cleaned);
  return isNaN(num) ? 0 : num / 100;
}

export function parseCurrency(val: unknown): number {
  if (typeof val === "number") return val;
  if (typeof val !== "string") return 0;
  const cleaned = val.replace(/[$,\s]/g, "").trim();
  const num = parseFloat(cleaned);
  return isNaN(num) ? 0 : num;
}

export function parseNumber(val: unknown, fallback = 0): number {
  if (typeof val === "number") return val;
  if (typeof val !== "string") return fallback;
  const cleaned = val.replace(/,/g, "").trim();
  const num = parseFloat(cleaned);
  return isNaN(num) ? fallback : num;
}

/**
 * Ratio values from the engine JSON (e.g. `"winRate": "0.6"`). Accepts both
 * fraction strings ("0.6") and percent strings ("60%", "60") and normalizes
 * them to a 0..1 fraction.
 */
export function parseRatio(val: unknown): number {
  if (typeof val === "number") {
    return Math.abs(val) <= 1 ? val : val / 100;
  }
  if (typeof val !== "string") return 0;
  const cleaned = val.replace(/%/g, "").trim();
  const num = parseFloat(cleaned);
  if (isNaN(num)) return 0;
  return Math.abs(num) <= 1 ? num : num / 100;
}

/** First value among the candidate keys that is defined and non-null. */
function pick(src: Record<string, unknown>, keys: string[]): unknown {
  for (const key of keys) {
    const value = src[key];
    if (value !== undefined && value !== null) return value;
  }
  return undefined;
}

function asRecord(value: unknown): Record<string, any> {
  return value && typeof value === "object" && !Array.isArray(value) ? (value as Record<string, any>) : {};
}

function symbolOf(o: any): string {
  const sym = o?.Symbol ?? o?.symbol ?? "";
  if (typeof sym === "string") return sym;
  return String(sym?.Value ?? sym?.value ?? sym?.permtick ?? "");
}

export function parseLeanResults(
  rawInput: string | Record<string, unknown>,
  backtestId: string,
  request: BacktestRequest,
  extra: { startedAt?: string; completedAt?: string; exitCode?: number; logs?: string } = {}
): BacktestResult {
  let raw: Record<string, any>;
  try {
    raw = typeof rawInput === "string" ? JSON.parse(rawInput) : rawInput;
    if (!raw || typeof raw !== "object") {
      throw new Error("Invalid root JSON structure");
    }
  } catch (err: any) {
    return {
      id: backtestId,
      request,
      status: "failed",
      startedAt: extra.startedAt ?? new Date().toISOString(),
      completedAt: extra.completedAt ?? new Date().toISOString(),
      exitCode: extra.exitCode ?? -1,
      logs: extra.logs,
      error: `Failed to parse LEAN results JSON: ${err.message}`,
      charts: {},
      orders: [],
      closedTrades: []
    };
  }

  // Classic LEAN output uses PascalCase keys; current LEAN engine output uses
  // lowerCamelCase for the same data. Both shapes are accepted here.
  const rawRoot = asRecord(raw);
  const rawStats: Record<string, string> = asRecord(pick(rawRoot, ["Statistics", "statistics"]));
  const rawRuntime: Record<string, string> = asRecord(pick(rawRoot, ["RuntimeStatistics", "runtimeStatistics"]));
  const totalPerf = asRecord(pick(rawRoot, ["TotalPerformance", "totalPerformance"]));
  const tradeStats = asRecord(pick(totalPerf, ["TradeStatistics", "tradeStatistics"]));
  const portStats = asRecord(pick(totalPerf, ["PortfolioStatistics", "portfolioStatistics"]));

  const statistics: LeanStatistics = {
    totalTrades:
      parseNumber(pick(tradeStats, ["TotalNumberOfTrades", "totalNumberOfTrades"]), 0) ||
      (parseInt(rawStats["Total Trades"] ?? "0", 10) || 0),
    winningTrades: parseNumber(pick(tradeStats, ["NumberOfWinningTrades", "numberOfWinningTrades"]), 0),
    losingTrades: parseNumber(pick(tradeStats, ["NumberOfLosingTrades", "numberOfLosingTrades"]), 0),
    winRate:
      parseRatio(pick(tradeStats, ["WinRate", "winRate"])) || parsePercent(rawStats["Win Rate"]),
    lossRate:
      parseRatio(pick(tradeStats, ["LossRate", "lossRate"])) || parsePercent(rawStats["Loss Rate"]),
    averageWin:
      parseRatio(pick(tradeStats, ["AverageWin", "averageWin"])) || parsePercent(rawStats["Average Win"]),
    averageLoss:
      parseRatio(pick(tradeStats, ["AverageLoss", "averageLoss"])) || parsePercent(rawStats["Average Loss"]),
    profitLossRatio:
      parseNumber(pick(tradeStats, ["WinLossRatio", "winLossRatio", "ProfitLossRatio", "profitLossRatio"])) ||
      parseNumber(rawStats["Profit-Loss Ratio"]),
    compoundingAnnualReturn:
      parseRatio(pick(portStats, ["CompoundingAnnualReturn", "compoundingAnnualReturn"])) ||
      parsePercent(rawStats["Compounding Annual Return"]),
    drawdown:
      parseRatio(pick(portStats, ["Drawdown", "drawdown"])) || parsePercent(rawStats["Drawdown"]),
    netProfit:
      parseCurrency(pick(tradeStats, ["TotalProfitLoss", "totalProfitLoss"])) ||
      parseCurrency(pick(portStats, ["TotalNetProfit", "totalNetProfit"])) ||
      parseCurrency(rawStats["Net Profit"]),
    sharpeRatio:
      parseNumber(pick(portStats, ["SharpeRatio", "sharpeRatio"])) || parseNumber(rawStats["Sharpe Ratio"]),
    sortinoRatio:
      parseNumber(pick(portStats, ["SortinoRatio", "sortinoRatio"])) || parseNumber(rawStats["Sortino Ratio"]),
    probabilisticSharpeRatio:
      parseRatio(pick(portStats, ["ProbabilisticSharpeRatio", "probabilisticSharpeRatio"])) ||
      parsePercent(rawStats["Probabilistic Sharpe Ratio"]),
    expectancy:
      parseNumber(pick(portStats, ["Expectancy", "expectancy"])) || parseNumber(rawStats["Expectancy"]),
    totalFees:
      parseCurrency(pick(tradeStats, ["TotalFees", "totalFees"])) ||
      parseCurrency(pick(portStats, ["TotalFees", "totalFees"])) ||
      parseCurrency(rawStats["Total Fees"]),
    alpha: parseNumber(pick(portStats, ["Alpha", "alpha"])) || parseNumber(rawStats["Alpha"]),
    beta: parseNumber(pick(portStats, ["Beta", "beta"])) || parseNumber(rawStats["Beta"]),
    annualStandardDeviation:
      parseNumber(pick(portStats, ["AnnualStandardDeviation", "annualStandardDeviation"])) ||
      parseNumber(rawStats["Annual Standard Deviation"]),
    annualVariance:
      parseNumber(pick(portStats, ["AnnualVariance", "annualVariance"])) || parseNumber(rawStats["Annual Variance"]),
    informationRatio:
      parseNumber(pick(portStats, ["InformationRatio", "informationRatio"])) || parseNumber(rawStats["Information Ratio"]),
    trackingError:
      parseNumber(pick(portStats, ["TrackingError", "trackingError"])) || parseNumber(rawStats["Tracking Error"]),
    raw: rawStats
  };

  const runtimeStatistics: LeanRuntimeStatistics = {
    equity: parseCurrency(rawRuntime["Equity"]),
    fees: parseCurrency(rawRuntime["Fees"]),
    holdings: parseCurrency(rawRuntime["Holdings"]),
    netProfit: parseCurrency(rawRuntime["Net Profit"]),
    returnPct: parsePercent(rawRuntime["Return"]),
    unrealized: parseCurrency(rawRuntime["Unrealized"]),
    volume: parseCurrency(rawRuntime["Volume"]),
    raw: rawRuntime
  };

  const charts: Record<string, ChartSeries> = {};
  const rawCharts = asRecord(pick(rawRoot, ["Charts", "charts"]));
  for (const [chartName, chartData] of Object.entries<any>(rawCharts)) {
    const series = asRecord(pick(asRecord(chartData), ["Series", "series"]));
    for (const [seriesName, sData] of Object.entries<any>(series)) {
      const key = chartName === seriesName ? chartName : `${chartName} - ${seriesName}`;
      const values: ChartPoint[] = [];
      const rawValues = pick(asRecord(sData), ["Values", "values"]);
      if (Array.isArray(rawValues)) {
        for (const pt of rawValues) {
          if (Array.isArray(pt)) {
            values.push({ x: pt[0] ?? 0, y: pt[1] ?? 0 });
          } else if (pt && typeof pt === "object") {
            values.push({ x: pt.x ?? pt.Time ?? 0, y: pt.y ?? pt.Value ?? 0 });
          }
        }
      }
      charts[key] = {
        name: sData?.Name ?? sData?.name ?? seriesName,
        unit: sData?.Unit ?? sData?.unit ?? "",
        values
      };
    }
  }

  const orders: LeanOrder[] = [];
  const rawOrders = pick(rawRoot, ["Orders", "orders"]);
  if (rawOrders && typeof rawOrders === "object") {
    const orderEntries = Array.isArray(rawOrders) ? rawOrders : Object.values(rawOrders);
    for (const o of orderEntries as any[]) {
      if (!o) continue;
      const dirMap = ["Buy", "Sell", "Hold"];
      const typeMap = ["Market", "Limit", "StopMarket", "StopLimit"];
      const statusMap: Record<number, string> = {
        0: "New",
        1: "Submitted",
        2: "PartiallyFilled",
        3: "Filled",
        5: "Canceled",
        6: "Invalid"
      };

      const direction = o.Direction ?? o.direction;
      const type = o.Type ?? o.type;
      const status = o.Status ?? o.status;
      orders.push({
        id: parseNumber(o.Id ?? o.id, 0),
        symbol: symbolOf(o),
        price: parseNumber(o.Price ?? o.price, 0),
        quantity: parseNumber(o.Quantity ?? o.quantity, 0),
        direction:
          (typeof direction === "number" ? dirMap[direction] ?? "Buy" : direction ?? "Buy") as any,
        type: (typeof type === "number" ? typeMap[type] ?? "Market" : type ?? "Market") as any,
        status:
          (typeof status === "number" ? statusMap[status] ?? (status === 3 ? "Filled" : "Other") : status ?? "Filled") as any,
        time: o.Time ?? o.time ?? o.CreatedTime ?? o.createdTime ?? "",
        createdTime: o.CreatedTime ?? o.createdTime,
        lastFillTime: o.LastFillTime ?? o.lastFillTime,
        tag: o.Tag ?? o.tag ?? "",
        fee: parseNumber(o.OrderFee?.Value?.Amount ?? o.orderFee?.value?.amount, 0),
        feeCurrency: o.OrderFee?.Value?.Currency ?? o.orderFee?.value?.currency ?? "USD",
        value: parseNumber(o.Value ?? o.value, 0)
      });
    }
  }

  const closedTrades: ClosedTrade[] = [];
  const rawClosedTrades =
    pick(totalPerf, ["ClosedTrades", "closedTrades"]) ?? pick(rawRoot, ["ClosedTrades", "closedTrades"]) ?? [];
  if (Array.isArray(rawClosedTrades)) {
    for (const t of rawClosedTrades) {
      closedTrades.push({
        symbol: symbolOf(t),
        entryTime: t.EntryTime ?? t.entryTime ?? "",
        entryPrice: parseNumber(t.EntryPrice ?? t.entryPrice, 0),
        exitTime: t.ExitTime ?? t.exitTime ?? "",
        exitPrice: parseNumber(t.ExitPrice ?? t.exitPrice, 0),
        quantity: parseNumber(t.Quantity ?? t.quantity, 0),
        profitLoss: parseNumber(t.ProfitLoss ?? t.profitLoss, 0),
        totalFees: parseNumber(t.TotalFees ?? t.totalFees, 0),
        mae: parseNumber(t.MAE ?? t.mae, 0),
        mfe: parseNumber(t.MFE ?? t.mfe, 0),
        duration: t.Duration ?? t.duration ?? ""
      });
    }
  }

  const durationMs =
    extra.startedAt && extra.completedAt
      ? new Date(extra.completedAt).getTime() - new Date(extra.startedAt).getTime()
      : undefined;

  return {
    id: backtestId,
    request,
    status: extra.exitCode === 0 || extra.exitCode === undefined ? "completed" : "failed",
    startedAt: extra.startedAt ?? new Date().toISOString(),
    completedAt: extra.completedAt ?? new Date().toISOString(),
    durationMs,
    exitCode: extra.exitCode ?? 0,
    statistics,
    runtimeStatistics,
    charts,
    orders,
    closedTrades,
    logs: extra.logs
  };
}
