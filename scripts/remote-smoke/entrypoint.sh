#!/usr/bin/env bash
set -euo pipefail

install -d -m 0700 -o smoke -g smoke /home/smoke/.ssh
install -m 0600 -o smoke -g smoke /tmp/authorized_keys /home/smoke/.ssh/authorized_keys
printf '%s\n' \
  'OPENALICE_NPM_BIN=/fixture/fake-npm.sh' \
  'OPENALICE_PI_RELEASE_BASE_URL=http://127.0.0.1:18080/pi-assets' \
  'OPENALICE_RUNTIME_RELEASE_BASE_URL=http://127.0.0.1:18080/runtime-assets' \
  > /home/smoke/.ssh/environment
chown smoke:smoke /home/smoke/.ssh/environment
chmod 0600 /home/smoke/.ssh/environment

node /fixture/static-server.mjs >/tmp/openalice-installer-server.log 2>&1 &

exec /usr/sbin/sshd -D -e \
  -o PasswordAuthentication=no \
  -o KbdInteractiveAuthentication=no \
  -o PermitRootLogin=no \
  -o PermitUserEnvironment=yes \
  -o PubkeyAuthentication=yes \
  -o AllowUsers=smoke
