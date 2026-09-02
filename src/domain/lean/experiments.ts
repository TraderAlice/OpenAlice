import { existsSync } from "node:fs";
import { mkdir, readFile, readdir, unlink, writeFile } from "node:fs/promises";
import { join, resolve } from "node:path";
import type { LeanStatistics } from "./types.js";
import type { ResearchIntegrityReport } from "./research-integrity/types.js";

export interface Experiment {
  id: string;
  strategyId: string;
  strategyVersion?: string;
  gitCommit?: string;
  hypothesis: string;
  parameters: Record<string, string | number | boolean>;
  parameterRanges?: Record<string, { min: number; max: number; step: number }>;
  instruments: string[];
  timeframe: { resolution: string; start: string; end: string };
  dataSource: string;
  inSamplePeriod: { start: string; end: string };
  outOfSamplePeriod?: { start: string; end: string };
  backtestIds: string[];
  optimizationRunId?: string;
  results?: {
    inSample?: LeanStatistics;
    outOfSample?: LeanStatistics;
  };
  researchIntegrity?: ResearchIntegrityReport;
  aiAnalysis?: string;
  manualNotes?: string;
  parentExperimentId?: string;
  childExperimentIds?: string[];
  source: "manual" | "ai" | "optimization" | "journal";
  tags: string[];
  createdAt: string;
  updatedAt: string;
}

export interface CreateExperimentOptions {
  id?: string;
  strategyId: string;
  strategyVersion?: string;
  hypothesis: string;
  parameters: Record<string, string | number | boolean>;
  parameterRanges?: Record<string, { min: number; max: number; step: number }>;
  instruments?: string[];
  timeframe?: { resolution: string; start: string; end: string };
  dataSource?: string;
  inSamplePeriod: { start: string; end: string };
  outOfSamplePeriod?: { start: string; end: string };
  parentExperimentId?: string;
  source?: "manual" | "ai" | "optimization" | "journal";
  tags?: string[];
  manualNotes?: string;
}

export interface ExperimentFilter {
  strategyId?: string;
  symbol?: string;
  source?: string;
  tag?: string;
  limit?: number;
}

export interface ExperimentLineageNode {
  experiment: Experiment;
  children: ExperimentLineageNode[];
}

export interface ExperimentComparison {
  experimentA: Experiment;
  experimentB: Experiment;
  parameterDiffs: Record<string, { a: unknown; b: unknown }>;
  metricDiffs: {
    isSharpeDiff?: number;
    oosSharpeDiff?: number;
    isNetProfitDiff?: number;
    oosNetProfitDiff?: number;
    isDrawdownDiff?: number;
    oosDrawdownDiff?: number;
  };
}

/**
 * Generates Cartesian product of parameter grid combinations.
 */
export function generateParameterGrid(
  ranges: Record<string, { min: number; max: number; step: number }>
): Array<Record<string, number>> {
  const keys = Object.keys(ranges);
  if (keys.length === 0) return [{}];

  const paramValues: Record<string, number[]> = {};
  for (const key of keys) {
    const { min, max, step } = ranges[key];
    const vals: number[] = [];
    if (step <= 0 || min > max) {
      vals.push(min);
    } else {
      for (let v = min; v <= max + 1e-9; v += step) {
        vals.push(Number(v.toFixed(6)));
      }
    }
    paramValues[key] = vals;
  }

  let combinations: Array<Record<string, number>> = [{}];
  for (const key of keys) {
    const nextCombos: Array<Record<string, number>> = [];
    for (const combo of combinations) {
      for (const val of paramValues[key]) {
        nextCombos.push({ ...combo, [key]: val });
      }
    }
    combinations = nextCombos;
  }

  return combinations;
}

export class ExperimentStore {
  private readonly experimentsDir: string;

  constructor(experimentsDir: string) {
    this.experimentsDir = resolve(experimentsDir);
  }

  async ensureDir(): Promise<void> {
    await mkdir(this.experimentsDir, { recursive: true });
  }

  private getFilePath(id: string): string {
    return join(this.experimentsDir, `${id}.json`);
  }

  async create(options: CreateExperimentOptions): Promise<Experiment> {
    await this.ensureDir();

    const timestamp = Date.now();
    const shortId = Math.random().toString(36).substring(2, 8);
    const id = options.id || `exp_${timestamp}_${shortId}`;
    const now = new Date().toISOString();

    const experiment: Experiment = {
      id,
      strategyId: options.strategyId,
      strategyVersion: options.strategyVersion,
      hypothesis: options.hypothesis,
      parameters: options.parameters,
      parameterRanges: options.parameterRanges,
      instruments: options.instruments ?? ["EURUSD"],
      timeframe: options.timeframe ?? {
        resolution: "minute",
        start: options.inSamplePeriod.start,
        end: options.outOfSamplePeriod?.end ?? options.inSamplePeriod.end
      },
      dataSource: options.dataSource ?? "oanda",
      inSamplePeriod: options.inSamplePeriod,
      outOfSamplePeriod: options.outOfSamplePeriod,
      backtestIds: [],
      parentExperimentId: options.parentExperimentId,
      childExperimentIds: [],
      source: options.source ?? "manual",
      tags: options.tags ?? [],
      manualNotes: options.manualNotes,
      createdAt: now,
      updatedAt: now
    };

    const filePath = this.getFilePath(id);
    await writeFile(filePath, JSON.stringify(experiment, null, 2), "utf8");

    // Link lineage in parent experiment if exists
    if (options.parentExperimentId) {
      try {
        const parent = await this.get(options.parentExperimentId);
        if (parent) {
          const children = parent.childExperimentIds ?? [];
          if (!children.includes(id)) {
            children.push(id);
            await this.update(options.parentExperimentId, { childExperimentIds: children });
          }
        }
      } catch {
        // Parent update is best effort
      }
    }

    return experiment;
  }

