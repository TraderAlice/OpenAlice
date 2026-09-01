#!/usr/bin/env sh

export HOME=/data/home
export OPENALICE_INSTALL_DIR=/data/home/.openalice
export NPM_CONFIG_PREFIX=/data/home/.local
export BUN_INSTALL=/data/home/.bun
export OPENALICE_HOME="${OPENALICE_HOME:-/data/projects/default}"
export AQ_LAUNCHER_ROOT="$OPENALICE_HOME/workspaces"

# Image-owned command wrappers must win over the persistent release launchers.
# They inject the stable Railway machine identity for non-interactive SSH execs,
# whose environment is not a child of the foreground entrypoint process.
export PATH=/usr/local/sbin:/usr/local/bin:/data/home/.openalice/bin:/data/home/.local/bin:/data/home/.bun/bin:/usr/sbin:/usr/bin:/sbin:/bin

if [ -n "${RAILWAY_ENVIRONMENT_ID:-}" ] && [ -n "${RAILWAY_SERVICE_ID:-}" ]; then
  export OPENALICE_MACHINE_ID="railway-service-${RAILWAY_SERVICE_ID}"
fi
