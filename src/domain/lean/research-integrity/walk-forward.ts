import type { WalkForwardReport, WalkForwardWindow } from "./types.js";

export interface GenerateWalkForwardSplitsOptions {
  startDate: string; // YYYY-MM-DD
  endDate: string; // YYYY-MM-DD
  numWindows?: number;
  mode?: "rolling" | "anchored";
  trainFraction?: number; // e.g. 0.70 IS, 0.30 OOS
}

export interface SplitWindowPeriod {
  windowIndex: number;
  isPeriod: { start: string; end: string };
  oosPeriod: { start: string; end: string };
}

export function generateWalkForwardSplits(options: GenerateWalkForwardSplitsOptions): SplitWindowPeriod[] {
  const {
    startDate,
    endDate,
    numWindows = 5,
    mode = "rolling",
    trainFraction = 0.7
  } = options;

  const startMs = new Date(startDate).getTime();
  const endMs = new Date(endDate).getTime();
  const totalDuration = endMs - startMs;

  if (totalDuration <= 0 || numWindows <= 0) {
    return [];
  }

  const splits: SplitWindowPeriod[] = [];
  const oosFraction = 1 - trainFraction;
  const isLengthMs = totalDuration * trainFraction;
  const stepMs = (totalDuration * oosFraction) / numWindows;

  for (let i = 0; i < numWindows; i++) {
    const isStartMs = mode === "anchored" ? startMs : startMs + i * stepMs;
    const isEndMs = mode === "anchored" ? startMs + isLengthMs + i * stepMs : isStartMs + isLengthMs;
    const oosStartMs = isEndMs;
    const oosEndMs = Math.min(endMs, oosStartMs + stepMs);

    if (oosStartMs >= endMs) break;

    splits.push({
      windowIndex: i + 1,
      isPeriod: {
        start: new Date(isStartMs).toISOString().split("T")[0],
        end: new Date(isEndMs).toISOString().split("T")[0]
      },
      oosPeriod: {
        start: new Date(oosStartMs).toISOString().split("T")[0],
        end: new Date(oosEndMs).toISOString().split("T")[0]
      }
    });
  }

  return splits;
}

export interface EvaluateWalkForwardOptions {
  mode?: "rolling" | "anchored";
  windows: Array<{
    windowIndex: number;
    isPeriod: { start: string; end: string };
    oosPeriod: { start: string; end: string };
    isReturn: number;
    oosReturn: number;
    isSharpe: number;
    oosSharpe: number;
    isMaxDrawdown: number;
    oosMaxDrawdown: number;
  }>;
}

export function evaluateWalkForward(options: EvaluateWalkForwardOptions): WalkForwardReport {
  const { mode = "rolling", windows: inputWindows } = options;

  const windows: WalkForwardWindow[] = inputWindows.map((w) => {
    const wfeRatio = w.isReturn !== 0
      ? Number((w.oosReturn / Math.abs(w.isReturn)).toFixed(4))
      : 0;
    return {
      ...w,
      wfeRatio
    };
  });

  const aggregateIsReturn = Number(windows.reduce((sum, w) => sum + w.isReturn, 0).toFixed(4));
  const aggregateOosReturn = Number(windows.reduce((sum, w) => sum + w.oosReturn, 0).toFixed(4));

  const walkForwardEfficiency = aggregateIsReturn !== 0
    ? Number(((aggregateOosReturn / Math.abs(aggregateIsReturn)) * 100).toFixed(2))
    : 0;

  const positiveOosWindows = windows.filter((w) => w.oosReturn > 0).length;
  const positiveOosWindowRatio = windows.length > 0
    ? Number((positiveOosWindows / windows.length).toFixed(4))
    : 0;

  const consistentSharpeWindows = windows.filter((w) => w.oosSharpe >= 0.5 * w.isSharpe).length;
  const consistentSharpeWindowRatio = windows.length > 0
    ? Number((consistentSharpeWindows / windows.length).toFixed(4))
    : 0;

  const maxOosDrawdown = windows.reduce((max, w) => Math.max(max, w.oosMaxDrawdown), 0);

  let interpretation = `Walk-Forward Efficiency is ${walkForwardEfficiency}% (${mode} mode across ${windows.length} windows). `;
  if (walkForwardEfficiency >= 60 && positiveOosWindowRatio >= 0.7) {
    interpretation += `High WFE (>=60%) with ${(positiveOosWindowRatio * 100).toFixed(1)}% profitable OOS windows indicates a robust, parameter-stable strategy that adapts well over sequential market regimes.`;
  } else if (walkForwardEfficiency >= 30) {
    interpretation += `Moderate WFE (30-60%) indicates acceptable regime resilience, though with some performance degradation in out-of-sample segments.`;
  } else {
    interpretation += `Low WFE (<30%) or negative efficiency indicates severe curve-fitting in in-sample optimization that breaks down in live sequential testing.`;
  }

  return {
    mode,
    windowCount: windows.length,
    windows,
    aggregateIsReturn,
    aggregateOosReturn,
    walkForwardEfficiency,
    positiveOosWindowRatio,
    consistentSharpeWindowRatio,
    maxOosDrawdown,
    interpretation,
    academicReferences: [
      "Pardo, R. (2008). The Evaluation and Optimization of Trading Strategies (2nd ed.). John Wiley & Sons.",
      "Tomasini, E., & Jaekle, U. (2009). Trading Systems: A New Approach to System Development and Portfolio Optimisation. Harriman House."
    ]
  };
}
