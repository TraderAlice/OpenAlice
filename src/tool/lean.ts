/**
 * AI LEAN Tools — Vercel AI SDK Tool Registry.
 *
 * Exposes event-driven backtesting, strategy creation, parameter optimization,
 * experiment memory, manual trade journaling, and evidence-first research integrity
 * analysis to OpenAlice AI agents.
 */

import { tool } from "ai";
import { z } from "zod";
import { resolve } from "node:path";
import type { LeanService } from "../domain/lean/service.js";
import { AlgorithmManager } from "../domain/lean/algorithms.js";
import { ExperimentStore, generateParameterGrid } from "../domain/lean/experiments.js";
import { TradeJournalStore } from "../domain/lean/journal.js";
import {
  evaluateOutOfSample,
  evaluateDataSnooping,
  runMonteCarloSimulation,
  generateResearchIntegrityReport
} from "../domain/lean/research-integrity/index.js";
import type { BacktestResult } from "../domain/lean/types.js";

export interface LeanToolDeps {
  leanService: LeanService;
  algorithmManager?: AlgorithmManager;
  experimentStore?: ExperimentStore;
  journalStore?: TradeJournalStore;
}

export function createLeanTools(deps: LeanToolDeps) {
  const { leanService } = deps;
  const projectRoot = process.cwd();

  const algoManager = deps.algorithmManager ?? new AlgorithmManager(leanService.algorithmsPath);
  const expStore = deps.experimentStore ?? new ExperimentStore(resolve(projectRoot, "data/lean/experiments"));
  const jnlStore = deps.journalStore ?? new TradeJournalStore(resolve(projectRoot, "data/lean/journal"));

  return {
    leanCreateStrategy: tool({
      description: `Create or update a Python LEAN trading algorithm strategy from template or custom Python code.
Templates available:
- 'ema-cross': Trend following crossover with ATR trailing stop
- 'london-breakout': Opening range breakout on Asian pre-market highs/lows
- 'rsi-mean-reversion': Statistical extreme mean reversion with Bollinger Bands and RSI`,
      inputSchema: z.object({
        id: z.string().optional().describe("Unique strategy slug (e.g. 'eurusd-ema-cross'). Auto-generated if omitted."),
        name: z.string().describe("Human-readable strategy name"),
        description: z.string().optional().describe("Description of strategy mechanics"),
        templateId: z.enum(["ema-cross", "london-breakout", "rsi-mean-reversion"]).optional().describe("Built-in template to instantiate"),
        code: z.string().optional().describe("Full Python QCAlgorithm code (if writing custom strategy)"),
        parameters: z.record(z.string(), z.union([z.string(), z.number(), z.boolean()])).optional().describe("Parameter values to override")
      }),
      execute: async ({ id, name, description, templateId, code, parameters }) => {
        try {
          if (id) {
            const existing = await algoManager.getStrategy(id);
            if (existing) {
              const updated = await algoManager.updateStrategy(id, {
                name,
                description,
                code,
                parameters
              });
              return { success: true, action: "updated", strategy: updated };
            }
          }
          const created = await algoManager.createStrategy({
            id,
            name,
            description,
            templateId,
            code,
            parameters
          });
          return { success: true, action: "created", strategy: created };
        } catch (err: any) {
          return { success: false, error: err.message };
        }
      }
    }),

    leanRunBacktest: tool({
      description: `Run an event-driven backtest for a strategy using the LEAN Engine in Docker with realistic Forex spread and margin execution.`,
      inputSchema: z.object({
        strategyId: z.string().optional().describe("ID of an existing strategy file"),
        strategyName: z.string().optional().describe("Strategy name identifier"),
        pythonCode: z.string().optional().describe("Direct inline Python code to backtest"),
        symbol: z.string().default("EURUSD").describe("Forex symbol pair (e.g. 'EURUSD')"),
        market: z.string().default("oanda").describe("Forex market data feed"),
        resolution: z.enum(["minute", "hour", "daily"]).default("minute").describe("Bar resolution"),
        startDate: z.string().describe("Backtest start date (YYYY-MM-DD)"),
        endDate: z.string().describe("Backtest end date (YYYY-MM-DD)"),
        initialCash: z.number().positive().default(100000).describe("Starting account cash in USD"),
        parameters: z.record(z.string(), z.union([z.string(), z.number(), z.boolean()])).optional().describe("Algorithm parameter overrides"),
        timeoutSeconds: z.number().int().positive().optional().describe("Execution timeout in seconds"),
        experimentId: z.string().optional().describe("Experiment ID to attach this backtest run to")
      }),
      execute: async ({
        strategyId,
        strategyName = "ForexStrategy",
        pythonCode,
        symbol,
        market,
        resolution,
        startDate,
        endDate,
        initialCash,
        parameters,
        timeoutSeconds,
        experimentId
      }) => {
        try {
          const result = await leanService.runBacktest({
            strategyId,
            strategyName,
            pythonCode,
            symbol,
            market,
            resolution,
            startDate,
            endDate,
            initialCash,
            parameters,
            timeoutSeconds
          });

          if (experimentId && result.id) {
            try {
              await expStore.addBacktestId(experimentId, result.id);
            } catch {
              // best effort link
            }
          }

          return {
            success: result.status === "completed",
            backtestId: result.id,
            status: result.status,
            durationMs: result.durationMs,
            statistics: result.statistics,
            runtimeStatistics: result.runtimeStatistics,
            error: result.error,
            logsSummary: result.logs ? result.logs.slice(-500) : undefined
          };
        } catch (err: any) {
          return { success: false, error: err.message };
        }
      }
    }),

    leanGetResults: tool({
      description: `Retrieve detailed statistics, order logs, closed trades, and equity charts for a completed LEAN backtest run.`,
      inputSchema: z.object({
        backtestId: z.string().describe("The backtest run ID"),
        includeOrders: z.boolean().default(false).describe("Include full order execution logs"),
        includeClosedTrades: z.boolean().default(true).describe("Include round-trip closed trade logs"),
        includeCharts: z.boolean().default(false).describe("Include equity curve chart point series")
      }),
      execute: async ({ backtestId, includeOrders, includeClosedTrades, includeCharts }) => {
        try {
          const result = await leanService.getBacktest(backtestId);
          if (!result) {
            return { success: false, error: `Backtest '${backtestId}' not found` };
          }

          return {
            success: true,
            id: result.id,
            status: result.status,
            request: result.request,
            statistics: result.statistics,
            runtimeStatistics: result.runtimeStatistics,
            closedTrades: includeClosedTrades ? result.closedTrades : undefined,
            orders: includeOrders ? result.orders : undefined,
            charts: includeCharts ? result.charts : undefined,
            error: result.error
          };
        } catch (err: any) {
          return { success: false, error: err.message };
        }
      }
    }),

    leanOptimize: tool({
      description: `Run a parameter optimization grid sweep across parameter ranges for a LEAN strategy. Evaluates multiple backtests and records results in an experiment.`,
      inputSchema: z.object({
        strategyId: z.string().describe("ID of the strategy to optimize"),
        symbol: z.string().default("EURUSD").describe("Forex symbol"),
        startDate: z.string().describe("Optimization start date (YYYY-MM-DD)"),
        endDate: z.string().describe("Optimization end date (YYYY-MM-DD)"),
        parameterRanges: z.record(
          z.string(),
          z.object({
            min: z.number(),
            max: z.number(),
            step: z.number()
          })
        ).describe("Ranges to optimize, e.g. { fast: { min: 5, max: 20, step: 5 } }"),
        initialCash: z.number().default(100000),
        experimentId: z.string().optional().describe("Existing experiment ID or auto-created if omitted")
      }),
      execute: async ({ strategyId, symbol, startDate, endDate, parameterRanges, initialCash, experimentId }) => {
        try {
          const grid = generateParameterGrid(parameterRanges);
          if (grid.length > 50) {
            return {
              success: false,
              error: `Parameter grid has ${grid.length} combinations; maximum allowed is 50 to prevent unbounded computation.`
            };
          }

          let exp = experimentId ? await expStore.get(experimentId) : null;
          if (!exp) {
            exp = await expStore.create({
              strategyId,
              hypothesis: `Parameter optimization sweep across ${grid.length} combinations`,
              parameters: grid[0] || {},
              parameterRanges,
              instruments: [symbol],
              inSamplePeriod: { start: startDate, end: endDate },
              source: "optimization",
              tags: ["optimization", symbol.toLowerCase()]
            });
          }

          const sweepResults: Array<{
            parameters: Record<string, number>;
            backtestId: string;
            status: string;
            sharpeRatio: number;
            netProfit: number;
            drawdown: number;
            winRate: number;
          }> = [];

          for (const params of grid) {
            const bt = await leanService.runBacktest({
              strategyId,
              strategyName: `${strategyId}_opt`,
              symbol,
              startDate,
              endDate,
              initialCash,
              parameters: params
            });

            if (bt.id) {
              await expStore.addBacktestId(exp.id, bt.id);
            }

            sweepResults.push({
              parameters: params,
              backtestId: bt.id,
              status: bt.status,
              sharpeRatio: bt.statistics?.sharpeRatio ?? 0,
              netProfit: bt.statistics?.netProfit ?? 0,
              drawdown: bt.statistics?.drawdown ?? 0,
              winRate: bt.statistics?.winRate ?? 0
            });
          }

          sweepResults.sort((a, b) => b.sharpeRatio - a.sharpeRatio);
          const topResult = sweepResults[0];

          if (topResult) {
            await expStore.update(exp.id, {
              parameters: topResult.parameters
            });
          }

          return {
            success: true,
            experimentId: exp.id,
            totalCombinations: grid.length,
            topConfiguration: topResult,
            allResults: sweepResults
          };
        } catch (err: any) {
          return { success: false, error: err.message };
        }
      }
    }),

    leanResearchIntegrity: tool({
      description: `Execute rigorous evidence-first statistical research integrity checks on backtest results (OOS degradation, Deflated Sharpe Ratio, Walk-Forward Efficiency, Monte Carlo bootstrap resampling, parameter sensitivity, data snooping corrections).`,
      inputSchema: z.object({
        experimentId: z.string().optional().describe("Experiment ID to analyze and store report in"),
        isBacktestId: z.string().optional().describe("In-sample backtest run ID"),
        oosBacktestId: z.string().optional().describe("Out-of-sample backtest run ID"),
        monteCarloIterations: z.number().int().default(1000).describe("Number of bootstrap iterations (default 1000)"),
        ruinThresholdPct: z.number().default(0.20).describe("Max drawdown ruin threshold (default 0.20 for 20%)"),
        totalHistoricalTrials: z.number().int().default(1).describe("Number of historical trials tested on this dataset")
      }),
      execute: async ({
        experimentId,
        isBacktestId,
        oosBacktestId,
        monteCarloIterations,
        ruinThresholdPct,
        totalHistoricalTrials
      }) => {
        try {
          let isResult: BacktestResult | null = null;
          let oosResult: BacktestResult | null = null;

          if (isBacktestId) {
            isResult = await leanService.getBacktest(isBacktestId);
          }
          if (oosBacktestId) {
            oosResult = await leanService.getBacktest(oosBacktestId);
          }

          let exp = experimentId ? await expStore.get(experimentId) : null;
          if (exp && exp.backtestIds.length > 0) {
            if (!isResult && exp.backtestIds[0]) {
              isResult = await leanService.getBacktest(exp.backtestIds[0]);
            }
            if (!oosResult && exp.backtestIds[1]) {
              oosResult = await leanService.getBacktest(exp.backtestIds[1]);
            }
          }

          const tradeReturns = (oosResult?.closedTrades || isResult?.closedTrades || []).map(
            (t) => t.profitLoss / 100000
          );

          const report = generateResearchIntegrityReport({
            experimentId,
            strategyId: isResult?.request.strategyId,
            oosOptions:
              isResult?.statistics && oosResult?.statistics
                ? {
                    isStats: isResult.statistics,
                    oosStats: oosResult.statistics,
                    isPeriod: { start: isResult.request.startDate, end: isResult.request.endDate },
                    oosPeriod: { start: oosResult.request.startDate, end: oosResult.request.endDate },
                    trialsTested: totalHistoricalTrials
                  }
                : undefined,
            monteCarloOptions:
              tradeReturns.length > 0
                ? {
                    tradeReturns,
                    iterations: monteCarloIterations,
                    ruinThresholdPct
                  }
                : undefined,
            dataSnoopingOptions: {
              totalHistoricalTrials,
              sharpeRatio: oosResult?.statistics?.sharpeRatio ?? isResult?.statistics?.sharpeRatio ?? 1.0
            }
          });

          if (experimentId) {
            await expStore.setResearchIntegrity(experimentId, report);
          }

          return {
            success: true,
            report
          };
        } catch (err: any) {
          return { success: false, error: err.message };
        }
      }
    }),

    leanListExperiments: tool({
      description: `Search and filter experiment history, parameter sweeps, and lineage trees.`,
      inputSchema: z.object({
        strategyId: z.string().optional().describe("Filter by strategy ID"),
        symbol: z.string().optional().describe("Filter by symbol"),
        source: z.enum(["manual", "ai", "optimization", "journal"]).optional().describe("Filter by source"),
        tag: z.string().optional().describe("Filter by tag"),
        limit: z.number().int().positive().default(20).describe("Max results to return")
      }),
      execute: async ({ strategyId, symbol, source, tag, limit }) => {
        try {
          const experiments = await expStore.list({ strategyId, symbol, source, tag, limit });
          return {
            success: true,
            count: experiments.length,
            experiments: experiments.map((e) => ({
              id: e.id,
              strategyId: e.strategyId,
              hypothesis: e.hypothesis,
              parameters: e.parameters,
              source: e.source,
              tags: e.tags,
              backtestCount: e.backtestIds.length,
              createdAt: e.createdAt
            }))
          };
        } catch (err: any) {
          return { success: false, error: err.message };
        }
      }
    }),

    leanJournalEntry: tool({
      description: `Create, read, or list manual trade journal entries recording discretionary trading setups, hypotheses, and post-trade reviews.`,
      inputSchema: z.object({
        action: z.enum(["create", "get", "list", "update", "delete"]).describe("Action to perform"),
        id: z.string().optional().describe("Journal entry ID (required for get, update, delete)"),
        title: z.string().optional().describe("Title for trade entry"),
        symbol: z.string().optional().describe("Forex symbol pair (e.g. 'EURUSD')"),
        direction: z.enum(["long", "short"]).optional().describe("Trade direction"),
        entryTime: z.string().optional().describe("Entry time (ISO string)"),
        exitTime: z.string().optional().describe("Exit time (ISO string)"),
        entryPrice: z.number().optional().describe("Entry fill price"),
        exitPrice: z.number().optional().describe("Exit fill price"),
        profitLoss: z.number().optional().describe("Realized profit or loss in USD"),
        hypothesis: z.string().optional().describe("Trade rationale and setup"),
        marketContext: z.object({
          session: z.string().optional(),
          trend: z.string().optional(),
          notes: z.string().optional()
        }).optional().describe("Session and market context"),
        review: z.object({
          whatWorked: z.string().optional(),
          whatFailed: z.string().optional(),
          lessonsLearned: z.string().optional()
        }).optional().describe("Post-trade review and learnings"),
        tags: z.array(z.string()).optional().describe("Categorization tags")
      }),
      execute: async ({
        action,
        id,
        title,
        symbol,
        direction,
        entryTime,
        exitTime,
        entryPrice,
        exitPrice,
        profitLoss,
        hypothesis,
        marketContext,
        review,
        tags
      }) => {
        try {
          if (action === "create") {
            if (!title || !symbol || !direction || !entryTime || entryPrice == null || !hypothesis) {
              return { success: false, error: "Missing required fields for journal creation (title, symbol, direction, entryTime, entryPrice, hypothesis)" };
            }
            const entry = await jnlStore.create({
              id,
              title,
              symbol,
              direction,
              entryTime,
              exitTime,
              entryPrice,
              exitPrice,
              profitLoss,
              hypothesis,
              marketContext,
              review,
              tags
            });
            return { success: true, action: "created", entry };
          }

          if (action === "get") {
            if (!id) return { success: false, error: "id is required for action 'get'" };
            const entry = await jnlStore.get(id);
            return { success: !!entry, entry };
          }

          if (action === "list") {
            const list = await jnlStore.list({ symbol: symbol as any });
            return { success: true, count: list.length, entries: list };
          }

          if (action === "update") {
            if (!id) return { success: false, error: "id is required for action 'update'" };
            const updated = await jnlStore.update(id, {
              title,
              exitTime,
              exitPrice,
              profitLoss,
              hypothesis,
              marketContext,
              review,
              tags
            });
            return { success: true, action: "updated", entry: updated };
          }

          if (action === "delete") {
            if (!id) return { success: false, error: "id is required for action 'delete'" };
            const deleted = await jnlStore.delete(id);
            return { success: deleted };
          }

          return { success: false, error: `Unsupported action '${action}'` };
        } catch (err: any) {
          return { success: false, error: err.message };
        }
      }
    }),

    leanFormalizeIdea: tool({
      description: `Convert a discretionary trade journal entry or informal trading thesis into a formal algorithmic strategy proposal with parameter definitions.`,
      inputSchema: z.object({
        journalId: z.string().describe("ID of the manual trade journal entry to formalize")
      }),
      execute: async ({ journalId }) => {
        try {
          const proposal = await jnlStore.formalizeIdea(journalId);
          return {
            success: true,
            proposal
          };
        } catch (err: any) {
          return { success: false, error: err.message };
        }
      }
    })
  };
}
