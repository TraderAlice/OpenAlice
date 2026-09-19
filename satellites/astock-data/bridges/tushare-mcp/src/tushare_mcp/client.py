from __future__ import annotations

from datetime import datetime, timezone
from typing import Any

import pandas as pd

from .config import RateLimiter, Settings, TtlCache, load_settings

# Slim columns for LLM-friendly payloads (Tushare names → output names).
INCOME_COLUMNS = {
    "ts_code": "ts_code",
    "ann_date": "ann_date",
    "end_date": "end_date",
    "revenue": "revenue",
    "operate_profit": "operate_profit",
    "total_profit": "total_profit",
    "n_income": "n_income",
    "n_income_attr_p": "n_income_attr_p",
    "basic_eps": "basic_eps",
}

BALANCE_COLUMNS = {
    "ts_code": "ts_code",
    "ann_date": "ann_date",
    "end_date": "end_date",
    "total_assets": "total_assets",
    "total_liab": "total_liab",
    "total_hldr_eqy_exc_min_int": "total_equity_ex_min",
    "total_hldr_eqy_inc_min_int": "total_equity_inc_min",
    "money_cap": "money_cap",
    "accounts_receiv": "accounts_receivable",
    "inventories": "inventories",
}

CASHFLOW_COLUMNS = {
    "ts_code": "ts_code",
    "ann_date": "ann_date",
    "end_date": "end_date",
    "n_cashflow_act": "cfo",
    "n_cashflow_inv_act": "cfi",
    "n_cash_flows_fnc_act": "cff",
    "n_incr_cash_cash_equ": "net_cash_change",
    "c_cash_equ_end_period": "cash_end",
}

MARGIN_COLUMNS = {
    "trade_date": "trade_date",
    "ts_code": "ts_code",
    "rzye": "financing_balance",
    "rzmre": "financing_buy",
    "rzche": "financing_repay",
    "rqye": "securities_balance",
    "rqmcl": "securities_sell_vol",
    "rzrqye": "margin_balance_total",
}

FUND_HOLD_COLUMNS = {
    "ts_code": "fund_code",
    "ann_date": "ann_date",
    "end_date": "end_date",
    "symbol": "stock_code",
    "mkv": "market_value",
    "amount": "shares",
    "stk_mkv_ratio": "pct_of_fund_nav",
    "stk_float_ratio": "pct_of_float",
}

# Tushare daily: vol = 手 (lot), amount = 千元.
DAILY_COLUMNS = {
    "ts_code": "ts_code",
    "trade_date": "trade_date",
    "open": "open",
    "high": "high",
    "low": "low",
    "close": "close",
    "pre_close": "pre_close",
    "change": "change",
    "pct_chg": "pct_chg",
    "vol": "volume",
    "amount": "amount",
}


class TushareError(RuntimeError):
    def __init__(self, code: str, message: str) -> None:
        super().__init__(message)
        self.code = code
        self.message = message

    def as_dict(self) -> dict[str, Any]:
        return {"ok": False, "error": {"code": self.code, "message": self.message}}


