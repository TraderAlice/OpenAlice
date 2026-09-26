from __future__ import annotations

import argparse
import json
import sys

from .client import TushareClient, TushareError


def main(argv: list[str] | None = None) -> int:
    parser = argparse.ArgumentParser(description="Optional live smoke against Tushare Pro")
    parser.add_argument("--ts-code", default="600000.SH")
    parser.add_argument("--skip-network", action="store_true", help="Only check local health/token")
    args = parser.parse_args(argv)

    client = TushareClient()
    print(json.dumps(client.health(), ensure_ascii=False, indent=2))
    if args.skip_network:
        return 0 if client.settings.token else 2

    try:
        for name, fn in (
            ("income", lambda: client.income_statement(args.ts_code, limit=2)),
            ("balance", lambda: client.balance_sheet(args.ts_code, limit=2)),
            ("cash", lambda: client.cash_flow(args.ts_code, limit=2)),
            ("daily", lambda: client.daily_bar(args.ts_code, limit=3)),
        ):
            payload = fn()
            print(f"\n# {name} count={payload.get('count')}")
            print(json.dumps(payload, ensure_ascii=False, indent=2)[:2000])
    except TushareError as exc:
        print(json.dumps(exc.as_dict(), ensure_ascii=False, indent=2), file=sys.stderr)
        return 1
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
