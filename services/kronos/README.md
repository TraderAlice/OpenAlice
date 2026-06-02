# Kronos sidecar

FastAPI service wrapping NeoQuasar Kronos K-line transformer for OpenAlice tool integration.

## Setup

```bash
cd services/kronos
# vendor Kronos model code (one-time)
git clone --depth 1 https://github.com/shiyu-coder/Kronos.git _kronos_repo
cp -r _kronos_repo/model ./model
(cd _kronos_repo && git rev-parse HEAD) > KRONOS_COMMIT
rm -rf _kronos_repo

# venv + deps
uv venv .venv
source .venv/bin/activate
uv pip install -r requirements.txt

# run
KRONOS_DEVICE=mps KRONOS_MODEL=Kronos-small PORT=8765 python server.py
```

## Endpoints

- `GET /health` → `{ok: true, model, device}`
- `POST /predict` → body `{symbol, interval?, lookback?, pred_len?, T?, top_p?, sample_count?}` → predicted OHLCV array

Models: `Kronos-mini` (4.1M, ctx 2048, tokenizer-2k), `Kronos-small` (24.7M, ctx 512, tokenizer-base), `Kronos-base` (102M, ctx 512, tokenizer-base).

## launchd

```bash
cp launchd/com.openalice.kronos.plist ~/Library/LaunchAgents/
launchctl load -w ~/Library/LaunchAgents/com.openalice.kronos.plist
```
