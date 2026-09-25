/**
 * Wallet-operation failure classification.
 *
 * TradingGit has to record an honest verdict for an operation whose broker call
 * FAILED, and there are only two honest answers:
 *
 *  - `'rejected'`   — the failure PROVES the venue did not accept the order
 *                     (invalid order, insufficient funds, auth, market closed,
 *                     a local refusal before dispatch).
 *  - `'unconfirmed'` — transport-level failure: the request may have reached the
 *                     venue and no outcome came back. Recording this as
 *                     'rejected' is the one claim that must never be made
 *                     without evidence, because a caller that trusts it retries
 *                     and can double-submit a live order.
 *
 * Why this lives next to the brokers: the shapes classified here are the shapes
 * the brokers actually produce. It stays broker-agnostic — no venue SDK is
 * imported — and reads four real sources:
 *
 *  1. `BrokerError` — the normalized error the brokers already raise. Its code
 *     is the verdict, because BrokerError.classifyMessage already routes
 *     timeouts/resets/429/5xx to NETWORK and "insufficient"/403 to EXCHANGE
 *     (packages/uta-protocol/src/types/broker.ts:64-84).
 *  2. Raw CCXT errors — rethrown UNWRAPPED by the CCXT broker, so the class
 *     name is the venue's verdict (RequestTimeout/NetworkError vs
 *     InvalidOrder/InsufficientFunds).
 *  3. Node/undici transport errors (`error.code`), walking `cause` because
 *     undici wraps a socket failure as `TypeError('fetch failed')`.
 *  4. `ReportedOperationFailureError` — a failure the dispatcher reported as a
 *     resolved `{ success: false, error }` instead of throwing it. The message
 *     is then the only evidence available.
 *
 * Unrecognized THROWN failures are 'unconfirmed' on purpose (fail closed): the
 * client gets "reconcile" instead of a definite claim we cannot back up.
 */

import { BrokerError } from './types.js'

export type OperationFailureVerdict = 'rejected' | 'unconfirmed'

/**
 * A refusal decided LOCALLY, before anything was dispatched ("quantity exceeds
 * the open position", "account is read-only", "unknown operation action").
 *
 * Nothing reached the venue, so the log may honestly record `'rejected'` — and
 * it MUST, because the fail-closed default for unrecognized errors is
 * `'unconfirmed'`: without this marker a local precondition failure would be
 * logged as an order of unknown fate, and the caller would be told to reconcile
 * a request that was never sent.
 */
export class LocalOperationRefusalError extends Error {
  constructor(message: string) {
    super(message)
    this.name = 'LocalOperationRefusalError'
  }
}

/** BrokerError codes that prove the venue refused the operation. */
const REJECTED_BROKER_CODES: Readonly<Record<string, true>> = {
  CONFIG: true,
  AUTH: true,
  EXCHANGE: true,
  MARKET_CLOSED: true,
  CONNECTING: true,
}

/** CCXT error classes that prove the venue refused the operation. */
const REJECTED_ERROR_NAMES: Readonly<Record<string, true>> = {
  InvalidOrder: true,
  InsufficientFunds: true,
  AuthenticationError: true,
  PermissionDenied: true,
  BadSymbol: true,
  BadRequest: true,
  ArgumentsRequired: true,
  NotSupported: true,
  OrderNotFound: true,
  ExchangeError: true,
}

/** Transport-level failures: the request may have reached the venue. */
const UNCONFIRMED_ERROR_CODES: Readonly<Record<string, true>> = {
  ETIMEDOUT: true,
  ESOCKETTIMEDOUT: true,
  ECONNRESET: true,
  ECONNREFUSED: true,
  ECONNABORTED: true,
  EPIPE: true,
  EAI_AGAIN: true,
  ENOTFOUND: true,
  EHOSTUNREACH: true,
  ENETUNREACH: true,
  ENETDOWN: true,
  UND_ERR_CONNECT_TIMEOUT: true,
  UND_ERR_HEADERS_TIMEOUT: true,
  UND_ERR_BODY_TIMEOUT: true,
  UND_ERR_SOCKET: true,
}

const UNCONFIRMED_ERROR_NAMES: Readonly<Record<string, true>> = {
  AbortError: true,
  TimeoutError: true,
  NetworkError: true,
  RequestTimeout: true,
  ExchangeNotAvailable: true,
  DDoSProtection: true,
  RateLimitExceeded: true,
  NullResponse: true,
  OperationFailed: true,
}

