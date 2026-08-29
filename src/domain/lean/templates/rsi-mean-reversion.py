# region imports
from AlgorithmImports import *
# endregion

class RsiMeanReversionStrategy(QCAlgorithm):
    """
    RSI & Bollinger Bands Mean Reversion Strategy for Forex.
    
    Identifies short-term statistical extremes when price deviates outside
    Bollinger Bands and RSI is oversold/overbought, targeting mean reversion.
    
    Parameters:
    - symbol: Forex pair (default: "EURUSD")
    - rsi_period: RSI indicator lookback (default: 14, range: [5, 30])
    - rsi_oversold: RSI oversold threshold (default: 30, range: [15, 40])
    - rsi_overbought: RSI overbought threshold (default: 70, range: [60, 85])
    - bb_period: Bollinger Bands period (default: 20, range: [10, 50])
    - bb_std: Bollinger Bands standard deviations (default: 2.0, range: [1.5, 3.0])
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
        self.rsi_period = int(self.GetParameter("rsi_period", 14))
        self.rsi_oversold = float(self.GetParameter("rsi_oversold", 30))
        self.rsi_overbought = float(self.GetParameter("rsi_overbought", 70))
        self.bb_period = int(self.GetParameter("bb_period", 20))
        self.bb_std = float(self.GetParameter("bb_std", 2.0))
        self.risk_fraction = float(self.GetParameter("risk_fraction", 0.05))

        forex = self.AddForex(self.symbol_name, Resolution.Minute, Market.Oanda)
        self.symbol = forex.Symbol
        self.Securities[self.symbol].SetLeverage(50.0)

        self.rsi = self.RSI(self.symbol, self.rsi_period, MovingAverageType.Wilders, Resolution.Minute)
        self.bb = self.BB(self.symbol, self.bb_period, self.bb_std, MovingAverageType.Simple, Resolution.Minute)

        self.SetWarmUp(max(self.rsi_period, self.bb_period) + 1)

    def OnData(self, data: Slice):
        if self.IsWarmingUp or not self.rsi.IsReady or not self.bb.IsReady:
            return

        if not data.ContainsKey(self.symbol) or data[self.symbol] is None:
            return

        price = data[self.symbol].Close
        rsi_val = self.rsi.Current.Value
        bb_upper = self.bb.UpperBand.Current.Value
        bb_lower = self.bb.LowerBand.Current.Value
        bb_middle = self.bb.MiddleBand.Current.Value

        holding = self.Portfolio[self.symbol]

        # Exit conditions: Mean reached or opposite extreme
        if holding.Invested:
            if holding.IsLong:
                if price >= bb_middle or rsi_val >= 50:
                    self.Liquidate(self.symbol, "Long Mean Reversion Target Reached")
            elif holding.IsShort:
                if price <= bb_middle or rsi_val <= 50:
                    self.Liquidate(self.symbol, "Short Mean Reversion Target Reached")
            return

        # Entry conditions
        # Long: Price below lower band and RSI oversold
        if price < bb_lower and rsi_val < self.rsi_oversold:
            self.SetHoldings(self.symbol, self.risk_fraction)

        # Short: Price above upper band and RSI overbought
        elif price > bb_upper and rsi_val > self.rsi_overbought:
            self.SetHoldings(self.symbol, -self.risk_fraction)
