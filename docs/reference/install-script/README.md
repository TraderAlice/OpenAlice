# Installer Script Reference

This note keeps the context behind OpenAlice installer design work without
vendoring third-party installer source. Local unlicensed script snapshots in
this directory are ignored by Git and must not be committed or distributed
with OpenAlice.

Claude Code upstream entry points, inspected on 2026-07-13:

- Shell: <https://downloads.claude.ai/claude-code-releases/bootstrap.sh>
- PowerShell: <https://downloads.claude.ai/claude-code-releases/bootstrap.ps1>
- Windows CMD: <https://downloads.claude.ai/claude-code-releases/bootstrap.cmd>
- Installation documentation: <https://code.claude.com/docs/en/installation>

At inspection time, `latest` was `2.1.207` and `stable` was `2.1.197`.

Codex is the licensed, inspectable comparison. Its repository is Apache-2.0,
and the complete installers and their test harness are public:

- Repository and license: <https://github.com/openai/codex>
- Shell installer: <https://github.com/openai/codex/blob/main/scripts/install/install.sh>
- PowerShell installer: <https://github.com/openai/codex/blob/main/scripts/install/install.ps1>
- Shell installer tests: <https://github.com/openai/codex/blob/main/scripts/install/test_install_sh.py>

The useful Codex patterns are immutable release directories, a validated
staging area, atomic visible-command switching, install locks, stale recovery,
manager/PATH conflict detection, executable post-install verification, and
default-no prompts only at meaningful decision points. OpenAlice applies those
patterns independently to its smaller JavaScript CLI while keeping its more
explicit pre-install plan and separate start consent.

The useful design boundary is a thin platform-native bootstrap that detects the
platform, resolves a release, verifies its checksum, and delegates durable
installation to the CLI's own `install` command. Version placement, launcher
switching, PATH integration, updates, migrations, and diagnostics stay in the
CLI rather than growing inside curl/PowerShell/CMD scripts.

OpenAlice should independently implement that architecture while preserving
its visible install plan and explicit consent. Electron remains a separate,
complete distribution, and release authenticity still needs a signed or
release-owned checksum trust chain when the preview graduates from raw GitHub
files to standalone release assets.
