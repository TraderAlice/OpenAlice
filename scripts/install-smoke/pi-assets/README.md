# Managed Pi installer fixture

These are the exact Pi `0.83.0` install manifest and lockfile consumed by the
OpenAlice bootstrap. They come from Pi's public MIT-licensed release assets:

- `pi-coding-agent-install-package.json`
- `pi-coding-agent-install-package-lock.json`
- release: `https://github.com/earendil-works/pi/releases/tag/v0.83.0`

The root `install` script pins and verifies these SHA-256 values before npm:

```text
package.json       ee080db64c3732daea5547bd6d9809465ffa236ef6099051e64a16753e48b795
package-lock.json  0f409bf498507f93bfbde3dc6f2b4c83bc58bdea2e2f5eabf3053cc2a81568d4
```

The Docker and unit fixtures use these same bytes with a fake npm executable,
so installer tests remain offline while still covering asset verification and
the exact non-global `npm ci` argv. Update the desktop pin, installer constants,
fixture files, hashes, docs, and smoke expectations together.