class TushareClient:
    def __init__(self, settings: Settings | None = None) -> None:
        self.settings = settings or load_settings()
        self._limiter = RateLimiter(self.settings.min_interval_sec)
        self._cache = TtlCache(self.settings.cache_ttl_sec)
        self._daily_cache = TtlCache(self.settings.daily_cache_ttl_sec)
        self._pro = None

    def health(self) -> dict[str, Any]:
        return {
            "ok": True,
            "service": "tushare-mcp",
            "source": "tushare",
            "tushare_ready": self.settings.token is not None,
            "http_url": self.settings.http_url or "tushare.pro (sdk default)",
            "as_of": _now_iso(),
            "cache_ttl_sec": self.settings.cache_ttl_sec,
            "daily_cache_ttl_sec": self.settings.daily_cache_ttl_sec,
            "min_interval_sec": self.settings.min_interval_sec,
        }

    def income_statement(
        self,
        ts_code: str,
        *,
        start_date: str | None = None,
        end_date: str | None = None,
        period: str | None = None,
        limit: int | None = None,
    ) -> dict[str, Any]:
        return self._statement(
            api="income",
            ts_code=ts_code,
            column_map=INCOME_COLUMNS,
            start_date=start_date,
            end_date=end_date,
            period=period,
            limit=limit or self.settings.statement_limit,
        )

    def balance_sheet(
        self,
        ts_code: str,
        *,
        start_date: str | None = None,
        end_date: str | None = None,
        period: str | None = None,
        limit: int | None = None,
    ) -> dict[str, Any]:
        return self._statement(
            api="balancesheet",
            ts_code=ts_code,
            column_map=BALANCE_COLUMNS,
            start_date=start_date,
            end_date=end_date,
            period=period,
            limit=limit or self.settings.statement_limit,
        )

    def cash_flow(
        self,
        ts_code: str,
        *,
        start_date: str | None = None,
        end_date: str | None = None,
        period: str | None = None,
        limit: int | None = None,
    ) -> dict[str, Any]:
        return self._statement(
            api="cashflow",
            ts_code=ts_code,
            column_map=CASHFLOW_COLUMNS,
            start_date=start_date,
            end_date=end_date,
            period=period,
            limit=limit or self.settings.statement_limit,
        )

    def daily_bar(
        self,
        ts_code: str,
        *,
        trade_date: str | None = None,
        start_date: str | None = None,
        end_date: str | None = None,
        limit: int | None = None,
    ) -> dict[str, Any]:
        """Daily OHLCV (开高低收量). volume unit = 手; amount unit = 千元."""
        code = normalize_ts_code(ts_code)
        lim = limit or self.settings.daily_limit
        cache_key = f"daily|{code}|{trade_date}|{start_date}|{end_date}|{lim}"
        cached = self._daily_cache.get(cache_key)
        if cached is not None:
            return {**cached, "cache_hit": True}

        kwargs: dict[str, Any] = {"ts_code": code}
        if trade_date:
            kwargs["trade_date"] = _digits_date(trade_date)
        if start_date:
            kwargs["start_date"] = _digits_date(start_date)
        if end_date:
            kwargs["end_date"] = _digits_date(end_date)
        if not trade_date and not start_date and not end_date:
            # Default: recent window so a bare ts_code still returns bars.
            end = datetime.now(timezone.utc).strftime("%Y%m%d")
            kwargs["end_date"] = end
            kwargs["start_date"] = _shift_days(end, -40)

        df = self._call("daily", kwargs)
        rows = dataframe_to_records(df, DAILY_COLUMNS, lim)
        for row in rows:
            raw = row.get("trade_date")
            if isinstance(raw, str) and len(raw) == 8 and raw.isdigit():
                row["trade_date_iso"] = f"{raw[0:4]}-{raw[4:6]}-{raw[6:8]}"
        payload = _ok_payload(code, "daily", rows)
        payload["units"] = {
            "price": "CNY per share",
            "volume": "lot (手); typically 1手=100股 for A-shares — not share count",
            "amount": "thousand CNY (千元)",
        }
        self._daily_cache.set(cache_key, payload)
        return {**payload, "cache_hit": False}

    def margin_detail(
        self,
        ts_code: str,
        *,
        start_date: str | None = None,
        end_date: str | None = None,
        limit: int | None = None,
    ) -> dict[str, Any]:
        code = normalize_ts_code(ts_code)
        lim = limit or self.settings.margin_limit
        cache_key = f"margin|{code}|{start_date}|{end_date}|{lim}"
        cached = self._cache.get(cache_key)
        if cached is not None:
            return {**cached, "cache_hit": True}

        kwargs: dict[str, Any] = {"ts_code": code}
        if start_date:
            kwargs["start_date"] = _digits_date(start_date)
        if end_date:
            kwargs["end_date"] = _digits_date(end_date)

        df = self._call("margin_detail", kwargs)
        rows = dataframe_to_records(df, MARGIN_COLUMNS, lim)
        payload = _ok_payload(code, "margin_detail", rows)
        self._cache.set(cache_key, payload)
        return {**payload, "cache_hit": False}

    def funds_holding_stock(
        self,
        ts_code: str,
        *,
        start_date: str | None = None,
        end_date: str | None = None,
        period: str | None = None,
        limit: int | None = None,
    ) -> dict[str, Any]:
        """Semantic A: which mutual funds hold this stock."""
        code = normalize_ts_code(ts_code)
        lim = limit or self.settings.fund_limit
        cache_key = f"fund_hold|{code}|{start_date}|{end_date}|{period}|{lim}"
        cached = self._cache.get(cache_key)
        if cached is not None:
            return {**cached, "cache_hit": True}

        # Tushare fund_portfolio: symbol filters by stock code.
        kwargs: dict[str, Any] = {"symbol": code}
        if start_date:
            kwargs["start_date"] = _digits_date(start_date)
        if end_date:
            kwargs["end_date"] = _digits_date(end_date)
        if period:
            kwargs["period"] = _digits_date(period)

        df = self._call("fund_portfolio", kwargs)
        rows = dataframe_to_records(df, FUND_HOLD_COLUMNS, lim)
        payload = _ok_payload(code, "funds_holding_stock", rows)
        self._cache.set(cache_key, payload)
        return {**payload, "cache_hit": False}

    def _statement(
        self,
        *,
        api: str,
        ts_code: str,
        column_map: dict[str, str],
        start_date: str | None,
        end_date: str | None,
        period: str | None,
        limit: int,
    ) -> dict[str, Any]:
        code = normalize_ts_code(ts_code)
        cache_key = f"{api}|{code}|{start_date}|{end_date}|{period}|{limit}"
        cached = self._cache.get(cache_key)
        if cached is not None:
            return {**cached, "cache_hit": True}

        kwargs: dict[str, Any] = {"ts_code": code}
        if start_date:
            kwargs["start_date"] = _digits_date(start_date)
        if end_date:
            kwargs["end_date"] = _digits_date(end_date)
        if period:
            kwargs["period"] = _digits_date(period)

        df = self._call(api, kwargs)
        rows = dataframe_to_records(df, column_map, limit)
        payload = _ok_payload(code, api, rows)
        self._cache.set(cache_key, payload)
        return {**payload, "cache_hit": False}

    def _pro_api(self) -> Any:
        if self._pro is not None:
            return self._pro
        if not self.settings.token:
            raise TushareError(
                "missing_token",
                "TUSHARE_TOKEN is not set. Export it before starting the MCP server.",
            )
        try:
            import tushare as ts
        except ImportError as exc:
            raise TushareError("import_error", "tushare package is not installed") from exc
        self._pro = ts.pro_api(self.settings.token)
        # Some short-lived reseller gateways require the private DataApi URL
        # override (same pattern as their sample: pro._DataApi__http_url = ...).
        if self.settings.http_url:
            self._pro._DataApi__token = self.settings.token
            self._pro._DataApi__http_url = self.settings.http_url
        return self._pro

    def _call(self, api_name: str, kwargs: dict[str, Any]) -> pd.DataFrame:
        pro = self._pro_api()
        method = getattr(pro, api_name, None)
        if method is None:
            raise TushareError("unknown_api", f"Tushare pro has no method {api_name!r}")
        self._limiter.wait()
        try:
            df = method(**kwargs)
        except Exception as exc:  # noqa: BLE001 — surface Tushare/network errors to MCP
            text = str(exc)
            lower = text.lower()
            if "积分" in text or "point" in lower or "permission" in lower:
                raise TushareError("quota_or_permission", text) from exc
            raise TushareError("tushare_call_failed", text) from exc
        if df is None:
            return pd.DataFrame()
        if not isinstance(df, pd.DataFrame):
            raise TushareError("unexpected_payload", f"{api_name} returned non-DataFrame")
        return df


