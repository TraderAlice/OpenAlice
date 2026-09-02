import { describe, it, expect } from "vitest";
import { parseLeanResults, parsePercent, parseCurrency, parseNumber } from "../results.js";

describe("results parser helpers", () => {
  it("parses percentages correctly", () => {
    expect(parsePercent("15.4%")).toBeCloseTo(0.154);
    expect(parsePercent("-4.2%")).toBeCloseTo(-0.042);
    expect(parsePercent(0.154)).toBe(0.154);
    expect(parsePercent(15.4)).toBeCloseTo(0.154);
    expect(parsePercent(-15.4)).toBeCloseTo(-0.154);
    expect(parsePercent(null)).toBe(0);
    expect(parsePercent(undefined)).toBe(0);
    expect(parsePercent("invalid%")).toBe(0);
  });

  it("parses currency strings correctly", () => {
    expect(parseCurrency("$1,234.56")).toBe(1234.56);
    expect(parseCurrency("-$50.00")).toBe(-50);
    expect(parseCurrency(100)).toBe(100);
    expect(parseCurrency(null)).toBe(0);
    expect(parseCurrency("abc")).toBe(0);
  });

  it("parses numeric ratios safely", () => {
    expect(parseNumber("1.85")).toBe(1.85);
    expect(parseNumber("1,234.5")).toBe(1234.5);
    expect(parseNumber(42.5)).toBe(42.5);
    expect(parseNumber("N/A", 0)).toBe(0);
    expect(parseNumber(undefined, 99)).toBe(99);
  });
});

