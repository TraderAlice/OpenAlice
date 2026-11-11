# Windows SignPath onboarding

Status: active. Related issue: none yet.

## Shipped Baseline

Self-signed test signing workflow and Authenticode verification in Windows CI
are complete. The self-signed test installer passed the full build, packaged
Workspace smoke, signing, verification, and signed-artifact upload.

Scope: SignPath Foundation test signing and eventual Windows Electron release
signing. macOS Developer ID/notarization and native CLI archives are unchanged.

Decisions:

- Begin with a standalone, non-publishing Windows NSIS installer test-signing
  workflow. This keeps a self-signed artifact out of the release candidate set.
- Use GitHub-hosted build artifacts as SignPath's trusted origin and a ZIP-root
  configuration with ProductName/ProductVersion restrictions.
- Preserve the current signed macOS/unsigned Windows release behavior until a
  production certificate exists and the signed Windows bytes pass update-feed,
  blockmap, upgrade, and publication checks.

## Remaining work

- [ ] Publish and review Code signing and privacy policy statements plus team
  roles on public home/download/release surfaces.
- [ ] Send the tested request/build/policy links to SignPath for production
  certificate review. `Release certificate 2026` still showed `CSR PENDING`
  when checked on 2026-10-11; no production certificate or release acceptance
  follows from the successful self-signed test.
- [ ] Integrate production signing in the Windows release path; regenerate and
  verify update metadata from signed bytes and prove the installed upgrade path.

Completion requires a production-signed Windows installer published only after
the same exact-byte acceptance as the other desktop assets. Do not close this
plan on a self-signed test alone.
