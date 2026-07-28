# v0.85 Broker Pack Upgrade Gap

Date: 2026-07-28

Affected release: `v0.85.0-beta`

Impact: Existing live-broker accounts could remain offline after an otherwise
successful OpenAlice desktop update.

## User-visible symptom

An existing OKX account backed by CCXT showed:

```text
Installed broker pack "ccxt" is invalid:
Installed broker pack ccxt targets OpenAlice 0.84.0-beta;
0.85.0-beta is running
```

The account detail page offered **Reconnect**, but reconnecting retried the same
stale active Pack and returned the same error. The effective recovery was
**Trading → Broker support → Repair**, which was not presented at the failure
site.

UTA Core had upgraded correctly inside the OpenAlice desktop package. The
separately downloaded CCXT Broker Pack had not. No broker engine loaded for the
affected account, so the failure caused loss of trading availability rather
than an unintended trading write.

## Root cause

Broker Pack activation required
`broker-pack.json#version === package.json#version`. The desktop updater
replaced OpenAlice and its bundled UTA Core but did not reconcile active Broker
Packs stored under `<OPENALICE_HOME>/runtime/broker-packs/`.

The v0.85 release did publish matching Pack artifacts for every supported
platform. Publication therefore succeeded while existing installations still
retained an `active.json` pointer to their v0.84 immutable release.

## Why release checks missed it

- Release jobs built, validated, imported, published, and mirrored fresh v0.85
  Pack artifacts.
- Packaged Workspace acceptance started from isolated/fresh state.
- No gate seeded the real previous-release Packs before launching the candidate.
- Product version equality was treated as compatibility even though the
  explicit `BROKER_PACK_API_VERSION` is the actual module boundary.
- Recovery UI existed on the Trading overview, but not in the account failure
  path where the user encountered the problem.

The missing test was an existing-user upgrade, not a fresh install.

## Immediate recovery for v0.85

Open **Trading**, find **Broker support needs attention**, and choose **Repair**
for each affected engine. Installation validates the v0.85 catalog and
checksum, atomically activates the new immutable release, and asks Guardian to
restart UTA.

## Permanent safeguards

Beginning with v0.86:

1. A Pack remains loadable across OpenAlice product versions while its
   `BROKER_PACK_API_VERSION` is supported.
2. Production startup automatically reconciles only Packs the user already
   installed. It never silently installs a new optional broker integration.
3. Failed downloads or validation leave the previous compatible active pointer
   untouched.
4. Trading UI exposes **Update** and **Repair** with the accounts that require
   the Pack.
5. Every release platform must pass a real previous-release-to-candidate Pack
   upgrade smoke before publication.
6. A Pack API change requires an explicit API-version increment and a release
   candidate containing compatible artifacts for every supported platform.

## Release invariant

A release is not accepted merely because its Broker Pack artifacts exist.
It is accepted only when an installation carrying the previous public
release's active Packs can start safely, reconcile to the candidate, retain a
recoverable previous release, and load UTA through the declared Pack API.
