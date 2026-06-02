"""Kronos K-line prediction sidecar for OpenAlice.

Wraps NeoQuasar/Kronos transformer behind FastAPI. Fetches Binance spot klines,
runs predictor, returns OHLCV forecast as JSON.
"""

import os
import sys
import logging
from pathlib import Path
from typing import Optional

import httpx
import pandas as pd
import uvicorn
from fastapi import FastAPI, HTTPException
from pydantic import BaseModel, Field

HERE = Path(__file__).parent
sys.path.insert(0, str(HERE))
from model import Kronos, KronosTokenizer, KronosPredictor  # noqa: E402

logging.basicConfig(level=logging.INFO, format="%(asctime)s %(levelname)s %(message)s")
log = logging.getLogger("kronos-sidecar")

MODEL_NAME = os.getenv("KRONOS_MODEL", "Kronos-small")
DEVICE = os.getenv("KRONOS_DEVICE", "cpu")
PORT = int(os.getenv("PORT", "8765"))

TOKENIZER_BY_MODEL = {
    "Kronos-mini": "NeoQuasar/Kronos-Tokenizer-2k",
    "Kronos-small": "NeoQuasar/Kronos-Tokenizer-base",
    "Kronos-base": "NeoQuasar/Kronos-Tokenizer-base",
}
MAX_CTX_BY_MODEL = {"Kronos-mini": 2048, "Kronos-small": 512, "Kronos-base": 512}

BINANCE_INTERVAL_MS = {
    "1m": 60_000, "5m": 300_000, "15m": 900_000, "1h": 3_600_000,
    "4h": 14_400_000, "1d": 86_400_000,
}

app = FastAPI()
_predictor: Optional[KronosPredictor] = None


def get_predictor() -> KronosPredictor:
    global _predictor
    if _predictor is None:
        tok_id = TOKENIZER_BY_MODEL[MODEL_NAME]
        max_ctx = MAX_CTX_BY_MODEL[MODEL_NAME]
        log.info(f"loading tokenizer={tok_id} model=NeoQuasar/{MODEL_NAME} device={DEVICE}")
        tokenizer = KronosTokenizer.from_pretrained(tok_id)
        model = Kronos.from_pretrained(f"NeoQuasar/{MODEL_NAME}")
        _predictor = KronosPredictor(model, tokenizer, max_context=max_ctx, device=DEVICE)
        log.info("predictor ready")
    return _predictor


class PredictReq(BaseModel):
    symbol: str = Field(..., description="Binance spot pair, e.g. BTCUSDT")
    interval: str = Field("1h")
    lookback: int = Field(400, ge=64, le=2000)
    pred_len: int = Field(24, ge=1, le=120)
    T: float = Field(1.0, gt=0)
    top_p: float = Field(0.9, gt=0, le=1.0)
    sample_count: int = Field(1, ge=1, le=5)


def fetch_klines(symbol: str, interval: str, limit: int) -> pd.DataFrame:
    url = f"https://api.binance.com/api/v3/klines?symbol={symbol.upper()}&interval={interval}&limit={limit}"
    r = httpx.get(url, timeout=15.0)
    r.raise_for_status()
    rows = r.json()
    df = pd.DataFrame(rows, columns=[
        "open_time", "open", "high", "low", "close", "volume",
        "close_time", "amount", "trades", "taker_buy_base", "taker_buy_quote", "ignore",
    ])
    for c in ("open", "high", "low", "close", "volume", "amount"):
        df[c] = df[c].astype(float)
    df["timestamps"] = pd.to_datetime(df["open_time"], unit="ms", utc=True)
    return df[["timestamps", "open", "high", "low", "close", "volume", "amount"]]


@app.get("/health")
def health():
    return {"ok": True, "model": MODEL_NAME, "device": DEVICE}


@app.post("/predict")
def predict(req: PredictReq):
    if req.interval not in BINANCE_INTERVAL_MS:
        raise HTTPException(400, f"unsupported interval {req.interval}")
    max_ctx = MAX_CTX_BY_MODEL[MODEL_NAME]
    if req.lookback > max_ctx:
        raise HTTPException(400, f"lookback {req.lookback} > model max_context {max_ctx}")

    df = fetch_klines(req.symbol, req.interval, req.lookback)
    if len(df) < req.lookback:
        raise HTTPException(502, f"binance returned {len(df)} bars, expected {req.lookback}")

    step_ms = BINANCE_INTERVAL_MS[req.interval]
    last_ts = df["timestamps"].iloc[-1]
    y_timestamp = pd.Series([
        last_ts + pd.Timedelta(milliseconds=step_ms * (i + 1)) for i in range(req.pred_len)
    ])

    x_df = df[["open", "high", "low", "close", "volume", "amount"]].reset_index(drop=True)
    x_ts = df["timestamps"].reset_index(drop=True)

    try:
        pred = get_predictor().predict(
            df=x_df, x_timestamp=x_ts, y_timestamp=y_timestamp,
            pred_len=req.pred_len, T=req.T, top_p=req.top_p,
            sample_count=req.sample_count, verbose=False,
        )
    except Exception as e:
        log.exception("predict failed")
        raise HTTPException(500, f"kronos predict error: {e}")

    out = []
    for i, ts in enumerate(y_timestamp):
        row = pred.iloc[i]
        out.append({
            "ts": ts.isoformat(),
            "open": float(row["open"]),
            "high": float(row["high"]),
            "low": float(row["low"]),
            "close": float(row["close"]),
            "volume": float(row["volume"]),
        })

    last_close = float(df["close"].iloc[-1])
    forecast_close = out[-1]["close"]
    return {
        "symbol": req.symbol.upper(),
        "interval": req.interval,
        "model": MODEL_NAME,
        "last_observed": {
            "ts": last_ts.isoformat(),
            "close": last_close,
        },
        "forecast": out,
        "summary": {
            "pred_len": req.pred_len,
            "final_close": forecast_close,
            "delta_pct": round((forecast_close - last_close) / last_close * 100, 4),
            "sample_count": req.sample_count,
        },
    }


if __name__ == "__main__":
    get_predictor()  # warm load
    uvicorn.run(app, host="127.0.0.1", port=PORT, log_level="info")
