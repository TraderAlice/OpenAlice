---
name: opencli-reader
description: >
  Use the optional community opencli CLI for read-only website access when
  the user requests it or an available adapter fits the task. Covers command
  discovery and browser-backed adapters. OpenAlice does not bundle opencli.
---

# opencli (optional, read-only)

[opencli](https://github.com/jackwener/opencli) provides website adapters through
`opencli <site> <command>`. It is one source-access option alongside the Coding
Agent's browser, search and other available tools; no research task requires it.

## Command discovery

When using opencli, check the installed command's help for current capabilities
and parameters:

```bash
command -v opencli
opencli <site> --help
opencli <site> <command> --help
```

`opencli list -f json` lists available adapters. See
[discovery.md](references/discovery.md) for registry fields and browser setup.
Browser-backed adapters may need an extension and an authenticated browser;
public adapters do not necessarily need that setup.

If an adapter is unavailable, another suitable source may serve the task.
Installation or account setup needs user authorization; missing opencli alone
is not a reason to interrupt research. Report material evidence gaps, rather
than treating a particular tool as a prerequisite.

This Skill covers reading only. Do not use adapter actions that post, send,
subscribe or otherwise mutate external state. Keep credentials and browser
session details out of output. Execution prices and trading writes remain
owned by the configured broker/UTA surface.

For an adapter failure, `OPENCLI_DIAGNOSTIC=1` can help diagnose the problem.
Check diagnostic output for private data before sharing it. Research can
continue through other available tools.

---

*Adapted from the [jackwener/opencli](https://github.com/jackwener/opencli)
skills and [himself65/finance-skills](https://github.com/himself65/finance-skills)
(MIT). opencli is an independent project.*
