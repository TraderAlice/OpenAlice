# Windows SignPath onboarding

Status: active. Related issue: none yet. Owner guides:
[[docs/windows-code-signing.md]], [[docs/development-workflow.md]],
[[docs/managed-workspace-runtime.md]].

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

Ordered work:

- [x] Inspect the current Windows package and release candidate order.
- [x] Prepare the SignPath artifact configuration and reviewed test workflow.
- [x] Validate XML well-formedness, workflow syntax, repository tooling tests,
  and root typecheck. The SignPath-hosted schema did not compile with the
  system `xmllint`, so final config validation remains an account-side test.
- [ ] Accept the OSS organization invitation; link the GitHub repository,
  create the project/configuration/test policy, and install a submitter token.
- [ ] Run the GitHub-hosted self-signed test and verify the returned installer.
- [ ] Publish and review Code signing and privacy policy statements plus team
  roles on public home/download/release surfaces.
- [ ] Send the tested request/build/policy links to SignPath for production
  certificate review.
- [ ] Integrate production signing in the Windows release path; regenerate and
  verify update metadata from signed bytes and prove the installed upgrade path.

Completion requires a production-signed Windows installer published only after
the same exact-byte acceptance as the other desktop assets. Do not close this
plan on a self-signed test alone.
