FROM node:22-bookworm-slim

RUN DEBIAN_FRONTEND=noninteractive apt-get update \
  && apt-get install -y --no-install-recommends bash ca-certificates curl git g++ make openssh-server python3 \
  && rm -rf /var/lib/apt/lists/* \
  && useradd --create-home --shell /bin/bash --uid 10001 smoke \
  && passwd --delete smoke \
  && mkdir -p /run/sshd /fixture/OpenAlice/scripts/guardian \
  && ssh-keygen -A

COPY install /fixture/install
COPY packages/cli /fixture/packages/cli
COPY scripts/install-smoke/static-server.mjs /fixture/static-server.mjs
COPY scripts/install-smoke/fake-npm.sh /fixture/fake-npm.sh
COPY scripts/install-smoke/pi-assets /fixture/pi-assets
COPY scripts/guardian/control-server.mjs /fixture/OpenAlice/scripts/guardian/control-server.mjs
COPY scripts/remote-smoke/fixture-guardian.mjs /fixture/OpenAlice/scripts/guardian/prod.mjs
COPY scripts/remote-smoke/fixture-package.json /fixture/OpenAlice/package.json
COPY scripts/remote-smoke/entrypoint.sh /fixture/entrypoint.sh

RUN mkdir -p \
    /fixture/OpenAlice/dist \
    /fixture/OpenAlice/ui/dist \
    /fixture/OpenAlice/services/uta/dist \
    /fixture/OpenAlice/services/connector/dist \
    /fixture/OpenAlice/packages/guardian-runtime/dist \
    /fixture/OpenAlice/node_modules \
  && cp /fixture/pi-assets/package.json /fixture/pi-assets/pi-coding-agent-install-package.json \
  && cp /fixture/pi-assets/package-lock.json /fixture/pi-assets/pi-coding-agent-install-package-lock.json \
  && touch \
    /fixture/OpenAlice/dist/main.js \
    /fixture/OpenAlice/ui/dist/index.html \
    /fixture/OpenAlice/services/uta/dist/uta.js \
    /fixture/OpenAlice/services/connector/dist/connector.cjs \
    /fixture/OpenAlice/packages/guardian-runtime/dist/index.js \
    /fixture/OpenAlice/node_modules/.keep \
  && git -C /fixture/OpenAlice init --initial-branch=main \
  && git -C /fixture/OpenAlice config user.email smoke@openalice.local \
  && git -C /fixture/OpenAlice config user.name 'OpenAlice Smoke' \
  && git -C /fixture/OpenAlice add --force . \
  && git -C /fixture/OpenAlice commit -m 'remote smoke fixture' \
  && git -C /fixture/OpenAlice tag remote-smoke \
  && chmod +x /fixture/entrypoint.sh /fixture/fake-npm.sh \
  && chown -R smoke:smoke /fixture/OpenAlice /home/smoke

EXPOSE 22
ENTRYPOINT ["/fixture/entrypoint.sh"]
