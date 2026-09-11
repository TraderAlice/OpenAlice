#!/usr/bin/env bash
set -euo pipefail

/fixture/run.sh --prepare-only >/dev/null
architecture=x64
case "$(uname -m)" in arm64|aarch64) architecture=arm64 ;; esac
archive="/tmp/openalice-native-fixture/openalice-cli-0.91.0-linux-${architecture}.tar.gz"
sha="$(cat "/tmp/openalice-native-fixture/openalice-cli-0.91.0-linux-${architecture}.sha256")"

printf '%s\n' \
  'OpenAlice native installer playground' \
  '' \
  'Try the review-first flow:' \
  "  bash /fixture/install --archive $archive --sha256 $sha --plan" \
  "  bash /fixture/install --archive $archive --sha256 $sha" \
  '' \
  'Node, npm, pnpm, Bun, and Agent Runtimes are intentionally absent.'
exec bash --noprofile --norc -i
