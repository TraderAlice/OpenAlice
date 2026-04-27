// OpenAlice analysis_core Node-API binding — bootstrap shell.
//
// The napi-rs bridge and platform `.node` artifact land under a separate
// scoped issue (see docs/autonomous-refactor/adr/ADR-003-binding-strategy.md).
// Until then this module exposes a stable healthcheck export so the
// workspace shape, package wiring, and feature-flag fallback can be
// validated end-to-end without committing a native artifact.

'use strict';

function bootstrapHealthcheck() {
  return 'analysis_core:bootstrap';
}

module.exports = { bootstrapHealthcheck };
