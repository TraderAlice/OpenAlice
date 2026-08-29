export interface OutOfSampleReport {
  isPeriod: { start: string; end: string };
  oosPeriod: { start: string; end: string };
  isSharpe: number;
  oosSharpe: number;
  sharpeDegradationPct: number;
  isNetProfit: number;
  oosNetProfit: number;
  netProfitDegradationPct: number;
  isWinRate: number;
  oosWinRate: number;
  isMaxDrawdown: number;
  oosMaxDrawdown: number;
  parameterCount: number;
  independentDataPoints: number;
  parameterToDataRatio: number;
  deflatedSharpeRatio: {
    dsr: number; // Probabilistic score [0.0, 1.0] representing probability of true skill
    expectedMaxSharpeNull: number;
    estimatedSharpe: number;
    sampleLengthT: number;
    skewness: number;
    kurtosis: number;
    trialsTested: number;
  };
  interpretation: string;
  academicReferences: string[];
}

export interface WalkForwardWindow {
  windowIndex: number;
  isPeriod: { start: string; end: string };
  oosPeriod: { start: string; end: string };
  isReturn: number;
  oosReturn: number;
  isSharpe: number;
  oosSharpe: number;
  isMaxDrawdown: number;
  oosMaxDrawdown: number;
  wfeRatio: number; // oosReturn / isReturn
}

export interface WalkForwardReport {
  mode: "rolling" | "anchored";
  windowCount: number;
  windows: WalkForwardWindow[];
  aggregateIsReturn: number;
  aggregateOosReturn: number;
  walkForwardEfficiency: number; // Total OOS Return / Total IS Return
  positiveOosWindowRatio: number; // fraction of windows with OOS return > 0
  consistentSharpeWindowRatio: number; // fraction of windows where OOS Sharpe >= 0.5 * IS Sharpe
  maxOosDrawdown: number;
  interpretation: string;
  academicReferences: string[];
}

export interface MonteCarloPercentiles {
  p05: number;
  p25: number;
  p50: number; // Median
  p75: number;
  p95: number;
  p99?: number;
}

export interface MonteCarloReport {
  iterations: number;
  tradeCount: number;
  initialEquity: number;
  ruinThresholdPct: number;
  ruinProbability: number; // fraction of paths with maxDD > ruinThresholdPct
  maxDrawdownDistribution: MonteCarloPercentiles;
  finalReturnDistribution: MonteCarloPercentiles;
  sharpeRatioDistribution: MonteCarloPercentiles;
  longestLosingStreakDistribution: {
    median: number;
    p95: number;
    max: number;
  };
  confidenceIntervals: {
    maxDrawdown95: [number, number]; // [2.5th percentile, 97.5th percentile]
    finalReturn95: [number, number];
  };
  methodologyAssumptions: string[];
  academicReferences: string[];
}

export interface ParameterPerturbation {
  parameterName: string;
  baseValue: number;
  perturbedValue: number;
  perturbationPct: number; // e.g. +10, -10, +20, -20
  resultingSharpe: number;
  resultingNetProfit: number;
  resultingMaxDrawdown: number;
  sharpeChangePct: number;
  elasticity: number; // |% change in Sharpe| / |% change in Parameter|
}

export interface ParameterSensitivityReport {
  baseParameters: Record<string, number>;
  perturbations: ParameterPerturbation[];
  parameterFragility: Record<string, {
    maxSharpeDropPct: number;
    averageElasticity: number;
    isUnstable: boolean; // Flagged if 10% perturbation causes >50% Sharpe drop
  }>;
  interpretation: string;
  academicReferences: string[];
}

export interface DataSnoopingReport {
  totalHistoricalTrials: number;
  nominalAlpha: number; // e.g. 0.05
  bonferroniAlpha: number; // nominalAlpha / N
  rawPValue: number;
  bonferroniAdjustedPValue: number;
  holmAdjustedPValue: number;
  expectedFalseDiscoveries: number;
  tStatistic: number;
  haircutSharpeRatio: number;
  isSignificantAfterCorrection: boolean;
  interpretation: string;
  academicReferences: string[];
}

export interface ResearchIntegrityReport {
  experimentId?: string;
  strategyId?: string;
  evaluatedAt: string;
  outOfSample?: OutOfSampleReport;
  walkForward?: WalkForwardReport;
  monteCarlo?: MonteCarloReport;
  sensitivity?: ParameterSensitivityReport;
  dataSnooping?: DataSnoopingReport;
  summaryFindings: string[];
  methodologyNotice: string;
}
