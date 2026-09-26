from tushare_mcp.client import normalize_ts_code, TushareError
import pytest


def test_normalize_full_code() -> None:
    assert normalize_ts_code("600000.sh") == "600000.SH"


def test_normalize_bare_sh() -> None:
    assert normalize_ts_code("600000") == "600000.SH"


def test_normalize_bare_sz() -> None:
    assert normalize_ts_code("000001") == "000001.SZ"


def test_normalize_rejects_empty() -> None:
    with pytest.raises(TushareError) as ei:
        normalize_ts_code(" ")
    assert ei.value.code == "invalid_ts_code"
