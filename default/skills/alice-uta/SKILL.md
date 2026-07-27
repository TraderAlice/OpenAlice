---
name: alice-uta
description: >
  Read broker accounts, portfolios, contracts, quotes, and order history, or
  manage approved trading, through the `alice-uta` executable on the shell
  PATH. Account/contract/history reads are safe and do not mutate broker state;
  order writes, position-close, commit, push, reject, sync, and simulator
  commands may change trading state. Use for "what's my position", "quote this
  contract", "place or cancel an order", and the trading-as-git approval flow.
  Discover current flags with `alice-uta <group> <verb> --help`; do not guess
  aliases.
---

# Trading — `alice-uta`

Accounts, portfolio, contracts, orders, and the trading-as-git approval flow.
Account, portfolio, contract, quote, market-clock, and history reads do not
mutate broker state. Order writes, position closes, approval commands, and the
simulator can mutate trading state: inspect their live help before acting, and
act only on what the user's instructions actually cover.

## Discover, don't guess

```bash
alice-uta --help                       # the groups
alice-uta <group> <verb> --help        # a verb's flags (which are required)
```

Read this skill before the first UTA command in a task. If a command is
rejected, follow the CLI's suggested command or run the exact verb's `--help`
before retrying. Do not improvise a positional account id or flags such as
`--account`, `--query`, or `--symbols`.

## Common read-only recipes

```bash
alice-uta account list
alice-uta account info --source <account-id>
alice-uta account portfolio                         # every trading account
alice-uta account portfolio --source <account-id>   # one account
alice-uta account portfolio --source <account-id> --symbol AAPL
```

`--source` takes the id returned by `account list`; it is not `--account` and
is not a broker-native account number.

Resolve a broker contract before requesting a quote. Search uses `--pattern`
(not `--query`). Quote accepts exactly one broker-resolved `--alice-id` at a
time; repeat the command for multiple contracts rather than inventing a
`--symbols` flag. Quote infers its account from the `aliceId` prefix.

```bash
alice-uta contract search --source <account-id> --pattern AAPL
alice-uta contract details --source <account-id> --alice-id '<alice-id-from-search>'
alice-uta contract quote --alice-id '<alice-id-from-search>'
```

Keep `aliceId` values quoted because they contain `|`, which a shell otherwise
interprets as a pipe. Contract search may return a directory rather than a
tradeable leaf; expand it before quoting or ordering:

```bash
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
