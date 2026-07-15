#!/usr/bin/env bash
set -euo pipefail

install -d -m 0700 -o smoke -g smoke /home/smoke/.ssh
install -m 0600 -o smoke -g smoke /tmp/authorized_keys /home/smoke/.ssh/authorized_keys

node /fixture/static-server.mjs >/tmp/openalice-installer-server.log 2>&1 &

exec /usr/sbin/sshd -D -e \
  -o PasswordAuthentication=no \
  -o KbdInteractiveAuthentication=no \
  -o PermitRootLogin=no \
  -o PubkeyAuthentication=yes \
  -o AllowUsers=smoke
