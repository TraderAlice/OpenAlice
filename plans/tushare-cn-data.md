# Plan: Native Tushare China market data

**Status:** active  
**Owner guides:** [[docs/market-data-architecture.md]], [[docs/project-structure.md]]  
**Delivery:** serial PR to `dev` (`area:market-data`).

## Goal

Add an opt-in, native Tushare HTTP provider for China equity research. The
provider supplies discoverable A-share identities, point-in-time-safe qfq
daily bars, low-frequency China reference datasets, and A-share fundamentals
without routing new product contracts through the OpenTypeBB compatibility
package.

## Decisions

- Credentials remain in the existing user-global provider-key store. The
  default endpoint is `https://api.tushare.pro`; custom endpoints must be HTTPS
  unless they are loopback development URLs, and may not contain query strings
  or fragments.
- Runtime reads enabled state, endpoint, and token per request so token rotation
  needs no restart. Tokens are POST-body only and never included in errors.
- The public surface is an allowlisted set of typed datasets, not an arbitrary
  `api_name` passthrough.
- Daily bars use `daily` plus `adj_factor`. Qfq is anchored to the request
  `end`/`asOf`, never a future factor. Tushare volume hands become shares and
  amount thousands of CNY become CNY.
- Operational identities use `tushare|<ts_code>` (for example
  `tushare|600519.SH`). The provider is disabled by default.

## Work

- [x] Configuration, secure hot-read HTTP client, cache/rate/retry behavior
- [x] Typed China datasets, symbol search, qfq daily bars and metadata
- [x] A-share equity profile/financials/ratios routing and `traderhub china`
- [x] Settings UI, masked credential flow, connectivity/capability test
- [x] Unit/integration tests and owner-guide updates
- [x] Typecheck, focused suites, full build, and demo UI verification
- [ ] Commit, PR, and CI acceptance

## Completion

Delete this file and its [[PLANS.md]] bullet when accepted.
