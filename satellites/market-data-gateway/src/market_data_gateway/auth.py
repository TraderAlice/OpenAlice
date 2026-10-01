"""Bearer / query-token authentication."""

from __future__ import annotations

from fastapi import HTTPException, Query, Request, status
from fastapi.security import HTTPAuthorizationCredentials, HTTPBearer

_bearer = HTTPBearer(auto_error=False)


def _token_ok(provided: str | None, expected: str) -> bool:
    if not expected:
        return True
    return bool(provided) and provided == expected


async def require_token(
    request: Request,
    credentials: HTTPAuthorizationCredentials | None = None,
    token: str | None = Query(default=None, description="Optional token for RSS clients"),
) -> None:
    # Resolve HTTPBearer manually so tests can call routes without wiring security deps twice.
    if credentials is None:
        credentials = await _bearer(request)

    settings = getattr(request.app.state, "settings", None)
    expected = ""
    if settings is not None:
        expected = (getattr(settings, "gateway_token", "") or "").strip()

    provided: str | None = None
    if credentials and credentials.scheme.lower() == "bearer":
        provided = credentials.credentials
    if not provided:
        provided = token
    if not provided:
        provided = request.headers.get("X-Gateway-Token")

    if not _token_ok(provided, expected):
        raise HTTPException(
            status_code=status.HTTP_401_UNAUTHORIZED,
            detail="Invalid or missing gateway token",
            headers={"WWW-Authenticate": "Bearer"},
        )
