---
name: alice-uta
description: >
  Trading on your shell PATH via the `alice-uta` CLI — OpenAlice's trading
  surface. These commands MUTATE real broker state, so resolve the
  broker-native contract first and report every result. Use whenever you need
  to place / modify / cancel an order; close a position; check an account,
  portfolio, or order/trade history; resolve a contract or quote; or drive the
  trading-as-git approval flow: "place a buy order for AAPL", "what's my
  position in ETH", "close half my TSLA", "find the contract for this option",
  "show pending trades", "approve my orders". Discover every group, verb, and
  flag with `alice-uta --help` and `alice-uta <group> <verb> --help` — do NOT
  guess flags.
---

# Trading — `alice-uta`

Accounts, portfolio, orders, and the trading-as-git approval flow. **These
mutate real broker state** — discover before you act, and act only on what
the user's instructions actually cover.

## Discover, don't guess

```bash
alice-uta --help                       # the groups
alice-uta <group> <verb> --help        # a verb's flags (which are required)
```

## Accounts & portfolio

```bash
alice-uta account list                 # registered trading accounts + capabilities
alice-uta account info --help          # one account's detail
alice-uta account portfolio --help     # positions for an account
```

## Resolve the contract first

```bash
alice-uta contract search --help       # find the broker-native contract
alice-uta contract details --help      # its full identity
alice-uta contract quote --help        # a quote
alice-uta contract expand --help       # expand a directory-style result (chains, families)
```

- **Resolve the contract before any order** (`contract search` →
  `contract details`) — never guess a symbol's broker-native identity.

## Place / modify / cancel orders

```bash
alice-uta order place --help           # check EVERY flag before placing
alice-uta order modify --help          # amend a working order
alice-uta order cancel --help          # cancel a working order
alice-uta order list                   # working orders
alice-uta order history --help         # the order record
alice-uta order trades --help          # fills
```

- **Report every order result to the user** — order id, status, and what
  you did. Surprises in a brokerage account are never acceptable.

## Positions

```bash
alice-uta position close --help        # close a position (partial or full)
```

(Listing positions is `account portfolio`.)

## The trading-as-git approval flow

The `git` group is OpenAlice's trade-approval flow — a mirror of git verbs on
purpose. Run `--help` per verb:

```bash
alice-uta git status                   # pending / staged trading state
alice-uta git log                      # history
alice-uta git show --help              # inspect one entry
alice-uta git commit --help            # approve
alice-uta git push --help              # send approved orders to the venue
alice-uta git reject --help            # reject a staged change
alice-uta git sync --help              # reconcile against the venue
```

## Market clock & simulator

```bash
alice-uta market clock                 # is the venue open?
alice-uta sim price-change --help      # MockBroker only — move a mock price for testing; no-op against real brokers
```

## Not here

- **Scheduling is not in `alice-uta`.** Recurring/headless workspace work is
  issue-backed: use `alice-workspace issue create` or write
  `.alice/issues/<id>.md` with a `when` field (see the `self-scheduling` skill).