  async get(id: string): Promise<Experiment | null> {
    await this.ensureDir();
    const filePath = this.getFilePath(id);
    if (!existsSync(filePath)) return null;

    try {
      const data = await readFile(filePath, "utf8");
      return JSON.parse(data) as Experiment;
    } catch {
      return null;
    }
  }

  async list(filter?: ExperimentFilter): Promise<Experiment[]> {
    await this.ensureDir();
    const files = await readdir(this.experimentsDir);
    const jsonFiles = files.filter((f) => f.endsWith(".json"));

    const list: Experiment[] = [];
    for (const f of jsonFiles) {
      const id = f.replace(/\.json$/, "");
      const exp = await this.get(id);
      if (!exp) continue;

      if (filter?.strategyId && exp.strategyId !== filter.strategyId) continue;
      if (filter?.symbol && !exp.instruments.includes(filter.symbol)) continue;
      if (filter?.source && exp.source !== filter.source) continue;
      if (filter?.tag && !exp.tags.includes(filter.tag)) continue;

      list.push(exp);
    }

    list.sort((a, b) => b.createdAt.localeCompare(a.createdAt));
    if (filter?.limit && filter.limit > 0) {
      return list.slice(0, filter.limit);
    }
    return list;
  }

  async update(id: string, updates: Partial<Experiment>): Promise<Experiment> {
    const existing = await this.get(id);
    if (!existing) {
      throw new Error(`Experiment '${id}' not found`);
    }

    const updated: Experiment = {
      ...existing,
      ...updates,
      id: existing.id, // Prevent id modification
      createdAt: existing.createdAt,
      updatedAt: new Date().toISOString()
    };

    const filePath = this.getFilePath(id);
    await writeFile(filePath, JSON.stringify(updated, null, 2), "utf8");
    return updated;
  }

  async delete(id: string): Promise<boolean> {
    await this.ensureDir();
    const filePath = this.getFilePath(id);
    if (!existsSync(filePath)) return false;

    await unlink(filePath);
    return true;
  }

  async addBacktestId(experimentId: string, backtestId: string): Promise<Experiment> {
    const existing = await this.get(experimentId);
    if (!existing) {
      throw new Error(`Experiment '${experimentId}' not found`);
    }

    const backtestIds = existing.backtestIds || [];
    if (!backtestIds.includes(backtestId)) {
      backtestIds.push(backtestId);
    }

    return this.update(experimentId, { backtestIds });
  }

  async setResults(
    experimentId: string,
    results: { inSample?: LeanStatistics; outOfSample?: LeanStatistics }
  ): Promise<Experiment> {
    return this.update(experimentId, { results });
  }

  async setResearchIntegrity(
    experimentId: string,
    report: ResearchIntegrityReport
  ): Promise<Experiment> {
    return this.update(experimentId, { researchIntegrity: report });
  }

  async getLineageTree(rootExperimentId: string): Promise<ExperimentLineageNode | null> {
    const root = await this.get(rootExperimentId);
    if (!root) return null;

    const buildNode = async (exp: Experiment): Promise<ExperimentLineageNode> => {
      const children: ExperimentLineageNode[] = [];
      for (const childId of exp.childExperimentIds || []) {
        const childExp = await this.get(childId);
        if (childExp) {
          children.push(await buildNode(childExp));
        }
      }
      return { experiment: exp, children };
    };

    return buildNode(root);
  }

  async compareExperiments(idA: string, idB: string): Promise<ExperimentComparison> {
    const expA = await this.get(idA);
    if (!expA) throw new Error(`Experiment '${idA}' not found`);
    const expB = await this.get(idB);
    if (!expB) throw new Error(`Experiment '${idB}' not found`);

    const allParamKeys = Array.from(
      new Set([...Object.keys(expA.parameters || {}), ...Object.keys(expB.parameters || {})])
    );

    const parameterDiffs: Record<string, { a: unknown; b: unknown }> = {};
    for (const key of allParamKeys) {
      const valA = expA.parameters?.[key];
      const valB = expB.parameters?.[key];
      if (valA !== valB) {
        parameterDiffs[key] = { a: valA, b: valB };
      }
    }

    const metricDiffs: ExperimentComparison["metricDiffs"] = {};
    if (expA.results?.inSample && expB.results?.inSample) {
      metricDiffs.isSharpeDiff = Number(
        (expB.results.inSample.sharpeRatio - expA.results.inSample.sharpeRatio).toFixed(4)
      );
      metricDiffs.isNetProfitDiff = Number(
        (expB.results.inSample.netProfit - expA.results.inSample.netProfit).toFixed(2)
      );
      metricDiffs.isDrawdownDiff = Number(
        (expB.results.inSample.drawdown - expA.results.inSample.drawdown).toFixed(4)
      );
    }
    if (expA.results?.outOfSample && expB.results?.outOfSample) {
      metricDiffs.oosSharpeDiff = Number(
        (expB.results.outOfSample.sharpeRatio - expA.results.outOfSample.sharpeRatio).toFixed(4)
      );
      metricDiffs.oosNetProfitDiff = Number(
        (expB.results.outOfSample.netProfit - expA.results.outOfSample.netProfit).toFixed(2)
      );
      metricDiffs.oosDrawdownDiff = Number(
        (expB.results.outOfSample.drawdown - expA.results.outOfSample.drawdown).toFixed(4)
      );
    }

    return {
      experimentA: expA,
      experimentB: expB,
      parameterDiffs,
      metricDiffs
    };
  }
}
