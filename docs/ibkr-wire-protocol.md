# IBKR wire protocol and decoder boundary

This guide owns the inbound framing contract between `@traderalice/ibkr` and
TWS/IB Gateway. Broker acceptance and account-safety procedure remain in
[[docs/uta-live-testing.md]].

## Why this guide exists

Issues #132 and #162 reported `BadMessage: no more fields` while IB Gateway
was sending initial account updates. The reports correctly identified one
extra field read in every text handler. Earlier investigation then attributed
the mismatch to a TWS-versus-Gateway payload divergence. That conclusion was
misleading: the TWS callbacks observed at server version 222 were largely
protobuf, so they did not exercise the broken text handlers.

The bundled IB API v10.44.01 Python source gives the actual invariant:

1. `client.py` removes the wire message id before calling `read_fields()` for
   both legacy and server-version-201+ framing.
2. `decoder.py` receives that message id out of band.
3. A text handler therefore starts at its first payload field. Depending on
   the message, that is a version, request id, or business value.

The initial TypeScript port had added `decodeInt(fields) // msgId` ahead of the
already-translated payload reads in 84 text handlers. Gateway account frames
made the extra read visible; the decoder consumed one real payload field and
eventually ran out of fields. This was a porting error, not an IB Gateway
10.37 protocol change and not an EU-account-specific schema.

## Required boundary

`packages/ibkr/src/client/base.ts` owns the envelope:

- before server version 201, consume the leading NUL-delimited text message id;
- from server version 201, consume the leading four-byte big-endian message id;
- when the wire id selects protobuf, pass the remaining bytes unchanged;
- otherwise split only the remaining text payload into fields.

`Decoder.interpret(msgId, fields)` consequently has a payload-only contract.
Handlers must never consume or reconstruct an envelope message id. Do not add
conditional prepending, account-pattern guessing, or fallback field shifting:
those approaches can silently turn a framing bug into incorrect financial
data.

## Failure boundary

A missing or invalid field is not recoverable within the same connection. Once
alignment is uncertain, the reader must:

1. report safe framing metadata (`msgId` and field count), without logging raw
   account or broker payloads;
2. discard all successor frames already buffered in that read;
3. disconnect only the affected IBKR connection so UTA health and recovery can
   reconnect it.

Continuing with the next buffered frame risks accepting shifted values. Letting
the exception escape the socket callback crashes the UTA process. Both are
incorrect.

The same containment rule applies before framing begins. A socket close during
the API handshake is an ordinary account-level connection failure: the bridge
must observe its `nextValidId` waiter from the instant the transport attempt
starts, the client must stop waiting as soon as that socket closes, and the UTA
must remain alive with that account reported as `offline/down`. A failed broker
must never escape as a process-level unhandled rejection or take other accounts
offline with it.

## Verification ladder

Work on this boundary must proceed from narrow to broad:

1. framing specs for legacy text, raw-int text, and protobuf envelopes;
2. payload fixtures for every decoder category: account, market data, orders,
   contracts, executions, historical data, and miscellaneous callbacks;
3. a malformed-field recovery spec that proves the buffered successor is not
   decoded and no payload value reaches the error message;
4. package typecheck and unit suite;
5. read-only package E2E against an available TWS or Gateway;
6. reporter validation against IB Gateway for region/version combinations not
   locally available.

Large variable-length text messages such as open/completed orders and full
contract details should be exercised from a real Gateway capture before a
fixture is promoted to tracked test data. Captures must be manually minimized
and scrubbed; never record account ids, balances, credentials, positions, or
orders in tracked fixtures.

This repair intentionally preserves the current UTA abstraction. It corrects
the broker SDK boundary first; any broader UTA identity or valuation redesign
is separate work.
