# Workspace Runtime Settings

Status: Completed

Related issues: None.

Owner guides:

- [[../docs/model-semantics-and-runtime-injection.md]]
- [[../docs/managed-workspace-runtime.md]]
- [[../docs/workspace-issues-and-scheduling.md]]
- [[../docs/ui-interaction-and-motion.md]]

## Problem

OpenAlice currently has two competing Workspace runtime-default systems. A
legacy injector writes credentials, models, and effort into native project
files such as `opencode.json` and `.pi/settings.json`; newer product Sessions
persist a secret-free `SessionRuntimeBinding` and project it into each child
process. Native runtimes may still auto-read the legacy project files, so a
managed Session can inherit state that is not represented by its visible
binding.

Quick Chat also remembers one installation-wide launch tuple. That preference
does not travel with a Workspace and cannot independently describe interactive
and headless work.

## Decisions

1. Add `.alice/settings.json` as the Workspace-owned, self-describing settings
   file. Keep `.alice/workspace.json` focused on display metadata and the
   default Agent runtime.
2. Store only secret-free runtime preferences. A launch preference records an
   access mode (`native` or `vault`), an optional vault credential slug and wire
   shape, and optional model and effort values. It never stores a key, endpoint,
   resolved provider payload, or model capability snapshot.
3. Separate `interactive` and `headless` launch surfaces. Each surface records
   its most recently launched Agent and one recent preference per Agent runtime.
4. Resolve a fresh Session in this order: explicit one-launch fields, the
   matching Workspace surface/Agent preference, then native runtime state.
   Persist the resulting immutable `SessionRuntimeBinding` before spawning.
5. Update the Workspace recent preference only after a fresh binding has been
   resolved and accepted for launch. Resuming an existing Session replays its
   binding and never rewrites Workspace defaults.
6. Existing Issue agent/credential/model/effort fields remain explicit launch
   inputs. Missing Issue fields inherit the Workspace `headless` preference;
   an Issue does not mutate its own declaration when that fallback is used.
7. Stop treating native project configuration as an OpenAlice default source
   for fresh managed Sessions. Legacy project files remain readable only for
   exact legacy resume and the explicit compatibility editor. A native CLI may
   still discover a retained project file through its own precedence rules.
8. Retain native-project injection as a deprecated compatibility export for
   users who intentionally run a runtime directly in the Workspace folder.
   Remove it from the primary AI setup flow, label its API and code ownership as
   deprecated, and make the advanced UI disclose that OpenAlice does not resolve
   defaults from the export, while a native CLI may still discover the file.
9. Existing OpenAlice-owned native files are not deleted silently. Their
   sidecars allow a later reviewed migration or reset; user-authored native
   configuration remains user-owned.
10. The launcher-owned Workspace Manager keeps its installation-level recent
    preference because it is not a business Workspace and has no portable
    `.alice/settings.json` contract.

## File Contract

The initial schema is versioned and adapter-agnostic:

```json
{
  "version": 1,
  "runtime": {
    "interactive": {
      "recentAgent": "pi",
      "agents": {
        "pi": {
          "accessMode": "vault",
          "credentialSlug": "deepseek-1",
          "wireShape": "openai-chat",
          "model": "deepseek-v4-flash",
          "reasoningEffort": "high"
        }
      }
    },
    "headless": {
      "recentAgent": "pi",
      "agents": {}
    }
  }
}
```

Optional fields are omitted rather than serialized as `null`. A native entry
must not contain a credential slug or wire shape. Unknown Agent ids may be read
and preserved so uninstalling a runtime does not destroy its preference, while
write routes validate runtime ids used by the current installation.

## Work

- [x] Implement bounded, strict, serialized read/write/update helpers for
      `.alice/settings.json` with focused schema tests.
- [x] Expose secret-free Workspace runtime settings through the Workspace API
      and demo contract.
- [x] Resolve interactive and headless fresh-Session defaults from the new file
      and record accepted bindings back to the matching recent slot.
- [x] Move Quick Chat initialization from the installation-wide launch tuple
      to the selected Workspace's interactive preferences; keep the
      installation-wide tuple only for the launcher-owned Workspace Manager.
- [x] Stop `createSessionRuntimeBinding()` from implicitly reading native
      project files during ordinary managed launches.
- [x] Reframe native project injection/reset as a deprecated compatibility
      export and remove it from the primary Workspace AI flow.
- [x] Mark injector interfaces, routes, comments, and owner documentation as
      deprecated where they describe normal managed-Session configuration.
- [x] Verify explicit Issue fields, Workspace headless fallback, native global
      login, vault projection, Quick Chat, sidebar spawn, WebPi, and exact resume.
- [x] Complete browser and Electron/package acceptance, then move this plan to
      Completed.

## Verification

- `npx tsc --noEmit`
- `cd ui && npx tsc -b`
- `pnpm test`
- Focused Workspace settings, runtime binding, Quick Chat, Issue dispatch, and
  adapter projection suites
- Real `/chat` and Workspace Settings routes through `pnpm dev`
- `pnpm electron:smoke:pty`
- `CSC_IDENTITY_AUTO_DISCOVERY=false pnpm electron:smoke:workspace`

## Completion

Every business Workspace carries a portable, secret-free description of its
recent interactive and headless launch choices. Every fresh managed Session
freezes those choices into one binding and no longer derives ordinary launch
state from native project files. Native project injection remains available
only as a clearly deprecated compatibility export, with user files and global
runtime login state preserved.
