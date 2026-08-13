# Plan: Session roster by resumeId (lock TUI while headless)

**Status:** completed (delivered in PR #1068)  
**Owner guides:** [[docs/conversation-provenance.md]], [[docs/workspace-issues-and-scheduling.md]]  
**Delivery:** serial PR to `dev` (`area:workspace`)

## Goal

Ask Alice / Quant 侧栏列出 **Workspace 里的员工（`resumeId`）**，不按是否 headless 过滤。  
headless 只是这一班怎么上工：在跑则 **锁住拉 TUI**，显示运行中。列表按 **最近一次占班** 排序。

Automation 继续只看调度（`taskId`），不进这条花名册。

## Product rules

| 规则 | 含义 |
|---|---|
| 一行 = 一个 `resumeId` | 交互 + 后台回合是同一个人 |
| 显不显示与出生方式无关 | TUI / Issue / conversation_ask 都上名册 |
| 同时一班工 | `latestExecution.status === 'running'` 或 Directory `active`（且不是 TUI running）→ 禁止 spawn/resume/WebPi |
| 播放键 | 锁住，文案「运行中」；点标题也不 attach TUI |
| 结束后 | 锁解开；失败只淡标记，不继续锁 |
| 排序 | `max(interactive.lastActiveAt, latestExecution.startedAt/finishedAt)`，running 仍置顶 |
| 退休 | `lifecycle === 'retired'` 不进侧栏 |

后端已有互斥（interactive 开着不能 headless，resume 上有 turn 会 `busy`）。本增量补 **名册 + 锁的可见性**，不新造调度页。

## Data

已有 `GET /api/workspaces/:id/resumes`（`WorkspaceSessionDirectory`）：

- `resumeId`, `active`, `resumable`, `createdBy?`
- `interactive?`（title / state / lastActiveAt）
- `latestExecution?`（status / startedAt / finishedAt / issueId / assistantPreview）

Workspace 列表里的 `sessions[]` 仍是材质化 `SessionRecord`。侧栏改为：

```text
directory.sessions (active lifecycle)
  ⋈ workspace.sessions by resumeId
```

无 `SessionRecord` 的 Directory 行也要出现。Directory 尚未返回时回退到材质化列表。

**标题：** interactive title → assistantPreview → issueId → `resumeId` 短号。  
不要把整段 Issue What 塞进侧栏。

## UI（只动 Ask Alice 壳）

Quant 已共用 `ChatWorkspaceSection`，改这一处两边都有。

1. Domain hook `useWorkspaceSessionDirectory(ies)`  
2. Join + 排序纯函数 `orderHarnessSessions` / `joinWorkspaceHarnessSessions`  
3. `SessionRow` busy 时禁用 Resume/Play  
4. Browse all 同一 join；Running 筛包含 headless running  
5. Demo `/resumes` 补 Directory-only 同事

## Out of scope

- Automation 改版
- 侧栏 `createdBy` 徽章
- headless 输出面板 / 点标题看 transcript
- Manager Workspace 名册
- 生命周期独立活动页

## Checklist

- [x] hook + join/sort 纯函数 + 单测
- [x] SessionRow busy / ChatWorkspaceSection 数据源
- [x] Browse 同步
- [x] Demo + 锁按钮
- [x] 浏览器走 Chat（及一眼 Quant）

## Acceptance

- [x] 侧栏按 `resumeId` 列员工，含从未开过 TUI 的
- [x] headless running 时 TUI 激活锁定并显示运行中
- [x] 结束后可拉起 TUI
- [x] 按最近占班排序
- [x] Automation 职能不混进侧栏
- [x] Ask Alice 与 Quant 仍是同一套组件
