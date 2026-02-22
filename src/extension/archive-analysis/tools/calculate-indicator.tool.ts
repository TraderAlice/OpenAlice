import { IndicatorCalculator, FunctionContext } from './indicators';
import type { IMarketDataProvider } from '../data/interfaces';

/**
 * Context for calculating technical indicators
 */
export interface CalculateIndicatorContext {
  currentTime: Date;
  dataProvider: IMarketDataProvider;
  /** Calculate start time based on lookback */
  calculatePreviousTime: (lookback: number) => Date;
}

/**
 * Calculate technical indicators using formula expressions
 *
 * Supports SMA, EMA, RSI, BBANDS, MACD, ATR and other indicators
 *
 * @example
 * // Calculate 20-period moving average
 * calculateIndicator(ctx, "SMA(CLOSE('BTC/USD', 100), 20)")
 *
 * // Calculate RSI
 * calculateIndicator(ctx, "RSI(CLOSE('BTC/USD', 50), 14)")
 */
export async function calculateIndicator(
  ctx: CalculateIndicatorContext,
  formula: string,
): Promise<number | number[] | Record<string, number>> {
  // Create function context
  const context: FunctionContext = {
    getHistoricalData: async (symbol: string, lookback: number) => {
      // Calculate start time
      const endTime = ctx.currentTime;
      const startTime = ctx.calculatePreviousTime(lookback);

      // Use dataProvider's getMarketDataRange to fetch historical data
      return await ctx.dataProvider.getMarketDataRange(
        startTime,
        endTime,
        symbol,
      );
    },
  };

  // Create calculator and execute
  const calculator = new IndicatorCalculator(context, ctx.currentTime);
  return await calculator.calculate(formula);
}
