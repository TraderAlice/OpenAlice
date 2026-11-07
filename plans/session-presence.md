# Plan: Session floor presence (active / archived / deleted)

**Status:** active

## Goal

Ask Alice / Quant 名册上的「删」不是拆 TUI 座位，也不是把人从世界上抹掉。员工（`resumeId`）在桌内有三档在职状态：

| 状态 | 含义 |
|---|---|
| 在职 `active` | 花名册上的同事 |
| 归档 `archived` | 从名册收进柜子，人还在，痕迹还在，还能找回 |
| 删除 `deleted` | 软开除：不再上工，但署名和产物仍能找到这个人 |

现有 `lifecycle: retired` **保持原意**：整桌 offboard 时人跟桌子一起走。不拿它当归档。

顺带去掉侧栏截断和行内 Browse（底栏菜单里已有）。

## Why not grow `lifecycle`

`resume-identities.json` 已随 0.89.2+ 发布。`lifecycle` 只有 `active | retired`，且 `retired` 被 offboard / restore / follow-up 写成「跟桌子走了」。

若把 `archived` / `deleted` 塞进同一个字段：

- 旧解析器把未知值当成 `active`（`=== 'retired' ? retired : active`）；
- `recallWorkspace` 会把归档/软删一律拉回在职。

所以拆第二轴，缺省即在职，旧文件不用 migration：

```ts
lifecycle: 'active' | 'retired'   // 桌：在岗 / 跟桌走了（已发布）
presence:  'active' | 'archived' | 'deleted'  // 人：在职 / 归档 / 软删（新，缺省 active）
```

名册一行：`lifecycle === 'active' && (presence ?? 'active') === 'active'`。

## Product rules

| 表面 | `active` | `archived` | `deleted` | `retired`（跟桌） |
|---|---|---|---|---|
| Ask Alice / Quant 侧栏 | 是 | 否 | 否 | 否 |
| Browse：默认 / Archived 筛 | 默认 | Archived 筛 | 不进 Browse | 否 |
| Play / 拉 TUI | 是 | Browse 里可以，**不**自动恢复到名册 | 否 | 否 |
| 新 Issue 选人 | 是 | 否 | 否 | 否 |
| 已指派的 `@resumeId` 再跑 | 是 | 是（归档不是停工） | 否 | 否 |
| Follow-up | exact | exact（人还在） | unavailable `deleted-session` | unavailable `retired-session` |
| 新 headless / `ensure` | 是 | 是 | 拒 | 拒 |

- 侧栏 More 主操作是 **Archive**，不是 Delete。Delete 是二次确认的软开除。
- 正在占班（TUI 或 headless running）时 Archive / Delete 都锁。
- Archive / Delete **不**拆 `SessionRecord`；它是产品 Session 的持久名册记录。`DELETE /sessions/:sid` 只停止实时进程并把 presence 置为 `deleted`；只有 Workspace purge 才物理清除记录。
- 归档可 Restore → `presence=active`。软删可 Undelete → `archived`（先回柜子，不直接站回名册）。
- 真物理删除不存在。产物、Inbox、run 历史、`resumeId` 署名都留着。

## Alternatives considered

1. **只扩 `lifecycle`** — 和已发布的跟桌 `retired`、restore 全员召回冲突。否。
2. **侧栏 Delete = 直接 `deleted`** — 日常整理代价太大。否；主操作是 Archive。
3. **归档即 follow-up unavailable** — 归档只是收纳，不是人走了。否。
4. **Play 归档行则自动 Restore** — 打开档案夹不应把人弹回工位。否。

## Shipped Baseline (Increments 1–2)

Sidebar roster truncation removed; full roster scrolls. `presence`
(`active` / `archived` / `deleted`, default `active`) is separate from
`lifecycle: retired` (whole-desk offboard). Archive/Restore flow, Browse
filtering, follow-up and assignment gating are in `dev`.

## Active Work: Increment 3 — Soft-delete

- More → Delete（二次确认）→ `deleted`。
- Undelete → `archived`。
- Browse 仍不列出 `deleted`。署名 / 产物 follow-up 走 `deleted-session`，不新雇一个人顶上。
- `ensure` / 新 headless / 新指派拒绝 `deleted`。

## Out of scope

- 物理删 identity / 原生 transcript
- Manager 名册、Automation 调度页
- 侧栏 `createdBy` 徽章
- 把 `DELETE /sessions/:sid` 重解释成 Archive
- 独立「已归档员工」活动页

## Verification

```text
npx tsc --noEmit
cd ui && npx tsc -b
pnpm test
```

Browser (Chat + Quant): soft-delete hides the row from roster and Browse but
`@resumeId` still resolves (unavailable for new work); `retired` still means
whole-desk offboard only.

## Acceptance

- [ ] Delete (confirmed) → `deleted`; Undelete → `archived`
- [ ] `ensure` / new headless / new assignment reject `deleted`
- [ ] Open PR handed to review, not merged