describe("parseLeanResults", () => {
  const sampleLeanOutput = {
    TotalPerformance: {
      TradeStatistics: {
        TotalNumberOfTrades: 12,
        NumberOfWinningTrades: 8,
        NumberOfLosingTrades: 4,
        WinRate: 0.6667,
        LossRate: 0.3333,
        WinLossRatio: 2.1,
        TotalProfitLoss: 2450.50
      },
      PortfolioStatistics: {
        SharpeRatio: 1.95,
        SortinoRatio: 2.80,
        Drawdown: 0.035,
        CompoundingAnnualReturn: 0.245,
        ProbabilisticSharpeRatio: 0.85,
        Expectancy: 0.72,
        TotalFees: 18.00,
        Alpha: 0.05,
        Beta: 0.92,
        AnnualStandardDeviation: 0.12,
        AnnualVariance: 0.0144,
        InformationRatio: 1.4,
        TrackingError: 0.03
      },
      ClosedTrades: [
        {
          Symbol: { Value: "EURUSD" },
          EntryTime: "2024-01-02T10:00:00Z",
          EntryPrice: 1.0850,
          ExitTime: "2024-01-02T14:30:00Z",
          ExitPrice: 1.0880,
          Quantity: 100000,
          ProfitLoss: 300.00,
          TotalFees: 2.00,
          MAE: -50.00,
          MFE: 320.00,
          Duration: "04:30:00"
        }
      ]
    },
    Charts: {
      "Strategy Equity": {
        Series: {
          Equity: {
            Name: "Equity",
            Unit: "$",
            Values: [{ x: 1704153600, y: 100000 }, { x: 1704240000, y: 102450.50 }]
          }
        }
      }
    },
    Orders: {
      "1": {
        Id: 1,
        Symbol: { Value: "EURUSD" },
        Price: 1.0850,
        Quantity: 100000,
        Direction: 0,
        Type: 0,
        Status: 3,
        Time: "2024-01-02T10:00:00Z",
        OrderFee: { Value: { Amount: 2.00, Currency: "USD" } },
        Value: 108500
      }
    },
    Statistics: {
      "Total Trades": "12",
      "Win Rate": "66.7%",
      "Sharpe Ratio": "1.95",
      "Drawdown": "3.5%",
      "Net Profit": "$2,450.50"
    },
    RuntimeStatistics: {
      "Equity": "$102,450.50",
      "Fees": "$18.00",
      "Holdings": "$0.00",
      "Net Profit": "$2,450.50",
      "Return": "2.45%",
      "Unrealized": "$0.00",
      "Volume": "$217,000.00"
    }
  };

  it("transforms raw LEAN JSON into typed BacktestResult", () => {
    const req = { strategyName: "TestStrategy", symbol: "EURUSD", startDate: "2024-01-01", endDate: "2024-01-05" };
    const res = parseLeanResults(sampleLeanOutput, "bt_123", req, {
      startedAt: "2024-01-05T00:00:00.000Z",
      completedAt: "2024-01-05T00:01:00.000Z",
      exitCode: 0,
      logs: "Backtest completed"
    });

    expect(res.id).toBe("bt_123");
    expect(res.status).toBe("completed");
    expect(res.durationMs).toBe(60000);
    expect(res.logs).toBe("Backtest completed");
    expect(res.statistics?.totalTrades).toBe(12);
    expect(res.statistics?.winningTrades).toBe(8);
    expect(res.statistics?.losingTrades).toBe(4);
    expect(res.statistics?.winRate).toBeCloseTo(0.6667);
    expect(res.statistics?.sharpeRatio).toBe(1.95);
    expect(res.statistics?.sortinoRatio).toBe(2.80);
    expect(res.statistics?.drawdown).toBe(0.035);
    expect(res.statistics?.netProfit).toBe(2450.50);
    expect(res.statistics?.alpha).toBe(0.05);
    expect(res.statistics?.beta).toBe(0.92);

    expect(res.runtimeStatistics?.equity).toBe(102450.50);
    expect(res.runtimeStatistics?.returnPct).toBeCloseTo(0.0245);
    expect(res.runtimeStatistics?.volume).toBe(217000);

    expect(res.closedTrades).toHaveLength(1);
    expect(res.closedTrades[0].symbol).toBe("EURUSD");
    expect(res.closedTrades[0].profitLoss).toBe(300);
    expect(res.closedTrades[0].mae).toBe(-50);
    expect(res.closedTrades[0].mfe).toBe(320);

    expect(res.orders).toHaveLength(1);
    expect(res.orders[0].direction).toBe("Buy");
    expect(res.orders[0].status).toBe("Filled");
    expect(res.orders[0].type).toBe("Market");
    expect(res.orders[0].fee).toBe(2.00);

    expect(res.charts["Strategy Equity - Equity"]).toBeDefined();
    expect(res.charts["Strategy Equity - Equity"].values).toHaveLength(2);
  });

  it("handles array formatted Orders and string Symbol", () => {
    const rawData = {
      Orders: [
        {
          Id: 2,
          Symbol: "GBPUSD",
          Price: 1.2500,
          Quantity: -50000,
          Direction: 1,
          Type: 1,
          Status: 5,
          Time: "2024-01-02T11:00:00Z"
        }
      ]
    };

    const req = { strategyName: "ArrayOrders", symbol: "GBPUSD", startDate: "2024-01-01", endDate: "2024-01-05" };
    const res = parseLeanResults(rawData, "bt_arr", req);

    expect(res.orders).toHaveLength(1);
    expect(res.orders[0].id).toBe(2);
    expect(res.orders[0].symbol).toBe("GBPUSD");
    expect(res.orders[0].direction).toBe("Sell");
    expect(res.orders[0].type).toBe("Limit");
    expect(res.orders[0].status).toBe("Canceled");
  });

  it("falls back to Statistics dictionary when TotalPerformance is absent", () => {
    const rawData = {
      Statistics: {
        "Total Trades": "7",
        "Win Rate": "71.4%",
        "Loss Rate": "28.6%",
        "Average Win": "1.2%",
        "Average Loss": "-0.6%",
        "Profit-Loss Ratio": "2.0",
        "Compounding Annual Return": "18.5%",
        "Drawdown": "4.1%",
        "Net Profit": "$3,500.00",
        "Sharpe Ratio": "1.75",
        "Sortino Ratio": "2.10",
        "Probabilistic Sharpe Ratio": "79.2%",
        "Expectancy": "0.55",
        "Total Fees": "$14.00"
      }
    };

    const req = { strategyName: "FallbackStats", symbol: "EURUSD", startDate: "2024-01-01", endDate: "2024-01-05" };
    const res = parseLeanResults(rawData, "bt_fb", req);

    expect(res.statistics?.totalTrades).toBe(7);
    expect(res.statistics?.winRate).toBeCloseTo(0.714);
    expect(res.statistics?.lossRate).toBeCloseTo(0.286);
    expect(res.statistics?.drawdown).toBeCloseTo(0.041);
    expect(res.statistics?.netProfit).toBe(3500);
    expect(res.statistics?.sharpeRatio).toBe(1.75);
  });

  it("handles zero-trade backtest results gracefully", () => {
    const req = { strategyName: "EmptyStrategy", symbol: "EURUSD", startDate: "2024-01-01", endDate: "2024-01-05" };
    const res = parseLeanResults({}, "bt_empty", req, { exitCode: 0 });

    expect(res.status).toBe("completed");
    expect(res.statistics?.totalTrades).toBe(0);
    expect(res.orders).toEqual([]);
    expect(res.closedTrades).toEqual([]);
    expect(res.charts).toEqual({});
  });

  it("handles corrupted input JSON gracefully", () => {
    const req = { strategyName: "Corrupted", symbol: "EURUSD", startDate: "2024-01-01", endDate: "2024-01-05" };
    const res = parseLeanResults("{invalid-json", "bt_err", req, { exitCode: 1 });

    expect(res.status).toBe("failed");
    expect(res.error).toMatch(/Failed to parse/);
  });

  it("handles invalid root structure (e.g. primitive number or null)", () => {
    const req = { strategyName: "Null", symbol: "EURUSD", startDate: "2024-01-01", endDate: "2024-01-05" };
    const res = parseLeanResults(null as any, "bt_null", req, { exitCode: 1 });

    expect(res.status).toBe("failed");
    expect(res.error).toMatch(/Failed to parse/);
  });

  it("parses the current LEAN engine output shape (lowerCamel keys)", () => {
    const currentLeanOutput = {
      statistics: {
        "Total Trades": "5",
        "Win Rate": "60.0%",
        "Loss Rate": "40.0%",
        "Drawdown": "2.1%",
        "Net Profit": "$1,200.00",
        "Sharpe Ratio": "1.80"
      },
      runtimeStatistics: {
        "Equity": "$101,200.00",
        "Return": "1.2%"
      },
      totalPerformance: {
        tradeStatistics: {
          totalNumberOfTrades: 5,
          numberOfWinningTrades: 3,
          numberOfLosingTrades: 2,
          winRate: "0.6",
          lossRate: "0.4",
          profitLossRatio: "2.0",
          totalProfitLoss: "1200"
        },
        portfolioStatistics: {
          compoundingAnnualReturn: "0.25",
          drawdown: "0.021",
          sharpeRatio: "1.8",
          sortinoRatio: "2.4",
          probabilisticSharpeRatio: "0.78",
          expectancy: "0.65",
          totalFees: "10",
          alpha: "0.04",
          beta: "0.9",
          annualStandardDeviation: "0.11",
          annualVariance: "0.012",
          informationRatio: "1.3",
          trackingError: "0.02"
        },
        closedTrades: [
          {
            symbol: { value: "EURUSD", id: "EURUSD 8G", permtick: "EURUSD" },
            entryTime: "2024-01-02T10:00:00Z",
            entryPrice: 1.085,
            exitTime: "2024-01-02T14:30:00Z",
            exitPrice: 1.088,
            quantity: 100000,
            profitLoss: 300,
            totalFees: 2,
            mae: -50,
            mfe: 320,
            duration: "04:30:00"
          }
        ]
      },
      charts: {
        "Strategy Equity": {
          name: "Strategy Equity",
          chartType: "Overlay",
          series: {
            Equity: {
              name: "Equity",
              unit: "$",
              seriesType: "Line",
              index: 0,
              values: [
                [1704153600, 100000],
                [1704240000, 102450.5]
              ]
            }
          }
        }
      },
      orders: {
        "1": {
          id: 1,
          symbol: { value: "EURUSD", id: "EURUSD 8G", permtick: "EURUSD" },
          price: 1.085,
          quantity: 100000,
          direction: 0,
          type: 0,
          status: 3,
          time: "2024-01-02T10:00:00Z",
          tag: "",
          value: 108500
        }
      }
    };

    const req = { strategyName: "CurrentShape", symbol: "EURUSD", startDate: "2024-01-01", endDate: "2024-01-05" };
    const res = parseLeanResults(currentLeanOutput, "bt_current", req, { exitCode: 0 });

    expect(res.status).toBe("completed");
    expect(res.statistics?.totalTrades).toBe(5);
    expect(res.statistics?.winningTrades).toBe(3);
    expect(res.statistics?.losingTrades).toBe(2);
    expect(res.statistics?.winRate).toBeCloseTo(0.6);
    expect(res.statistics?.netProfit).toBe(1200);
    expect(res.statistics?.sharpeRatio).toBe(1.8);
    expect(res.statistics?.sortinoRatio).toBe(2.4);
    expect(res.statistics?.drawdown).toBeCloseTo(0.021);
    expect(res.statistics?.compoundingAnnualReturn).toBeCloseTo(0.25);
    expect(res.statistics?.totalFees).toBe(10);
    expect(res.statistics?.alpha).toBeCloseTo(0.04);

    expect(res.runtimeStatistics?.equity).toBe(101200);
    expect(res.runtimeStatistics?.returnPct).toBeCloseTo(0.012);

    expect(res.closedTrades).toHaveLength(1);
    expect(res.closedTrades[0].symbol).toBe("EURUSD");
    expect(res.closedTrades[0].profitLoss).toBe(300);
    expect(res.closedTrades[0].entryPrice).toBe(1.085);

    expect(res.orders).toHaveLength(1);
    expect(res.orders[0].id).toBe(1);
    expect(res.orders[0].symbol).toBe("EURUSD");
    expect(res.orders[0].direction).toBe("Buy");
    expect(res.orders[0].status).toBe("Filled");

    expect(res.charts["Strategy Equity - Equity"]).toBeDefined();
    expect(res.charts["Strategy Equity - Equity"].unit).toBe("$");
    expect(res.charts["Strategy Equity - Equity"].values).toEqual([
      { x: 1704153600, y: 100000 },
      { x: 1704240000, y: 102450.5 }
    ]);
  });
});
