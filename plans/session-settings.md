# Plan: Session Settings from the sidebar overflow

**Status:** active (implementation in progress on this branch)  
**Owner guides:** [[docs/conversation-provenance.md]],
[[docs/model-semantics-and-runtime-injection.md]],
[[docs/ui-interaction-and-motion.md]]  
**Delivery:** serial PR(s) to `dev` (`area:ui`, `area:workspace`). No
`review:deep` unless a later increment widens the paused-runtime write
contract. Related: [[plans/session-presence.md]] (Archive stays a separate
overflow action).

## Goal

Ask Alice / Quant 侧栏 Session 行的 `...` 菜单里加 **Settings**，打开该
Session 的配置面：至少能改 **display name**、**credential / model / effort**。
Archive / Restore / Delete 仍留在菜单里，不并进 Settings。

今天这两类能力后端都已存在，但 UI 入口分散且不全：

| Capability | Backend | Current UI |
|---|---|---|
| Coworker `displayName` | `PATCH /api/workspaces/:id/resumes/:resumeId/metadata`；CLI/tool `session rename` | **无**侧栏入口（API client `setSessionDisplayName` 已有） |
| Cred / model / effort | `PUT /api/workspaces/:id/sessions/:sid/runtime`（仅 paused） | 仅暂停态右侧 `ResumeCta` → **Change AI** → `SessionRuntimeEditorDialog` |

用户要从名册行直接配置同事，不必先点开、停住、再在 Resume CTA 上找 Change AI。

## Current surface (facts)

- `SessionRow` (`ui/.../Sidebar.tsx`) overflow via `SidebarActionMenu`：Archive /
  Restore / Delete。无 Settings / Rename。
- Workspace 行的 overflow 已有 **Rename**（`window.prompt`）+ **Configure** —
  可作为邻近模式，但 Session 不该照搬 prompt。
- `sessionCoworkerLabel`：`displayName` → `title` → sticky `name`。改 nametag
  不碰 recency（owner guide 已写死）。
- Runtime 替换必须 Session **paused** 且无 live PTY/WebPi；running → 409
  `session_not_paused`。`shell` 无 managed AI binding。
- `SessionRuntimeEditorDialog` 已复用 `AgentLaunchSelectors`；Save 只写该
  Session binding，不改 Workspace recent prefs，不 wake Session。

## Alternatives

### A. 菜单拆两项：Rename + Change AI

- Rename：改 `displayName`（随时，含 running）。
- Change AI：复用现有 dialog（仅 paused；running 禁用或先 Pause）。
- **Pros:** 对齐 Workspace Rename/Configure；后端可变性边界清晰。
- **Cons:** 用户要的「Settings」被拆开；改名若用 `prompt` 体验偏旧。

### B. 单一 Settings，运行中也允许改 AI（隐式 Pause → 写 binding）

- **Pros:** 一键改完。
- **Cons:** Settings 变成停工动作；和现有「Pause 是显式 STOP」冲突；headless
  占班时更危险。**否。**

### C. 单一 Settings dialog（推荐）

`...` → **Settings** 打开同一会话对话框：

1. **Display name** — 始终可编辑；Save 走 metadata PATCH；空/清除回退到
   title/name 链；不 bump recency。
2. **AI configuration** — 复用 `AgentLaunchSelectors` / 现有 runtime editor：
   - paused + 非 shell + 有 `onUpdateRuntime`：可编辑，Save 走
     `PUT .../runtime`；
   - running / headless busy：只读展示当前 binding + 文案「Pause this
     Session before changing credential, model, or effort」（可附 Pause
     按钮，但 **不**自动 pause）；
   - shell：整段 AI 隐藏。
3. Archive 等 destructive 动作 **不进** dialog。
4. `ResumeCta` 的 Change AI 改为打开 **同一** Settings 组件（或同一 AI
   区块），避免两套编辑器。

- **Pros:** 匹配「Settings」诉求；诚实对待 pause 约束；一次入口覆盖
  nametag + AI；实现增量小（扩展现有 dialog + 接线）。
- **Cons:** dialog 内两段生命周期不同，文案/disabled 要清楚。

**选择 C。** 不是 maintainer 已批准的设计；这是调查后的推荐，实现前可改。

## Interaction model (chosen)

| Concern | Behavior |
|---|---|
| Entry | Session row `...` → Settings（Archive 之上、非 danger） |
| Composition | One dialog: nametag field + AI selectors (when applicable) |
| Responsive | Same `Dialog` / `max-w-lg` as today’s runtime editor; mobile keeps full-width sheet behavior of shared Dialog |
| A11y | Menu item + dialog title named for the coworker label; focus return via existing `SidebarActionMenu` deferred-select pattern |
| Shared primitives | `Dialog`, `SidebarActionMenu`, `AgentLaunchSelectors`; do not hand-roll a second picker |
| Save semantics | Prefer one Save for the whole dialog: always PATCH displayName when dirty; PATCH/PUT runtime only when paused and AI dirty. If AI dirty while running, block Save with the pause message (or disable AI controls so Save only commits nametag) |
| i18n | New `workspace.sessionSettings*` keys in en/zh/zh-Hant/ja; retire hard-coded English in `SessionRuntimeEditorDialog` as part of the same pass |

## Scope

### In

- [x] Extend or replace `SessionRuntimeEditorDialog` → Session Settings
  (display name + AI); keep unit/render specs green
- [x] `SessionRow` / `HarnessSessionRow` / `ChatWorkspaceSection` wire
  `onOpenSessionSettings` + agents / workspaceId / save callbacks
- [x] `setSessionDisplayName` from the dialog; optimistic or refetch roster
  label without reordering
- [x] Resume CTA Change AI → same dialog
- [x] Demo handler already covers metadata + runtime; add UI specs for menu
  entry + save paths
- [x] Owner-guide touch: one short paragraph under Session coworker name /
  paused binding UI pointing at the sidebar Settings entry
- [x] i18n for dialog + menu label

### Out

- Changing Agent runtime kind mid-Session
- Editing birth `createdBy` / presence from Settings
- Auto-pause on Save
- Workspace-level AI preferences / launch defaults
- Replacing Workspace row’s `window.prompt` rename (separate cleanup)
- Office floor employee chrome (unless it already shares SessionRow)

## Risks / constraints

- **Two write APIs, one Save:** displayName 与 runtime 失败要分别可见；runtime
  409 不得回滚已成功的 nametag（或 Save 前校验 paused）。
- **Missing `resumeId`:** metadata 需要 resumeId；无 identity 的行只允许看、
  或隐藏 Settings。
- **Archived Browse rows:** nametag 仍可改；若无 paused `SessionRecord`，AI
  段只读或隐藏（先读 Directory / roster 投影再定）。
- **Do not** teach a second runtime write path that skips the pause gate.

## Verification

```bash
npx tsc --noEmit
cd ui && npx tsc -b
pnpm test
```

Plus: real Ask Alice route — open `...` → Settings → rename while running;
pause → change model/effort → resume; confirm label updates and Archive still
works. Demo walk if `/api/*` handlers are touched beyond fixtures.

## Completion

Delete this file and its [[PLANS.md]] bullet when the Settings entry and shared
dialog are accepted on `dev`.
