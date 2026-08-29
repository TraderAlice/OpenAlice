import type {
  BacktestRequest,
  BacktestResult,
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

  const rawStats: Record<string, string> = raw.Statistics ?? {};
  const rawRuntime: Record<string, string> = raw.RuntimeStatistics ?? {};
  const totalPerf = raw.TotalPerformance ?? {};
  const tradeStats = totalPerf.TradeStatistics ?? {};
  const portStats = totalPerf.PortfolioStatistics ?? {};

  const statistics: LeanStatistics = {
    totalTrades: tradeStats.TotalNumberOfTrades ?? (parseInt(rawStats["Total Trades"] ?? "0", 10) || 0),
    winningTrades: tradeStats.NumberOfWinningTrades ?? 0,
    losingTrades: tradeStats.NumberOfLosingTrades ?? 0,
    winRate: tradeStats.WinRate ?? parsePercent(rawStats["Win Rate"]),
    lossRate: tradeStats.LossRate ?? parsePercent(rawStats["Loss Rate"]),
    averageWin: tradeStats.AverageWin ?? parsePercent(rawStats["Average Win"]),
    averageLoss: tradeStats.AverageLoss ?? parsePercent(rawStats["Average Loss"]),
    profitLossRatio: tradeStats.WinLossRatio ?? parseNumber(rawStats["Profit-Loss Ratio"]),
    compoundingAnnualReturn: portStats.CompoundingAnnualReturn ?? parsePercent(rawStats["Compounding Annual Return"]),
    drawdown: portStats.Drawdown ?? parsePercent(rawStats["Drawdown"]),
    netProfit: tradeStats.TotalProfitLoss ?? parseCurrency(rawStats["Net Profit"]),
    sharpeRatio: portStats.SharpeRatio ?? parseNumber(rawStats["Sharpe Ratio"]),
    sortinoRatio: portStats.SortinoRatio ?? parseNumber(rawStats["Sortino Ratio"]),
    probabilisticSharpeRatio: portStats.ProbabilisticSharpeRatio ?? parsePercent(rawStats["Probabilistic Sharpe Ratio"]),
    expectancy: portStats.Expectancy ?? parseNumber(rawStats["Expectancy"]),
    totalFees: portStats.TotalFees ?? parseCurrency(rawStats["Total Fees"]),
    alpha: portStats.Alpha ?? parseNumber(rawStats["Alpha"]),
    beta: portStats.Beta ?? parseNumber(rawStats["Beta"]),
    annualStandardDeviation: portStats.AnnualStandardDeviation ?? parseNumber(rawStats["Annual Standard Deviation"]),
    annualVariance: portStats.AnnualVariance ?? parseNumber(rawStats["Annual Variance"]),
    informationRatio: portStats.InformationRatio ?? parseNumber(rawStats["Information Ratio"]),
    trackingError: portStats.TrackingError ?? parseNumber(rawStats["Tracking Error"]),
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
  if (raw.Charts && typeof raw.Charts === "object") {
    for (const [chartName, chartData] of Object.entries<any>(raw.Charts)) {
      if (chartData && chartData.Series && typeof chartData.Series === "object") {
        for (const [seriesName, sData] of Object.entries<any>(chartData.Series)) {
          const key = chartName === seriesName ? chartName : `${chartName} - ${seriesName}`;
          charts[key] = {
            name: sData.Name ?? seriesName,
            unit: sData.Unit ?? "",
            values: Array.isArray(sData.Values)
              ? sData.Values.map((pt: any) => ({
                  x: pt.x ?? pt.Time ?? 0,
                  y: pt.y ?? pt.Value ?? 0
                }))
              : []
          };
        }
      }
    }
  }

  const orders: LeanOrder[] = [];
  if (raw.Orders && typeof raw.Orders === "object") {
    const orderEntries = Array.isArray(raw.Orders) ? raw.Orders : Object.values(raw.Orders);
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

      orders.push({
        id: o.Id ?? 0,
        symbol: typeof o.Symbol === "object" ? o.Symbol?.Value ?? "" : String(o.Symbol ?? ""),
        price: o.Price ?? 0,
        quantity: o.Quantity ?? 0,
        direction: (typeof o.Direction === "number" ? dirMap[o.Direction] ?? "Buy" : o.Direction ?? "Buy") as any,
        type: (typeof o.Type === "number" ? typeMap[o.Type] ?? "Market" : o.Type ?? "Market") as any,
        status: (typeof o.Status === "number" ? statusMap[o.Status] ?? (o.Status === 3 ? "Filled" : "Other") : o.Status ?? "Filled") as any,
        time: o.Time ?? o.CreatedTime ?? "",
        createdTime: o.CreatedTime,
        lastFillTime: o.LastFillTime,
        tag: o.Tag ?? "",
        fee: o.OrderFee?.Value?.Amount ?? 0,
        feeCurrency: o.OrderFee?.Value?.Currency ?? "USD",
        value: o.Value ?? 0
      });
    }
  }

  const closedTrades: ClosedTrade[] = [];
  if (Array.isArray(totalPerf.ClosedTrades)) {
    for (const t of totalPerf.ClosedTrades) {
      closedTrades.push({
        symbol: typeof t.Symbol === "object" ? t.Symbol?.Value ?? "" : String(t.Symbol ?? ""),
        entryTime: t.EntryTime ?? "",
        entryPrice: t.EntryPrice ?? 0,
        exitTime: t.ExitTime ?? "",
        exitPrice: t.ExitPrice ?? 0,
        quantity: t.Quantity ?? 0,
        profitLoss: t.ProfitLoss ?? 0,
        totalFees: t.TotalFees ?? 0,
        mae: t.MAE ?? 0,
        mfe: t.MFE ?? 0,
        duration: t.Duration ?? ""
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
