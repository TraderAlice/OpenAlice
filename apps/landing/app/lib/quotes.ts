export interface Quote {
  sym: string;
  px: string;
  chg: string;
  isDown: boolean;
}

// Stooq covers stocks, ETFs, forex, and crypto under one CSV API.
// No API key, no UA gymnastics, batch mode is broken so we fan out per symbol.
const TICKERS: { sym: string; stooq: string; dp: number }[] = [
  { sym: "AAPL",    stooq: "aapl.us", dp: 2 },
  { sym: "BTC",     stooq: "btcusd",  dp: 0 },
  { sym: "NVDA",    stooq: "nvda.us", dp: 2 },
  { sym: "ETH",     stooq: "eth.v",   dp: 0 },
  { sym: "SPY",     stooq: "spy.us",  dp: 2 },
  { sym: "TSLA",    stooq: "tsla.us", dp: 2 },
  { sym: "EUR/USD", stooq: "eurusd",  dp: 4 },
  { sym: "XLE",     stooq: "xle.us",  dp: 2 },
  { sym: "GLD",     stooq: "gld.us",  dp: 2 },
  { sym: "SOL",     stooq: "sol.v",   dp: 2 },
];

function formatPrice(px: number, dp: number): string {
  if (px >= 1000) {
    return px.toLocaleString("en-US", { maximumFractionDigits: 0 });
  }
  return px.toLocaleString("en-US", {
    minimumFractionDigits: dp,
    maximumFractionDigits: dp,
  });
}

function formatChange(pct: number): string {
  const sign = pct < 0 ? "−" : "+"; // U+2212 minus, kerns nicer than hyphen
  return `${sign}${Math.abs(pct).toFixed(2)}%`;
}

async function fetchQuote(
  stooq: string,
  sym: string,
  dp: number,
): Promise<Quote | null> {
  try {
    const res = await fetch(
      `https://stooq.com/q/l/?s=${stooq}&f=sd2t2cp&h&e=csv`,
      { next: { revalidate: 60 } },
    );
    if (!res.ok) return null;
    const text = await res.text();
    // CSV: header row + one data row. Last column = previous close.
    const row = text.trim().split("\n")[1]?.split(",");
    if (!row || row.length < 5) return null;
    const close = parseFloat(row[3]);
    const prev = parseFloat(row[4]);
    if (!isFinite(close) || !isFinite(prev) || prev === 0) return null;
    const pct = ((close - prev) / prev) * 100;
    return {
      sym,
      px: formatPrice(close, dp),
      chg: formatChange(pct),
      isDown: pct < 0,
    };
  } catch {
    return null;
  }
}

export async function getQuotes(): Promise<Quote[]> {
  const results = await Promise.all(
    TICKERS.map((t) => fetchQuote(t.stooq, t.sym, t.dp)),
  );
  return results.filter((q): q is Quote => q !== null);
}
