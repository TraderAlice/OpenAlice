# Windows code signing with SignPath

This guide owns the SignPath Foundation onboarding test for the Electron NSIS
installer. It does **not** publish a release or make the self-signed test
certificate trusted by Windows. The production release pipeline still builds
Windows artifacts unsigned until it is deliberately switched to the production
SignPath signing policy and its signed-byte update metadata is verified.

## OpenAlice side

`signpath/windows-installer.xml` is the artifact configuration to upload to
the OpenAlice project in the SignPath OSS organization. The GitHub Actions
artifact is a ZIP containing one `OpenAlice.Setup.<version>.exe`, so the XML
has a `<zip-file>` root and signs exactly that installer. The `version`
parameter restricts its embedded ProductVersion to the value read from the
built installer. The configuration signs the installer only; Electron's
embedded application executable remains unsigned in this first integration
test. Do not describe the installed app as fully signed on the strength of this
test alone.

`.github/workflows/signpath-test-windows.yml` builds and smoke-tests the
Windows installer on a GitHub-hosted runner, uploads the unsigned installer,
submits it to SignPath under the **self-signed test policy**, checks that the
returned installer has an Authenticode signer, and retains the signed test
installer for seven days. It does not create a tag, GitHub Release, updater
feed, or download alias. Its run summary contains the GitHub and SignPath
request links to send for Foundation review.

## Account-side setup

1. Accept the SignPath OSS organization invitation and enable MFA on SignPath
   and GitHub for the release team.
2. In the OSS organization, create/link the OpenAlice project to the
   `TraderAlice/OpenAlice` GitHub repository and add GitHub.com as a trusted
   build system. Follow the [official GitHub integration guide](https://docs.signpath.io/trusted-build-systems/github).
3. Create an artifact configuration from
   [`signpath/windows-installer.xml`](../signpath/windows-installer.xml), and
   select the provided self-signed test certificate in a test signing policy.
4. Create a SignPath API token with submitter access for that test policy.
   Add it to the GitHub repository as the `SIGNPATH_API_TOKEN` Actions secret.
   Do not paste the token into an issue, PR, chat, or tracked file.
5. Set these GitHub Actions repository variables to the exact values shown in
   SignPath: `SIGNPATH_ORGANIZATION_ID`, `SIGNPATH_PROJECT_SLUG`,
   `SIGNPATH_TEST_POLICY_SLUG`, and
   `SIGNPATH_ARTIFACT_CONFIGURATION_SLUG`. Set `SIGNPATH_TEST_ENABLED=true`
   only when the account setup is complete and the test signing request is
   ready to be submitted.
6. Merge the reviewed setup PR to `dev`: its change to the workflow or XML
   triggers one test run when `SIGNPATH_TEST_ENABLED=true`. The manual
   `workflow_dispatch` trigger will only appear after the workflow also exists
   on the repository's default branch, so do not depend on it for onboarding.
   Do not use the normal Release operation to obtain a test signature.

The first test may reveal that the NSIS stub's ProductVersion differs from
the package version; inspect the actual PE metadata and adjust the restriction
based on evidence, never remove it merely to make the request pass. SignPath
Foundation requires product-name and version restrictions on signed binaries.

## Foundation review and production integration

Once the self-signed request succeeds, reply to the existing SignPath
Foundation email with the GitHub workflow URL, SignPath request URL, project
and artifact configuration names, and the public Code signing policy URL.
SignPath then reviews the setup and orders/imports the production certificate.

Before requesting that review, publish a public **Code signing policy** link
on the project home and download/release pages. It must identify the release
team's authors/reviewers/approvers and link to the project's privacy policy,
as required by the [Foundation terms](https://signpath.org/terms.html).
Product/privacy and team-role claims must be approved by the maintainer rather
than inferred from repository access alone.

After the production certificate is available, integrate production signing
into `.github/workflows/release-desktop-platform.yml` before
`Prepare update channel aliases`. SignPath changes installer bytes, so regenerate
the Windows blockmap and update feed from the signed installer, then run
`electron:verify-update-assets` and candidate identity checks on those exact
bytes before publication. Decide separately whether the packaged OpenAlice
application executable should be signed before NSIS assembly; that requires
an earlier signing boundary and an additional artifact configuration. Never
publish a self-signed test installer to the stable or beta channel.
