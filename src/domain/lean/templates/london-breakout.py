# region imports
from AlgorithmImports import *
# endregion

class LondonBreakoutStrategy(QCAlgorithm):
    """
    London Session Opening Range Breakout Strategy for Forex.
    
    Identifies high and low of pre-London consolidation (Asian session)
    and trades breakouts during the high-liquidity London morning window.
    
    Parameters:
    - symbol: Forex pair (default: "EURUSD")
    - asian_start_hour: Asian session start in UTC (default: 0)
    - asian_end_hour: Asian session end / breakout trigger start in UTC (default: 7)
    - breakout_end_hour: Breakout window close in UTC (default: 12)
    - buffer_pips: Breakout confirmation buffer in pips (default: 5.0, range: [0.0, 20.0])
    - risk_fraction: Portfolio fraction per trade (default: 0.05, range: [0.01, 0.20])
    - rr_ratio: Risk to reward ratio (default: 1.5, range: [1.0, 4.0])
    """

    def Initialize(self):
        self.SetStartDate(2020, 1, 1)
        self.SetEndDate(2024, 12, 31)
        self.SetCash(100000)

        # Brokerage model with realistic Forex execution, spread, and margin
        self.SetBrokerageModel(BrokerageName.Oanda, AccountType.Margin)

        # Parameters
        self.symbol_name = self.GetParameter("symbol", "EURUSD")
        self.asian_start_hour = int(self.GetParameter("asian_start_hour", 0))
        self.asian_end_hour = int(self.GetParameter("asian_end_hour", 7))
        self.breakout_end_hour = int(self.GetParameter("breakout_end_hour", 12))
        self.buffer_pips = float(self.GetParameter("buffer_pips", 5.0))
        self.risk_fraction = float(self.GetParameter("risk_fraction", 0.05))
        self.rr_ratio = float(self.GetParameter("rr_ratio", 1.5))

        forex = self.AddForex(self.symbol_name, Resolution.Minute, Market.Oanda)
        self.symbol = forex.Symbol
        self.Securities[self.symbol].SetLeverage(50.0)

        self.pip_size = 0.0001 if "JPY" not in self.symbol_name else 0.01

        self.asian_high = None
        self.asian_low = None
        self.traded_today = False
        self.stop_price = 0.0
        self.take_profit = 0.0
        self.current_day = -1

    def OnData(self, data: Slice):
        if not data.ContainsKey(self.symbol) or data[self.symbol] is None:
            return

        bar = data[self.symbol]
        price = bar.Close
        current_time = self.Time
        hour = current_time.hour

        # Reset daily state
        if current_time.day != self.current_day:
            self.current_day = current_time.day
            self.asian_high = None
            self.asian_low = None
            self.traded_today = False
            self.stop_price = 0.0
            self.take_profit = 0.0

        # Asian Session: Build Range
        if self.asian_start_hour <= hour < self.asian_end_hour:
            if self.asian_high is None or bar.High > self.asian_high:
                self.asian_high = bar.High
            if self.asian_low is None or bar.Low < self.asian_low:
                self.asian_low = bar.Low

        holding = self.Portfolio[self.symbol]

        # Manage existing open positions (SL / TP / End of Session Close)
        if holding.Invested:
            if holding.IsLong:
                if price <= self.stop_price:
                    self.Liquidate(self.symbol, "Long SL Hit")
                elif price >= self.take_profit:
                    self.Liquidate(self.symbol, "Long TP Hit")
                elif hour >= 16:  # End of London session close
                    self.Liquidate(self.symbol, "Session End Close")
            elif holding.IsShort:
                if price >= self.stop_price:
                    self.Liquidate(self.symbol, "Short SL Hit")
                elif price <= self.take_profit:
                    self.Liquidate(self.symbol, "Short TP Hit")
                elif hour >= 16:
                    self.Liquidate(self.symbol, "Session End Close")
            return

        # Breakout Window Check
        if not self.traded_today and self.asian_high is not None and self.asian_low is not None:
            if self.asian_end_hour <= hour < self.breakout_end_hour:
                buffer = self.buffer_pips * self.pip_size
                range_size = self.asian_high - self.asian_low

                # Avoid trading unreasonably narrow or wide ranges
                if range_size > 10 * self.pip_size:
                    # Long Breakout
                    if price > (self.asian_high + buffer):
                        self.SetHoldings(self.symbol, self.risk_fraction)
                        self.stop_price = self.asian_low
                        risk = price - self.stop_price
                        self.take_profit = price + (risk * self.rr_ratio)
                        self.traded_today = True

                    # Short Breakout
                    elif price < (self.asian_low - buffer):
                        self.SetHoldings(self.symbol, -self.risk_fraction)
                        self.stop_price = self.asian_high
                        risk = self.stop_price - price
                        self.take_profit = price - (risk * self.rr_ratio)
                        self.traded_today = True
