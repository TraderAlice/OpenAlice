export interface LeanConfig {
  enabled: boolean;
  dockerImage: string;
  dataDir: string;
  algorithmsDir: string;
  runsDir: string;
  experimentsDir: string;
  journalDir: string;
  algorithmLanguage: "Python" | "CSharp";
  maxConcurrentBacktests: number;
  defaultCash: number;
  defaultBrokerage: string;
  defaultTimeoutSeconds: number;
  memoryLimit?: string;
  cpuLimit?: string;
}

export type BacktestStatus = "pending" | "running" | "completed" | "failed" | "timeout";

export interface BacktestRequest {
  strategyId?: string;
  strategyName: string;
  pythonCode?: string;
  symbol: string;
  market?: string;
  resolution?: "minute" | "hour" | "daily";
  startDate: string; // YYYY-MM-DD
  endDate: string; // YYYY-MM-DD
  initialCash?: number;
  parameters?: Record<string, string | number | boolean>;
  brokerage?: string;
  timeoutSeconds?: number;
}

export interface ChartPoint {
  x: number; // Unix timestamp in seconds
  y: number; // Value
}

export interface ChartSeries {
  name: string;
  unit: string;
  values: ChartPoint[];
}

export interface LeanOrder {
  id: number;
  symbol: string;
  price: number;
  quantity: number;
  direction: "Buy" | "Sell" | "Hold";
  type: "Market" | "Limit" | "StopMarket" | "StopLimit" | string;
  status: "Filled" | "Canceled" | "Invalid" | "Submitted" | string;
  time: string;
  createdTime?: string;
  lastFillTime?: string | null;
  tag?: string;
  fee: number;
  feeCurrency: string;
  value: number;
}

export interface ClosedTrade {
  symbol: string;
  entryTime: string;
  entryPrice: number;
  exitTime: string;
  exitPrice: number;
  quantity: number;
  profitLoss: number;
  totalFees: number;
  mae: number;
  mfe: number;
  duration: string;
}

export interface LeanStatistics {
  totalTrades: number;
  winningTrades: number;
  losingTrades: number;
  winRate: number; // 0.0 to 1.0
  lossRate: number; // 0.0 to 1.0
  averageWin: number;
  averageLoss: number;
  profitLossRatio: number;
  compoundingAnnualReturn: number; // 0.0 to 1.0 (e.g. 0.154 for 15.4%)
  drawdown: number; // 0.0 to 1.0 (e.g. 0.042 for 4.2%)
  netProfit: number;
  sharpeRatio: number;
  sortinoRatio: number;
  probabilisticSharpeRatio: number;
  expectancy: number;
  totalFees: number;
  alpha: number;
  beta: number;
  annualStandardDeviation: number;
  annualVariance: number;
  informationRatio: number;
  trackingError: number;
  raw: Record<string, string>;
}

export interface LeanRuntimeStatistics {
  equity: number;
  fees: number;
  holdings: number;
  netProfit: number;
  returnPct: number;
  unrealized: number;
  volume: number;
  raw: Record<string, string>;
}

export interface BacktestResult {
  id: string;
  request: BacktestRequest;
  status: BacktestStatus;
  startedAt: string;
  completedAt?: string;
  durationMs?: number;
  exitCode?: number;
  statistics?: LeanStatistics;
  runtimeStatistics?: LeanRuntimeStatistics;
  charts: Record<string, ChartSeries>;
  orders: LeanOrder[];
  closedTrades: ClosedTrade[];
  logs?: string;
  error?: string;
  runDir?: string;
}

export interface BacktestSummary {
  id: string;
  strategyName: string;
  symbol: string;
  startDate: string;
  endDate: string;
  status: BacktestStatus;
  startedAt: string;
  completedAt?: string;
  netProfit?: number;
  sharpeRatio?: number;
  drawdown?: number;
  totalTrades?: number;
}

export interface ForexQuote {
  timestamp: Date | string | number;
  bidOpen: number;
  bidHigh: number;
  bidLow: number;
  bidClose: number;
  askOpen: number;
  askHigh: number;
  askLow: number;
  askClose: number;
  bidSize?: number;
  askSize?: number;
}

export interface ForexDataConversionOptions {
  market?: string;
  symbol: string;
  resolution?: "minute" | "daily";
  dataDir: string;
  sanitizeInvertedSpreads?: boolean;
}

export interface ConversionResult {
  symbol: string;
  market: string;
  resolution: string;
  totalQuotes: number;
  daysProcessed: number;
  filesWritten: string[];
}
