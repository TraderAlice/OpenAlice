import type { ParameterPerturbation, ParameterSensitivityReport } from "./types.js";

export interface EvaluateSensitivityOptions {
  baseParameters: Record<string, number>;
  baseSharpe: number;
  baseNetProfit: number;
  baseMaxDrawdown: number;
  perturbations: Array<{
    parameterName: string;
    perturbedValue: number;
    resultingSharpe: number;
    resultingNetProfit: number;
    resultingMaxDrawdown: number;
  }>;
}

export function evaluateParameterSensitivity(options: EvaluateSensitivityOptions): ParameterSensitivityReport {
  const {
    baseParameters,
    baseSharpe,
    baseNetProfit,
    baseMaxDrawdown,
    perturbations: rawPerturbations
  } = options;

  const perturbations: ParameterPerturbation[] = rawPerturbations.map((p) => {
    const baseVal = baseParameters[p.parameterName] ?? p.perturbedValue;
    const perturbationPct = baseVal !== 0
      ? Number((((p.perturbedValue - baseVal) / Math.abs(baseVal)) * 100).toFixed(2))
      : 0;

    const sharpeChangePct = baseSharpe !== 0
      ? Number((((p.resultingSharpe - baseSharpe) / Math.abs(baseSharpe)) * 100).toFixed(2))
      : 0;

    const elasticity = perturbationPct !== 0
      ? Number((Math.abs(sharpeChangePct) / Math.abs(perturbationPct)).toFixed(4))
      : 0;

    return {
      parameterName: p.parameterName,
      baseValue: baseVal,
      perturbedValue: p.perturbedValue,
      perturbationPct,
      resultingSharpe: p.resultingSharpe,
      resultingNetProfit: p.resultingNetProfit,
      resultingMaxDrawdown: p.resultingMaxDrawdown,
      sharpeChangePct,
      elasticity
    };
  });

  const parameterFragility: ParameterSensitivityReport["parameterFragility"] = {};
  const unstableParams: string[] = [];

  for (const paramName of Object.keys(baseParameters)) {
    const paramPerturbations = perturbations.filter((p) => p.parameterName === paramName);
    if (paramPerturbations.length === 0) continue;

    let maxSharpeDropPct = 0;
    let totalElasticity = 0;

    for (const p of paramPerturbations) {
      if (p.sharpeChangePct < 0 && Math.abs(p.sharpeChangePct) > maxSharpeDropPct) {
        maxSharpeDropPct = Math.abs(p.sharpeChangePct);
      }
      totalElasticity += p.elasticity;
    }

    const averageElasticity = Number((totalElasticity / paramPerturbations.length).toFixed(4));
    // Flag unstable if a <=10% perturbation causes >50% Sharpe drop or elasticity > 4.0
    const tenPctPerturbations = paramPerturbations.filter((p) => Math.abs(p.perturbationPct) <= 12);
    const hasExtremeDropAtSmallPerturbation = tenPctPerturbations.some((p) => p.sharpeChangePct <= -50);
    const isUnstable = hasExtremeDropAtSmallPerturbation || averageElasticity > 4.0;

    if (isUnstable) {
      unstableParams.push(paramName);
    }

    parameterFragility[paramName] = {
      maxSharpeDropPct: Number(maxSharpeDropPct.toFixed(2)),
      averageElasticity,
      isUnstable
    };
  }

  let interpretation = `Parameter sensitivity analysis evaluated across ${Object.keys(baseParameters).length} parameters. `;
  if (unstableParams.length > 0) {
    interpretation += `Unstable parameters identified: [${unstableParams.join(", ")}]. Small perturbations in these parameters cause sharp performance cliffs, suggesting dangerous overfitting to localized parameter peaks (curve fitting). `;
  } else {
    interpretation += `All parameters demonstrate smooth, gradual sensitivity curves without acute performance cliffs, indicating high structural robustness. `;
  }

  return {
    baseParameters,
    perturbations,
    parameterFragility,
    interpretation,
    academicReferences: [
      "White, H. (2000). A Reality Check for Data Snooping. Econometrica, 68(5), 1097-1126.",
      "Aronson, D. R. (2006). Evidence-Based Technical Analysis: Applying the Scientific Method and Statistical Inference to Trading Signals. John Wiley & Sons."
    ]
  };
}