/** Transport WORDING as it appears in REPORTED failures (their message is the
 *  only evidence there is). Needed on top of `BrokerError.classifyMessage`:
 *  ccxt's own timeout text is "<id> <method> <url> request timed out (<n> ms)",
 *  which that taxonomy does not match — it looks for the single word "timeout".
 *
 *  Over-matching costs one reconciliation ("maybe it landed"); under-matching
 *  costs a duplicate order, so the patterns err wide. */
const REPORTED_TRANSPORT_PATTERNS: readonly RegExp[] = [
  /time(?:d)? ?out/i,
  /econn(?:reset|refused|aborted)|esockettimedout|etimedout|eai_again|enotfound/i,
  /socket hang ?up|broken pipe|connection (?:reset|closed|aborted)/i,
  /network ?error|fetch failed|temporarily unavailable/i,
  /bad gateway|gateway timeout|service unavailable/i,
  /rate ?limit|too many requests/i,
]

/** Wrapper depth walked through `cause` (undici nests one level; the cap keeps a
 *  cyclic cause chain from looping). */
const MAX_CAUSE_DEPTH = 4

/**
 * Classify a failed wallet operation for the commit log. Defaults to
 * `'unconfirmed'` for anything unrecognized — see the module note.
 */
export function classifyOperationFailure(error: unknown): OperationFailureVerdict {
  let current: unknown = error
  for (let depth = 0; depth < MAX_CAUSE_DEPTH && current != null; depth++) {
    const verdict = classifySingleFailure(current)
    if (verdict !== null) return verdict
    current = (current as { cause?: unknown }).cause
  }
  return 'unconfirmed'
}

function classifySingleFailure(error: unknown): OperationFailureVerdict | null {
  if (typeof error !== 'object' || error === null) return null
  const candidate = error as {
    name?: unknown
    code?: unknown
    message?: unknown
    status?: unknown
    statusCode?: unknown
    httpStatus?: unknown
  }

  // 0a. A local pre-dispatch refusal: nothing was sent, so the verdict is definite.
  if (candidate.name === 'LocalOperationRefusalError') return 'rejected'

  // 0b. A failure the dispatcher REPORTED instead of throwing (the git layer
  //     shapes it as ReportedOperationFailureError). Unlike a thrown failure, an
  //     unrecognized message stays 'rejected': a resolved failure is a positive
  //     report from our own dispatcher — a guard refusal or a venue refusal
  //     arrives exactly this way — and flipping every refusal to "unknown" would
  //     be its own lie.
  if (candidate.name === 'ReportedOperationFailureError') {
    const message = typeof candidate.message === 'string' ? candidate.message : ''
    if (BrokerError.from(new Error(message)).code === 'NETWORK') return 'unconfirmed'
    if (REPORTED_TRANSPORT_PATTERNS.some((pattern) => pattern.test(message))) return 'unconfirmed'
    return 'rejected'
  }

  // 1. BrokerError (matched structurally: optional broker packs carry their own
  //    copy of the class, so constructor identity is not reliable).
  if (candidate.name === 'BrokerError' && typeof candidate.code === 'string') {
    if (Object.hasOwn(REJECTED_BROKER_CODES, candidate.code)) return 'rejected'
    if (candidate.code === 'NETWORK' || candidate.code === 'UNKNOWN') return 'unconfirmed'
  }

  // 2. Raw broker-SDK errors: the class name is the venue's answer.
  if (typeof candidate.name === 'string') {
    if (Object.hasOwn(REJECTED_ERROR_NAMES, candidate.name)) return 'rejected'
    if (Object.hasOwn(UNCONFIRMED_ERROR_NAMES, candidate.name)) return 'unconfirmed'
  }

  // 3. Node/undici transport codes.
  if (typeof candidate.code === 'string' && Object.hasOwn(UNCONFIRMED_ERROR_CODES, candidate.code)) {
    return 'unconfirmed'
  }

  // 4. An HTTP answer: the request reached the venue. 408/429/5xx are transport
  //    or availability answers (no outcome), other 4xx are the venue's refusal.
  const http = readHttpStatus(candidate.status)
    ?? readHttpStatus(candidate.statusCode)
    ?? readHttpStatus(candidate.httpStatus)
  if (http !== null && http >= 400) {
    return http === 408 || http === 429 || http >= 500 ? 'unconfirmed' : 'rejected'
  }

  return null
}

function readHttpStatus(value: unknown): number | null {
  if (typeof value === 'number' && Number.isInteger(value)) return value
  if (typeof value === 'string' && /^\d{3}$/.test(value)) return Number(value)
  return null
}
