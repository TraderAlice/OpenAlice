/**
 * Error classes for OpenTypeBB.
 * Maps to: openbb_core/app/model/abstract/error.py
 *          openbb_core/provider/utils/errors.py
 */

/** Base error for all OpenBB errors. */
export class OpenBBError extends Error {
  readonly original?: unknown

  constructor(message: string, original?: unknown) {
    super(message)
    this.name = 'OpenBBError'
    this.original = original
  }
}

/** Raised when a query returns no data. */
export class EmptyDataError extends OpenBBError {
  constructor(message = 'No data found.') {
    super(message)
    this.name = 'EmptyDataError'
  }
}

/** Raised when credentials are missing or invalid. */
export class UnauthorizedError extends OpenBBError {
  constructor(message = 'Unauthorized.') {
    super(message)
    this.name = 'UnauthorizedError'
  }
}

/**
 * No HTTP response was received. The legacy error code is retained, but a
 * connection closing does not establish whether the network or provider is
 * responsible: servers and intermediaries can also close requests.
 */
export class NetworkUnreachableError extends OpenBBError {
  readonly host: string

  constructor(host: string, cause: string, original?: unknown) {
    super(
      `NETWORK_UNREACHABLE: no HTTP response from ${host} (${cause}). ` +
      `The cause may be the network/proxy or the remote service closing the connection; ` +
      `this error alone does not identify which.`,
      original,
    )
    this.name = 'NetworkUnreachableError'
    this.host = host
  }
}

/**
 * Raised when a data provider refused to serve THIS client rather than
 * returning data — most commonly HTTP 429 ("Too Many Requests"), but also a
 * 401/403 + crumb/cookie/consent failure that is itself a symptom of the
 * provider fingerprint-blocking an unofficial client (e.g. Yahoo throttles the
 * yfinance-style crumb handshake, so even auth fails behind a 429).
 *
 * The distinction from EmptyDataError is the whole point (see issue #375): the
 * symbol is NOT missing data — the request was rejected before any data came
 * back. Masking this as "no historical data" sent agents down the wrong path,
 * treating a transient, client-side-fixable block as a delisted/empty symbol.
 * The message states the cause and the remedies explicitly so the agent retries
 * later or switches source instead of giving up on the symbol.
 */
export class RateLimitedError extends OpenBBError {
  readonly provider: string
  readonly symbol?: string
  readonly status?: number

  constructor(
    provider: string,
    detail: string,
    opts: { symbol?: string; status?: number; original?: unknown } = {},
  ) {
    const who = opts.symbol ? ` for "${opts.symbol}"` : ''
    const code = opts.status ? ` HTTP ${opts.status}` : ''
    super(
      `RATE_LIMITED:${code} ${provider} refused to serve this client${who} (${detail}). ` +
      `This is NOT a missing-data condition — the request was rejected before any data was returned, ` +
      `typically because ${provider} throttles / fingerprint-blocks the unofficial client by IP and request shape. ` +
      `Do NOT conclude the symbol has no history. Remedies: wait a few minutes and retry; ` +
      `switch data source (e.g. an "fmp|<symbol>" barId if an FMP key is configured, or a connected broker's barId); ` +
      `or change the outbound IP / network.`,
      opts.original,
    )
    this.name = 'RateLimitedError'
    this.provider = provider
    this.symbol = opts.symbol
    this.status = opts.status
  }
}
