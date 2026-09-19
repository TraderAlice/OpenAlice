# astock-data (satellite)

OpenAlice **satellite** for A-share research data. It is **not** part of the
Node/pnpm build graph (`pnpm-workspace` / Turbo ignore this tree).

Phase 0 ships a **Tushare-only MCP bridge**: income statement, balance sheet,
cash flow, daily OHLCV bars, margin detail, and fund holders of a stock
(stock → funds).

Future crawlers (e.g. cninfo) belong under `crawlers/` as separate processes.
Agents should keep calling MCP/read APIs — never the crawler control plane.

## Layout

```text
astock-data/
├── README.md
├── bridges/
│   └── tushare-mcp/     # this phase
└── crawlers/            # reserved (empty for now)
```

## Tushare MCP (`bridges/tushare-mcp`)

### Prerequisites

- Python `>=3.11`
- A [Tushare Pro](https://tushare.pro) token with enough积分 for the APIs you call
- Environment variable `TUSHARE_TOKEN` (never commit the token)
- Optional `TUSHARE_HTTP_URL` for a non-official Tushare HTTP gateway
  (example: a 3-day reseller endpoint). Leave unset to use the SDK default.

### Install

```powershell
cd D:\Developer\openalice\satellites\astock-data\bridges\tushare-mcp
python -m venv .venv
.\.venv\Scripts\Activate.ps1
pip install -e .
```

### Run (stdio MCP)

```powershell
$env:TUSHARE_TOKEN = "your_token_here"
$env:TUSHARE_HTTP_URL = "https://tuaremax.top"  # required for some 3-day reseller tokens
python -m tushare_mcp
```

### Tools

| Tool | Meaning |
|------|---------|
| `health` | Process + whether `TUSHARE_TOKEN` is set (does not print the token) |
| `income_statement` | 利润表 |
| `balance_sheet` | 资产负债表 |
| `cash_flow` | 现金流量表 |
| `daily_bar` | 日行情 OHLCV（开高低收、成交量；量单位为「手」） |
| `margin_detail` | 融资融券明细 |
| `funds_holding_stock` | 持有该股票的公募基金（语义 A：股票 → 基金） |

Stock codes use Tushare style: `600000.SH`, `000001.SZ`.

### OpenAlice / Cursor MCP config example

Point the MCP command at this venv’s Python. Example Cursor/OpenAlice MCP entry:

```json
{
  "mcpServers": {
    "astock-tushare": {
      "command": "D:\\Developer\\openalice\\satellites\\astock-data\\bridges\\tushare-mcp\\.venv\\Scripts\\python.exe",
      "args": ["-m", "tushare_mcp"],
      "env": {
        "TUSHARE_TOKEN": "${env:TUSHARE_TOKEN}",
        "TUSHARE_HTTP_URL": "${env:TUSHARE_HTTP_URL}"
      }
    }
  }
}
```

Prefer injecting the token from the user environment or a local secrets store,
not from a tracked file.

### Smoke (optional, needs network + token)

```powershell
$env:TUSHARE_TOKEN = "your_token_here"
python -m tushare_mcp.smoke --ts-code 600000.SH
```

### Disclaimer

Data comes from **Tushare**, not exchange direct feeds. For personal research
only; not investment advice. Respect Tushare rate limits and terms of use.
