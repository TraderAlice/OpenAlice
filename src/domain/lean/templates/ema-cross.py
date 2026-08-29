# region imports
from AlgorithmImports import *
# endregion

class EmaCrossStrategy(QCAlgorithm):
    """
    Exponential Moving Average Cross Strategy with ATR Trailing Stop.
    
    Parameters:
    - symbol: Forex pair (default: "EURUSD")
    - fast_period: Fast EMA lookback (default: 12, range: [5, 50])
    - slow_period: Slow EMA lookback (default: 26, range: [20, 200])
    - atr_period: ATR volatility lookback (default: 14, range: [7, 30])
    - atr_multiplier: ATR stop multiplier (default: 2.0, range: [1.0, 5.0])
    - risk_fraction: Portfolio fraction per trade (default: 0.05, range: [0.01, 0.20])
    """

    def Initialize(self):
        self.SetStartDate(2020, 1, 1)
        self.SetEndDate(2024, 12, 31)
        self.SetCash(100000)

        # Brokerage model with realistic Forex execution, spread, and margin
        self.SetBrokerageModel(BrokerageName.Oanda, AccountType.Margin)

        # Parameters
        self.symbol_name = self.GetParameter("symbol", "EURUSD")
        self.fast_period = int(self.GetParameter("fast_period", 12))
        self.slow_period = int(self.GetParameter("slow_period", 26))
        self.atr_period = int(self.GetParameter("atr_period", 14))
        self.atr_multiplier = float(self.GetParameter("atr_multiplier", 2.0))
        self.risk_fraction = float(self.GetParameter("risk_fraction", 0.05))

        # Add Forex security with 50:1 leverage
        forex = self.AddForex(self.symbol_name, Resolution.Minute, Market.Oanda)
        self.symbol = forex.Symbol
        self.Securities[self.symbol].SetLeverage(50.0)

        # Indicators
        self.fast_ema = self.EMA(self.symbol, self.fast_period, Resolution.Minute)
        self.slow_ema = self.EMA(self.symbol, self.slow_period, Resolution.Minute)
        self.atr = self.ATR(self.symbol, self.atr_period, MovingAverageType.Simple, Resolution.Minute)

        self.stop_price = 0.0
        self.SetWarmUp(max(self.slow_period, self.atr_period) + 1)

    def OnData(self, data: Slice):
        if self.IsWarmingUp or not self.fast_ema.IsReady or not self.slow_ema.IsReady or not self.atr.IsReady:
            return

        if not data.ContainsKey(self.symbol) or data[self.symbol] is None:
            return

        price = data[self.symbol].Close
        holding = self.Portfolio[self.symbol]
        atr_val = self.atr.Current.Value

        # Stop loss check
        if holding.Invested:
            if holding.IsLong and price < self.stop_price:
                self.Liquidate(self.symbol, "Long Stop Loss Triggered")
                self.stop_price = 0.0
                return
            elif holding.IsShort and price > self.stop_price:
                self.Liquidate(self.symbol, "Short Stop Loss Triggered")
                self.stop_price = 0.0
                return

        # Bullish Crossover
        if self.fast_ema.Current.Value > self.slow_ema.Current.Value:
            if not holding.IsLong:
                if holding.IsShort:
                    self.Liquidate(self.symbol, "Reverse Short to Long")
                self.SetHoldings(self.symbol, self.risk_fraction)
                self.stop_price = price - (atr_val * self.atr_multiplier)
            else:
                # Trail stop loss
                new_stop = price - (atr_val * self.atr_multiplier)
                if new_stop > self.stop_price:
                    self.stop_price = new_stop

        # Bearish Crossover
        elif self.fast_ema.Current.Value < self.slow_ema.Current.Value:
            if not holding.IsShort:
                if holding.IsLong:
                    self.Liquidate(self.symbol, "Reverse Long to Short")
                self.SetHoldings(self.symbol, -self.risk_fraction)
                self.stop_price = price + (atr_val * self.atr_multiplier)
            else:
                # Trail stop loss
                new_stop = price + (atr_val * self.atr_multiplier)
                if new_stop < self.stop_price:
                    self.stop_price = new_stop