def normalize_ts_code(raw: str) -> str:
    code = (raw or "").strip().upper()
    if not code:
        raise TushareError("invalid_ts_code", "ts_code is required")
    if "." in code:
        return code
    # Bare A-share codes → exchange suffix.
    if len(code) == 6 and code.isdigit():
        if code.startswith(("5", "6", "9")):
            return f"{code}.SH"
        return f"{code}.SZ"
    raise TushareError(
        "invalid_ts_code",
        "Use Tushare codes like 600000.SH / 000001.SZ (or a 6-digit bare code).",
    )


def dataframe_to_records(
    df: pd.DataFrame,
    column_map: dict[str, str],
    limit: int,
) -> list[dict[str, Any]]:
    if df.empty:
        return []
    present = [src for src in column_map if src in df.columns]
    if not present:
        # Fall back to a small slice of whatever columns exist.
        slim = df.head(limit).where(pd.notnull(df), None)
        return slim.to_dict(orient="records")  # type: ignore[return-value]
    slim = df.loc[:, present].head(limit).copy()
    slim = slim.rename(columns={k: column_map[k] for k in present})
    slim = slim.where(pd.notnull(slim), None)
    records = slim.to_dict(orient="records")
    return [_jsonable_row(row) for row in records]


def _jsonable_row(row: dict[str, Any]) -> dict[str, Any]:
    out: dict[str, Any] = {}
    for key, value in row.items():
        if hasattr(value, "item"):
            try:
                value = value.item()
            except Exception:  # noqa: BLE001
                value = str(value)
        if isinstance(value, float) and value != value:  # NaN
            value = None
        out[key] = value
    return out


def _ok_payload(ts_code: str, dataset: str, rows: list[dict[str, Any]]) -> dict[str, Any]:
    return {
        "ok": True,
        "source": "tushare",
        "dataset": dataset,
        "ts_code": ts_code,
        "as_of": _now_iso(),
        "count": len(rows),
        "rows": rows,
        "disclaimer": (
            "Data from Tushare Pro for personal research only; "
            "not exchange direct feed; not investment advice."
        ),
    }


def _digits_date(value: str) -> str:
    digits = "".join(ch for ch in value.strip() if ch.isdigit())
    if len(digits) not in (6, 8):
        raise TushareError(
            "invalid_date",
            f"Dates must look like YYYYMMDD or YYYY-MM-DD (got {value!r}).",
        )
    return digits


def _shift_days(yyyymmdd: str, delta_days: int) -> str:
    from datetime import timedelta

    base = datetime.strptime(yyyymmdd, "%Y%m%d").replace(tzinfo=timezone.utc)
    return (base + timedelta(days=delta_days)).strftime("%Y%m%d")


def _now_iso() -> str:
    return datetime.now(timezone.utc).replace(microsecond=0).isoformat()
