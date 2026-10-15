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
  and root typecheck. Account-side schema validation now also passes.
- [x] Accept the OSS organization invitation and verify the existing project,
  GitHub.com trusted build system, CI submitter, and valid `test-signing` policy.
  Rotate the CI token into the GitHub `SIGNPATH_API_TOKEN` secret.
- [x] Create `windows-installer` from the checked-in XML; SignPath reports
  `VALID` on 2026-10-11. Pin the existing test certificate for CI verification.
- [x] Configure repository variables and enable the test workflow on `dev`.
- [x] Merge setup PR [#1605](https://github.com/TraderAlice/OpenAlice/pull/1605).
  [Run 38122997125](https://github.com/TraderAlice/OpenAlice/actions/runs/38122997125)
  built the Windows installer, passed packaged Workspace acceptance and PE
  metadata checks, and uploaded the unsigned installer.
- [x] Install/authorize the SignPath GitHub App for `TraderAlice/OpenAlice`.
  The owner reviewed the repository/organization permissions and installed it
  on 2026-10-11 with only `OpenAlice` selected. This resolves the first request's
  `Failed to retrieve GitHub App token` prerequisite failure.
- [x] Submit the first successful self-signed request after App installation:
  [c471d6af-e568-471b-9c5d-4729fa4c601a](https://app.signpath.io/Web/bc3b3092-8ca4-4498-ad25-003b4a539a0b/SigningRequests/c471d6af-e568-471b-9c5d-4729fa4c601a)
  completed on 2026-10-11. Its installer SHA-256 is
  `aea9d0a6b30e49404a8e5e36d41fdc6b16cde511274601f36fd23611b8b00e8f`.
- [x] Verify the returned self-signed installer in Windows CI.
  [Run 38124632189](https://github.com/TraderAlice/OpenAlice/actions/runs/38124632189)
  passed the complete build, packaged Workspace smoke, signing, Authenticode
  verification, and signed-artifact upload on 2026-10-11 at source `dc18f040`.
  [Request 0aa1f009-5ac7-4026-9420-338d058b947b](https://app.signpath.io/Web/bc3b3092-8ca4-4498-ad25-003b4a539a0b/SigningRequests/0aa1f009-5ac7-4026-9420-338d058b947b)
  is `Completed`; SignPath's manifest and the Windows verifier agree on the
  installer SHA-256:
  `97f4a48b83b4441ad1ab1c7da8cc09a220896976177ac4ec399d2b82b9e6cbf7`.
  Verification passed with the pinned test certificate and removed temporary
  `LocalMachine\Root` trust. This resolves the earlier `CurrentUser\Root`
  consent-dialog stall. The run retains
  `signpath-signed-test-windows-38124632189` for seven days; it is not a public
  release artifact.
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
